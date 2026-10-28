"""Automatic zone setup: learn a camera's road layout from the traffic it sees.

The manual zone editor stays the reference way to set up a camera. This module is the alternative: watch a few
minutes of traffic, then propose the same zone config the editor produces (road zones with size and direction,
no-parking kerb strips, intersections, bus stops, signal queues, U-turn openings), plus a report of how sure it is.

How it works
1. Vanishing point. Vehicles drive along the road, so the image paths of long straight tracks meet at the road's
   vanishing point (RANSAC over the track lines). With no camera roll the horizon is the image row through it.
2. Ground model. A pin-hole camera tilted down toward that horizon maps every pixel below it to a point on the
   road plane: (along the road, across the road), up to the unknown camera height.
3. Self-calibration. The camera height and lens (field of view) are unknown. Every detected car, bus, CNG and
   truck is a measuring stick: a 3-D box of the class's typical size is placed on the road at the detection and
   projected back into the image. Width fixes the scale; how box heights change from near to far fixes the lens.
   Accuracy is reported, not assumed: speeds from an automatically calibrated zone are indicative (about +-15%),
   and the speed rule uses a wider margin for them (see SpeedViolation).
4. Layout. On the ground plane, road edges are lines of constant "across" value, so each carriageway is a band of
   across values used by traffic in one direction. Kerb strips are its outer edges (extended to where vehicles
   stand), the median is the gap between opposite flows, lanes are peaks in the lateral density.
5. Special areas from behaviour: side-road traffic joining or leaving = intersection; where whole carriageways stop
   together with the same queue head = signal queue; where buses repeatedly stand = a bus stop, kept only if it
   is just after an intersection (otherwise it is reported as an illegal bus-stopping hotspot); vehicles crossing
   from one carriageway to the other = U-turn opening.

What it cannot know: legal facts (banned vehicle classes, legal parking bays, lower local speed limits, officially
approved mid-block bus bays). Those stay off until a person sets them in the editor.
"""

import math
from collections import Counter, defaultdict

import cv2
import numpy as np

# Typical real sizes in Dhaka (body width, length, height, roof width in metres). Rigid classes only: riders' arms
# and loads make two-wheeler / rickshaw boxes unreliable as measuring sticks. The roof width matters: seen from a
# footbridge the roof is nearer the camera than the wheels, so a car modelled with a body-wide roof looks too wide
# and the camera comes out too high.
CLASS_SIZE = {
    "Car": (1.75, 4.4, 1.48, 1.25),
    "MPV": (1.75, 4.6, 1.85, 1.45),
    "Pickup": (1.78, 5.0, 1.75, 1.45),
    "Bus": (2.45, 10.5, 3.1, 2.3),
    "Truck": (2.35, 6.5, 2.9, 2.2),
    "CNG": (1.35, 2.7, 1.72, 1.15),
    "Leguna": (1.5, 3.6, 1.9, 1.35),
}
MOTORISED = {"Bus", "Car", "MPV", "Pickup", "Truck", "CNG", "Easybike", "Leguna", "Motorbike", "Bhotbhoti",
             "PowerTiller"}
# Everything that drives on the carriageway. In Dhaka rickshaws are often most of the traffic (Mirpur, Old Dhaka),
# so they count for the layout and direction; only rigid motor vehicles are used as measuring sticks (CLASS_SIZE).
ROAD_USERS = MOTORISED | {"Rickshaw", "Van", "Bicycle"}
BUS_STOP_MAX_AFTER_M = 120.0


# ---------------------------------------------------------------- observation

class TrafficObserver:
    """Collects tracked boxes while a camera is observed. Feed it the detector output frame by frame."""

    def __init__(self, frame_size, max_boxes=2_000_000):
        self.W, self.H = frame_size
        self.tracks = defaultdict(list)       # tid -> [(t, x1, y1, x2, y2)]
        self.votes = defaultdict(Counter)     # tid -> class votes
        self.boxes = 0
        self.max_boxes = max_boxes
        self.t_first = self.t_last = None
        self.frames = []                      # [(gray image, scale to full resolution)] for the lens measurement
        self.preview = None                   # one colour frame for the zone editor
        self._t_frame = -1e9

    def add_frame(self, frame, t, every_sec=12.0, keep=8, max_width=1920):
        """Keeps a few frames spread over the observation (vertical lines differ as vehicles pass)."""
        if t - self._t_frame < every_sec or len(self.frames) >= keep:
            return
        self._t_frame = t
        h, w = frame.shape[:2]
        k = max(1.0, w / max_width)
        small = cv2.resize(frame, (int(w / k), int(h / k)), interpolation=cv2.INTER_AREA) if k > 1 else frame
        self.frames.append((cv2.cvtColor(small, cv2.COLOR_BGR2GRAY), k))
        if self.preview is None or len(self.frames) == 2:
            self.preview = small.copy()

    def add(self, t, tracks):
        """tracks: [((x1, y1, x2, y2), tid, class)] in full-frame pixels."""
        if self.boxes >= self.max_boxes:
            return
        self.t_first = t if self.t_first is None else self.t_first
        self.t_last = t
        for (x1, y1, x2, y2), tid, cls in tracks:
            self.tracks[tid].append((t, float(x1), float(y1), float(x2), float(y2)))
            self.votes[tid][cls] += 1
            self.boxes += 1

    @property
    def seconds(self):
        return 0.0 if self.t_first is None else self.t_last - self.t_first

    def moving_tracks(self, min_frac=0.04):
        """Number of road-user tracks that moved at least `min_frac` of the frame height (progress measure)."""
        n = 0
        for tid, p in self.tracks.items():
            if len(p) < 8 or self.votes[tid].most_common(1)[0][0] not in ROAD_USERS:
                continue
            (_, a1, _, a2, ay), (_, b1, _, b2, by) = p[0][:5], p[-1][:5]
            if math.hypot((b1 + b2 - a1 - a2) / 2, by - ay) >= min_frac * self.H:
                n += 1
        return n


class Track:
    __slots__ = ("tid", "cls", "purity", "t", "box", "clipped", "u", "v", "moving", "al", "ac")

    def __init__(self, tid, rows, votes, W, H):
        self.tid = tid
        self.cls, n = votes.most_common(1)[0]
        self.purity = n / sum(votes.values())
        a = np.array(sorted(rows), np.float64)
        self.t, self.box = a[:, 0], a[:, 1:5]
        x1, y1, x2, y2 = self.box.T
        self.clipped = (x1 <= 2) | (x2 >= W - 3) | (y2 >= H - 3) | (y1 <= 2)
        self.u, self.v = (x1 + x2) / 2, y2   # bottom-centre: where the vehicle touches the road
        self.moving = False


# ---------------------------------------------------------------- ground model

class GroundModel:
    """Pin-hole camera with the principal point at the image centre, rolled by `roll_deg` and tilted down so that
    the road's vanishing point `vp` lies on the horizon. Maps pixels below the horizon to the road plane:
    (along the road, across the road) in metres once `scale` (camera height in metres) is set."""

    def __init__(self, W, H, f, vp, roll_deg=0.0):
        self.W, self.H = W, H
        self.cx, self.cy = W / 2.0, H / 2.0
        self.f = float(f)
        self.hfov = 2 * math.degrees(math.atan(W / 2 / self.f))
        self.roll = roll_deg
        r = math.radians(roll_deg)
        self.cr, self.sr = math.cos(r), math.sin(r)
        self.vp = (float(vp[0]), float(vp[1]))
        _, vy = self._derot(*self.vp)
        self.horizon = vy                                    # horizon offset from the centre (derolled, < 0)
        self.theta = math.atan2(-self.horizon, self.f)      # pitch down
        self.c, self.s = math.cos(self.theta), math.sin(self.theta)
        X, _, Z = self._ray(*self.vp)
        n = math.hypot(X, Z)
        self.road = np.array([X / n, Z / n])                 # along the road, away from the camera
        self.perp = np.array([self.road[1], -self.road[0]])  # across the road, to the image right
        self.scale = 1.0

    @classmethod
    def from_hfov(cls, W, H, hfov_deg, vp, roll_deg=0.0):
        return cls(W, H, (W / 2.0) / math.tan(math.radians(hfov_deg) / 2), vp, roll_deg)

    def _derot(self, u, v):
        x, y = np.asarray(u, np.float64) - self.cx, np.asarray(v, np.float64) - self.cy
        return x * self.cr - y * self.sr, x * self.sr + y * self.cr

    def _ray(self, u, v):
        x, y = self._derot(u, v)
        x, y = x / self.f, y / self.f
        return x, -(y * self.c + self.s), -y * self.s + self.c

    def below_horizon(self, u, v, margin=0.0):
        return self._derot(u, v)[1] > self.horizon + margin

    def ground(self, u, v):
        """Ground point (X, Z) in camera-height units; NaN at or above the horizon."""
        X, Y, Z = self._ray(u, v)
        with np.errstate(divide="ignore", invalid="ignore"):
            t = np.where(Y < -1e-9, -1.0 / Y, np.nan)
        return np.stack([t * X, t * Z], axis=-1)

    def road_coords(self, u, v):
        """(along, across) in metres (along grows away from the camera)."""
        g = self.ground(u, v) * self.scale
        return g @ self.road, g @ self.perp

    def pixel(self, along, across, height=0.0):
        """Image point of a road-plane point (metres), optionally `height` metres above the road."""
        along, across = np.asarray(along, np.float64), np.asarray(across, np.float64)
        g = (np.multiply.outer(along, self.road) + np.multiply.outer(across, self.perp)) / self.scale
        Xw, Zw = g[..., 0], g[..., 1]
        Yw = -1.0 + np.asarray(height) / self.scale
        x = Xw
        y = -Yw * self.c - Zw * self.s
        z = -Yw * self.s + Zw * self.c
        with np.errstate(divide="ignore", invalid="ignore"):
            xd, yd = self.f * x / z, self.f * y / z
        # roll back into the image
        return np.stack([self.cx + xd * self.cr + yd * self.sr, self.cy - xd * self.sr + yd * self.cr], axis=-1)


def track_lines(tracks, H):
    """(centroid, unit direction, weight) of the long, straight paths of moving road users."""
    lines = []
    for tr in tracks:
        ok = ~tr.clipped
        if tr.cls not in ROAD_USERS or ok.sum() < 10:
            continue
        p = np.stack([tr.u[ok], tr.v[ok]], 1)
        span = np.linalg.norm(p[-1] - p[0])
        if span < 0.08 * H:
            continue
        c = p.mean(0)
        _, sv, vt = np.linalg.svd(p - c, full_matrices=False)
        rms = sv[1] / math.sqrt(len(p))
        if rms > 0.02 * span:  # lane change or ID switch: not a straight path
            continue
        lines.append((c, vt[0], span))
    return lines


def _ransac_vp(C, D, w, accept, tol_deg, iters=3000, seed=0):
    """Weighted RANSAC + least-squares intersection of lines (point C, direction D, weight w)."""
    if len(C) < 4:
        return None, np.zeros(len(C), bool)
    rng = np.random.default_rng(seed)
    N = np.stack([-D[:, 1], D[:, 0]], 1)
    cst = (N * C).sum(1)
    tol = math.radians(tol_deg)

    def inliers(vp):
        to = vp[None, :] - C
        dist = np.linalg.norm(to, axis=1)
        cos = np.abs((to * D).sum(1)) / np.maximum(dist, 1e-9)
        return np.arccos(np.clip(cos, -1, 1)) < tol

    best, best_score = None, -1
    for _ in range(iters):
        i, j = rng.choice(len(C), 2, replace=False)
        A = np.stack([N[i], N[j]])
        if abs(np.linalg.det(A)) < 1e-9:
            continue
        vp = np.linalg.solve(A, [cst[i], cst[j]])
        if not np.isfinite(vp).all() or not accept(vp):
            continue
        score = w[inliers(vp)].sum()
        if score > best_score:
            best, best_score = vp, score
    if best is None:
        return None, np.zeros(len(C), bool)
    for _ in range(3):
        m = inliers(best)
        if m.sum() < 2:
            break
        best = np.linalg.lstsq(N[m] * w[m, None], cst[m] * w[m], rcond=None)[0]
    return best, inliers(best)


def vanishing_point(lines, W, H, tol_deg=3.0, seed=0):
    """Road vanishing point from track lines. Returns (vp, inlier weight share, inlier count) or (None, 0, 0)."""
    if len(lines) < 8:
        return None, 0.0, 0
    C = np.array([l[0] for l in lines]); D = np.array([l[1] for l in lines]); w = np.array([l[2] for l in lines])
    vp, m = _ransac_vp(C, D, w, lambda p: p[1] < H and abs(p[0]) < 20 * W and p[1] > -20 * H, tol_deg, seed=seed)
    if vp is None:
        return None, 0.0, 0
    return vp, float(w[m].sum() / w.sum()), int(m.sum())


def vertical_segments(frames, road_vp, min_len_frac=0.03):
    """Near-vertical line segments (building edges, poles, upright edges of buses and trucks) in a few frames,
    excluding road markings / kerbs, which point at the road's vanishing point. frames: [(gray, scale to full)]."""
    lsd = cv2.createLineSegmentDetector(cv2.LSD_REFINE_STD)
    out = []
    for gray, k in frames:
        segs = lsd.detect(gray)[0]
        if segs is None:
            continue
        s = segs.reshape(-1, 4) * k
        d = s[:, 2:] - s[:, :2]
        L = np.linalg.norm(d, axis=1)
        H = gray.shape[0] * k
        ok = L > min_len_frac * H
        s, d, L = s[ok], d[ok] / L[ok, None], L[ok]
        ang = (np.degrees(np.arctan2(d[:, 0], d[:, 1])) + 90) % 180 - 90
        mid = (s[:, :2] + s[:, 2:]) / 2
        to = np.asarray(road_vp)[None, :] - mid
        to /= np.linalg.norm(to, axis=1)[:, None]
        aim = np.degrees(np.arccos(np.clip(np.abs((to * d).sum(1)), 0, 1)))
        keep = (np.abs(ang) < 15) & (aim > 2.5)
        out += [(m, dd, ll) for m, dd, ll in zip(mid[keep], d[keep], L[keep])]
    return out


def lens_from_verticals(segs, W, H, road_vp, seed=0, n_boot=60):
    """Focal length and roll from the vertical vanishing point and the horizon (two orthogonal vanishing points).
    Returns dict(f, roll_deg, f_lo, f_hi, segments) or None."""
    if len(segs) < 25:
        return None
    C = np.array([s[0] for s in segs]); D = np.array([s[1] for s in segs]); w = np.array([s[2] for s in segs])
    cx, cy = W / 2, H / 2

    def solve(Ci, Di, wi, sd):
        vv, m = _ransac_vp(Ci, Di, wi, lambda p: p[1] > H * 1.5, 0.35, iters=1500, seed=sd)
        if vv is None or m.sum() < 15:
            return None
        up = vv - [cx, cy]
        dv = float(np.linalg.norm(up))
        up /= dv
        dh = float(np.dot([cx, cy] - np.asarray(road_vp), up))  # principal point to horizon
        if dh <= 0:
            return None
        return math.sqrt(dh * dv), math.degrees(math.atan2(vv[0] - cx, vv[1] - cy)), int(m.sum())

    base = solve(C, D, w, seed)
    if base is None:
        return None
    rng = np.random.default_rng(seed)
    fs = []
    for b in range(n_boot):
        idx = rng.integers(0, len(C), len(C))
        r = solve(C[idx], D[idx], w[idx], seed + b + 1)
        if r:
            fs.append(r[0])
    if len(fs) < n_boot // 3:
        return None
    lo, hi = np.percentile(fs, [10, 90])
    return {"f": base[0], "roll_deg": base[1], "f_lo": float(lo), "f_hi": float(hi), "segments": base[2]}


# ---------------------------------------------------------------- self-calibration

def _cuboid_box(gm, along, across, size):
    """Image bounding box of a vehicle (a box with a narrower roof) whose nearest ground edge is centred at
    (along, across); the body extends away from the camera (its near face touches the bottom of the box)."""
    w, l, h, w_top = size
    al, ac, hh = [], [], []
    for a in (0.0, l):
        for side in (-0.5, 0.5):
            al += [a, a]; ac += [side * w, side * w_top]; hh += [0.0, h]
    al, ac, hh = np.array(al), np.array(ac), np.array(hh)
    px = gm.pixel(along[:, None] + al[None, :], across[:, None] + ac[None, :], hh[None, :])
    return px[..., 0].min(1), px[..., 1].min(1), px[..., 0].max(1), px[..., 1].max(1)


def _vehicle_samples(tracks, rng, max_samples):
    samples = []
    for tr in tracks:
        if tr.cls not in CLASS_SIZE or tr.purity < 0.7 or not tr.moving:
            continue
        idx = np.nonzero(~tr.clipped)[0]
        for k in idx[:: max(1, len(idx) // 12)]:  # a dozen samples per vehicle: no single vehicle dominates
            samples.append((tr.tid, tr.cls, *tr.box[k]))
    if len(samples) > max_samples:
        samples = [samples[i] for i in rng.choice(len(samples), max_samples, replace=False)]
    return samples


def _fit_height(gm, cls, B):
    """Camera height (metres) that makes the class cuboids as wide in the image as the detected boxes.
    Returns (height, per-sample log width ratio at that height, median log height ratio)."""
    keep = gm.below_horizon((B[:, 0] + B[:, 2]) / 2, B[:, 3], 0.03 * gm.H)
    b, c = B[keep], cls[keep]
    obs_w, obs_h = b[:, 2] - b[:, 0], b[:, 3] - b[:, 1]

    def ratios(h):
        gm.scale = h
        al, ac = gm.road_coords((b[:, 0] + b[:, 2]) / 2, b[:, 3])
        pw, ph = np.zeros(len(b)), np.zeros(len(b))
        for k in np.unique(c):
            m = c == k
            x1, y1, x2, y2 = _cuboid_box(gm, al[m], ac[m], CLASS_SIZE[k])
            pw[m], ph[m] = x2 - x1, y2 - y1
        with np.errstate(divide="ignore", invalid="ignore"):
            return np.log(pw / obs_w), np.log(ph / obs_h)

    lo, hi = 1.0, 40.0
    for _ in range(40):  # predicted width shrinks as the camera rises: bisect on the median log ratio
        mid = math.sqrt(lo * hi)
        rw, _ = ratios(mid)
        if np.nanmedian(rw) > 0:
            lo = mid
        else:
            hi = mid
    h = math.sqrt(lo * hi)
    rw, rh = ratios(h)
    gm.scale = h
    return h, rw[np.isfinite(rw)], float(np.nanmedian(rh))


def calibrate(tracks, W, H, vp, lens=None, max_samples=5000, seed=0, log=lambda m: None):
    """Camera height (and lens, if not measured) from vehicle sizes. `lens` = lens_from_verticals() result or None.
    Returns (GroundModel with scale set, report dict)."""
    rng = np.random.default_rng(seed)
    samples = _vehicle_samples(tracks, rng, max_samples)
    if len(samples) < 40:
        return None, {"ok": False, "reason": f"only {len(samples)} usable car/bus/CNG/truck sightings"}
    tids = np.array([s[0] for s in samples]); cls = np.array([s[1] for s in samples])
    B = np.array([s[2:] for s in samples], np.float64)
    if lens:
        f, roll = lens["f"], lens["roll_deg"]
        f_lo, f_hi = lens["f_lo"], lens["f_hi"]
        lens_src = f"vertical lines ({lens['segments']} segments)"
    else:  # no usable verticals: a typical phone / CCTV lens, with a wide honest range
        f = (W / 2) / math.tan(math.radians(65) / 2)
        f_lo, f_hi = (W / 2) / math.tan(math.radians(80) / 2), (W / 2) / math.tan(math.radians(50) / 2)
        roll, lens_src = 0.0, "assumed (no vertical structures found)"
    gm = GroundModel(W, H, f, vp, roll)
    h, rw, rh = _fit_height(gm, cls, B)
    # statistical uncertainty of the height: bootstrap over vehicles
    uniq = np.unique(tids)
    hs = []
    for b in range(30):
        pick = set(rng.choice(uniq, len(uniq), replace=True).tolist())
        m = np.array([t in pick for t in tids])
        g2 = GroundModel(W, H, f, vp, roll)
        hs.append(_fit_height(g2, cls[m], B[m])[0])
    h_stat = float(np.std(np.log(hs)))
    gm.scale = h

    # along-road distances scale with sqrt(f^2 + d_h^2) (d_h: centre to horizon) times the height
    dh = -gm.horizon
    def along_factor(ff):
        return math.hypot(ff, dh)
    lens_err = max(abs(along_factor(f_lo) / along_factor(f) - 1), abs(along_factor(f_hi) / along_factor(f) - 1))
    size_prior = 0.08   # Dhaka cars / buses / CNGs vary around the typical sizes
    speed_err = math.sqrt(lens_err ** 2 + size_prior ** 2 + h_stat ** 2)
    rep = {"ok": True, "lens": lens_src, "hfov_deg": round(gm.hfov, 1),
           "hfov_range": [round(2 * math.degrees(math.atan(W / 2 / f_hi)), 1),
                          round(2 * math.degrees(math.atan(W / 2 / f_lo)), 1)],
           "roll_deg": round(roll, 2), "tilt_deg": round(math.degrees(gm.theta), 1),
           "camera_height_m": round(h, 2), "vehicle_samples": int(len(B)),
           "height_check": round(float(math.exp(rh)), 2),
           "speed_uncertainty_pct": int(round(100 * speed_err))}
    if abs(rh) > 0.25:
        rep["warning"] = ("Vehicle heights do not match the calibration well: the lens or the camera angle is "
                          "unusual. Speeds from this camera may be less accurate than stated.")
    log(f"Calibrated: field of view {gm.hfov:.0f} deg ({lens_src}), camera {h:.1f} m above the road, "
        f"tilt {math.degrees(gm.theta):.0f} deg; speeds within about +-{rep['speed_uncertainty_pct']}%")
    return gm, rep


# ---------------------------------------------------------------- layout

def _robust_band(x, lo=2.0, hi=98.0):
    return float(np.percentile(x, lo)), float(np.percentile(x, hi))


def _clusters_1d(values, gap):
    """Groups sorted values whose neighbours are closer than `gap`."""
    v = np.sort(np.asarray(values))
    if len(v) == 0:
        return []
    out, cur = [], [v[0]]
    for x in v[1:]:
        if x - cur[-1] <= gap:
            cur.append(x)
        else:
            out.append(cur)
            cur = [x]
    out.append(cur)
    return out


class Carriageway:
    def __init__(self, sign, across, along, n_tracks, purity):
        self.sign = sign                   # +1 traffic moves away from the camera, -1 toward it
        self.a0, self.a1 = across          # across range (metres, image-left to image-right)
        self.l0, self.l1 = along           # along range (near, far)
        self.n_tracks, self.purity = n_tracks, purity
        self.kerb_sides = []               # "left" / "right" (image sides) that are kerbs, not the median
        self.lanes = 0
        self.stand_extent = {}             # side -> metres added to reach standing (kerbside) vehicles

    @property
    def direction(self):
        if self.purity < 0.9:
            return "both"
        return "away_from_camera" if self.sign > 0 else "toward_camera"


def propose(observer, log=lambda m: None, min_moving=60):
    """Turns observed traffic into a zone config (same schema as the zone editor) and a report.
    Raises ValueError with a readable reason when the traffic does not allow a reliable layout."""
    W, H = observer.W, observer.H
    tracks = [Track(tid, rows, observer.votes[tid], W, H) for tid, rows in observer.tracks.items() if len(rows) >= 6]
    for tr in tracks:
        ok = ~tr.clipped
        if ok.sum() >= 4:
            du = tr.u[ok][-1] - tr.u[ok][0]; dv = tr.v[ok][-1] - tr.v[ok][0]
            tr.moving = math.hypot(du, dv) >= 0.04 * H
    moving = [t for t in tracks if t.moving and t.cls in ROAD_USERS]
    if len(moving) < min_moving:
        raise ValueError(f"Only {len(moving)} moving vehicles seen: observe longer (at least {min_moving})")
    report = {"observed_s": round(observer.seconds, 1), "tracks": len(tracks), "moving_vehicles": len(moving),
              "notes": []}

    # 1. vanishing point of the road
    lines = track_lines(moving, H)
    vp, share, n_in = vanishing_point(lines, W, H)
    if vp is None or n_in < 15:
        raise ValueError("Could not find the road direction: tracks are not straight enough (curved road, a junction "
                         "seen from above, or a camera looking across the road). Use manual zones.")
    if vp[1] > H * 0.45:
        raise ValueError("The road vanishes too low in the picture: the camera looks too steeply down or across the "
                         "road for automatic calibration. Use manual zones.")
    report["vanishing_point"] = [round(float(vp[0]), 1), round(float(vp[1]), 1)]
    report["road_direction_agreement"] = round(share, 2)
    if share < 0.5:
        report["notes"].append("Less than half of the traffic follows one straight direction: cross traffic or a "
                               "curved road; only the main road was zoned.")
    log(f"Road direction found from {n_in} vehicle paths ({share:.0%} agree)")

    # 2-3. lens from vertical structures (if any), camera height from vehicle sizes
    lens = lens_from_verticals(vertical_segments(observer.frames, vp), W, H, vp) if observer.frames else None
    if lens is None:
        report["notes"].append("No clear vertical structures (poles, buildings) found: the lens was assumed, so "
                               "speeds are less certain. A view that includes a pole or building edge helps.")
    gm, cal = calibrate(tracks, W, H, vp, lens=lens, log=log)
    if gm is None:
        raise ValueError("Calibration failed: " + cal["reason"])
    report["calibration"] = cal

    # 4. ground positions of every sighting
    for tr in tracks:
        tr.al, tr.ac = gm.road_coords(tr.u, tr.v)
    valid = lambda tr: (~tr.clipped) & np.isfinite(tr.al) & gm.below_horizon(tr.u, tr.v, 0.02 * H)

    # direction of each moving track on the ground: + away from camera
    flow = []
    for tr in moving:
        ok = valid(tr)
        if ok.sum() < 4:
            continue
        dal = tr.al[ok][-1] - tr.al[ok][0]
        dac = tr.ac[ok][-1] - tr.ac[ok][0]
        if abs(dal) < 4.0 or abs(dac) > 0.6 * abs(dal):  # turning / crossing traffic is handled later
            continue
        flow.append((1 if dal > 0 else -1, float(np.median(tr.ac[ok])), tr, ok))
    if len(flow) < min_moving // 2:
        raise ValueError("Too few vehicles drove along the road in the measurable part of the picture")

    # 5. carriageways = across bands per travel direction
    ac_all = np.array([f[1] for f in flow]); sg_all = np.array([f[0] for f in flow])
    bins = np.arange(np.percentile(ac_all, 0.5) - 2, np.percentile(ac_all, 99.5) + 2, 0.5)
    hist_p = np.histogram(ac_all[sg_all > 0], bins)[0].astype(float)
    hist_n = np.histogram(ac_all[sg_all < 0], bins)[0].astype(float)
    k = cv2.getGaussianKernel(7, 1.5).ravel()
    hp, hn = np.convolve(hist_p, k, "same"), np.convolve(hist_n, k, "same")
    centres = (bins[:-1] + bins[1:]) / 2
    tot = hp + hn
    lab = np.zeros(len(centres), int)      # +1 / -1 dominant direction, 0 = no traffic
    active = tot > max(0.5, 0.02 * tot.max())
    lab[active] = np.where(hp[active] >= hn[active], 1, -1)
    # contiguous runs of one label = carriageways (an undivided two-way road gives two adjacent runs)
    runs, start = [], None
    for i in range(len(lab) + 1):
        cur = lab[i] if i < len(lab) else 0
        if start is None and cur != 0:
            start = i
        elif start is not None and (cur != lab[start]):
            runs.append((start, i - 1, lab[start]))
            start = i if cur != 0 else None
    cws = []
    for i0, i1, sgn in runs:
        lo, hi = centres[i0] - 0.25, centres[i1] + 0.25
        inside = [(s, a, tr, ok) for s, a, tr, ok in flow if lo <= a <= hi]
        if len(inside) < max(8, 0.05 * len(flow)):
            continue
        n_same = sum(1 for s, *_ in inside if s == sgn)
        acs = np.concatenate([tr.ac[ok] for _, _, tr, ok in inside])
        als = np.concatenate([tr.al[ok] for _, _, tr, ok in inside])
        # Edges from where the wheels actually go, padded by half a vehicle width. Measured in 10 m sections along
        # the road and combined by the median: a junction mouth or a lay-by widens one section, not the road.
        lows, highs = [], []
        for b0 in np.arange(np.percentile(als, 1), np.percentile(als, 99), 10.0):
            m = (als >= b0) & (als < b0 + 10)
            if m.sum() >= 30:
                lo_b, hi_b = _robust_band(acs[m], 2.0, 98.0)
                lows.append(lo_b); highs.append(hi_b)
        a0, a1 = (float(np.median(lows)), float(np.median(highs))) if len(lows) >= 3 else _robust_band(acs, 1.0, 99.0)
        cws.append(Carriageway(sgn, (max(lo, a0 - 0.9), min(hi, a1 + 0.9)),
                               (float(np.percentile(als, 1)), float(np.percentile(als, 99))),
                               len(inside), n_same / len(inside)))
    if not cws:
        raise ValueError("No carriageway with enough traffic was found")
    cws.sort(key=lambda c: c.a0)
    # neighbouring runs of opposite direction with no gap = undivided road: split at the meeting point
    for a, b in zip(cws, cws[1:]):
        if b.a0 < a.a1:
            mid = (a.a1 + b.a0) / 2
            a.a1, b.a0 = mid, mid

    # 6. kerbs: outer sides; extend outward to where vehicles stand (kerbside stops happen just off the flow)
    standing = []  # (across, along) of vehicles that stood still the whole time they were seen
    for tr in tracks:
        ok = valid(tr)
        if ok.sum() < 6 or tr.moving:
            continue
        standing.append((float(np.median(tr.ac[ok])), float(np.median(tr.al[ok]))))
    standing = np.array(standing).reshape(-1, 2)
    for i, cw in enumerate(cws):
        sides = []
        if i == 0:
            sides.append("left")
        if i == len(cws) - 1:
            sides.append("right")
        cw.kerb_sides = sides  # inner sides face the median / opposite flow, not a kerb
        for side in sides:
            edge = cw.a0 if side == "left" else cw.a1
            if not len(standing):
                continue
            ac_s, al_s = standing[:, 0], standing[:, 1]
            beyond = ((ac_s < edge) & (ac_s > edge - 5)) if side == "left" else ((ac_s > edge) & (ac_s < edge + 5))
            beyond &= (al_s >= cw.l0) & (al_s <= cw.l1)
            # kerbside parking lines the kerb: it must appear along at least 4 different 10 m sections (a junction
            # mouth or a lay-by covers one or two)
            sections = set((al_s[beyond] // 10).astype(int).tolist())
            if len(sections) >= 4:
                ext = min(4.5, float(np.percentile(np.abs(ac_s[beyond] - edge), 85)) + 0.5)
                cw.stand_extent[side] = ext
                if side == "left":
                    cw.a0 -= ext
                else:
                    cw.a1 += ext
        # lanes: peaks of lateral density of moving vehicles
        acs = np.concatenate([tr.ac[ok] for s, a, tr, ok in flow if cw.a0 <= a <= cw.a1] or [np.zeros(0)])
        if len(acs) > 50:
            lb = np.arange(cw.a0, cw.a1 + 0.25, 0.25)
            hst = np.convolve(np.histogram(acs, lb)[0].astype(float), cv2.getGaussianKernel(9, 2.0).ravel(), "same")
            peaks = [j for j in range(1, len(hst) - 1) if hst[j] >= hst[j - 1] and hst[j] > hst[j + 1]
                     and hst[j] > 0.25 * hst.max()]
            merged = []
            for j in peaks:  # lanes are at least 2.6 m apart
                if merged and (j - merged[-1]) * 0.25 < 2.6:
                    if hst[j] > hst[merged[-1]]:
                        merged[-1] = j
                else:
                    merged.append(j)
            cw.lanes = len(merged)
    # median gaps
    medians = [round(b.a0 - a.a1, 1) for a, b in zip(cws, cws[1:])]
    report["carriageways"] = [{"direction": c.direction, "width_m": round(c.a1 - c.a0, 1), "lanes": c.lanes,
                               "vehicles": c.n_tracks, "one_way_share": round(c.purity, 2),
                               "kerbs": c.kerb_sides} for c in cws]
    report["median_gaps_m"] = medians

    # 7. behaviour-based special areas
    try:
        areas = _special_areas(tracks, cws, gm, valid, report)
    except Exception as e:  # optional extras: never lose the road layout and calibration because of them
        areas = []
        report["notes"].append(f"Junctions / bus stops / signals were not detected ({type(e).__name__}: {e}); "
                               "draw them in the zone editor")

    # 8. assemble config (same schema as the editor) -----------------------------------
    zones, names = [], []
    left_to_right = "left" if len(cws) > 1 else ""
    for i, cw in enumerate(cws):
        far, near = cw.l1, max(cw.l0, _near_limit(gm, cw, H))
        if far - near < 15:
            report["notes"].append(f"Carriageway {i + 1}: only {far - near:.0f} m measurable")
        side = ("left" if i == 0 else "right" if i == len(cws) - 1 else f"#{i + 1}") if len(cws) > 1 else ""
        dir_word = {"toward_camera": "toward camera", "away_from_camera": "away from camera"}.get(cw.direction,
                                                                                               "two-way")
        name = (f"{side.capitalize()} carriageway ({dir_word})" if side else f"Road ({dir_word})")
        names.append(name)
        pts = _rect_pixels(gm, cw.a0, cw.a1, near, far)
        zones.append({"type": "road", "name": name, "points": pts,
                      "width_m": round(cw.a1 - cw.a0, 2), "length_m": round(far - near, 2),
                      "road_category": "city", "allowed_direction": cw.direction, "speed_limit_kph": None,
                      "banned_classes": [], "stopping_allowed": False, "scale_source": "auto",
                      "speed_uncertainty_pct": cal["speed_uncertainty_pct"], "lanes": cw.lanes})
        cw.name, cw.near, cw.far = name, near, far
    for i, cw in enumerate(cws):
        for side in cw.kerb_sides:
            width = min(4.0, max(3.0, cw.stand_extent.get(side, 0) + 1.5), (cw.a1 - cw.a0) / 2)
            a0, a1 = (cw.a0, cw.a0 + width) if side == "left" else (cw.a1 - width, cw.a1)
            zones.append({"type": "no_parking", "name": f"{cw.name.split(' (')[0]} – {side} kerb",
                          "points": _rect_pixels(gm, a0, a1, cw.near, cw.far)})
    for a in areas:
        a["points"] = _rect_pixels(gm, *a.pop("rect"))
        zones.append(a)
    cfg = {"frame_size": [W, H], "peak_hours": [["07:00", "10:30"], ["16:00", "20:30"]], "rules": {},
           "zones": zones, "lane_lines": [],
           "auto": {"version": 1, "report": report,
                    "camera": {"f": gm.f, "hfov_deg": gm.hfov, "roll_deg": gm.roll, "vp": list(gm.vp),
                               "height_m": gm.scale}}}
    return cfg, report


def _near_limit(gm, cw, H):
    """Along-distance of the bottom of the picture at the carriageway centre (zones stop there)."""
    mid = (cw.a0 + cw.a1) / 2
    # search along values whose pixel lies inside the picture
    for al in np.linspace(cw.l0 - 30, cw.l1, 400):
        p = gm.pixel(np.array([al]), np.array([mid]))[0]
        if np.isfinite(p).all() and p[1] <= H - 1:
            return float(al)
    return cw.l0


def _rect_pixels(gm, a0, a1, near, far):
    """Image corners far-left, far-right, near-right, near-left of a road-plane rectangle."""
    p = gm.pixel(np.array([far, far, near, near]), np.array([a0, a1, a1, a0]))
    far_pts = sorted(p[:2].tolist(), key=lambda q: q[0])
    near_pts = sorted(p[2:].tolist(), key=lambda q: -q[0])
    return [[round(x, 1), round(y, 1)] for x, y in far_pts + near_pts]


def _special_areas(tracks, cws, gm, valid, report):
    """Intersections, U-turn openings, signal queues and bus stops from how vehicles behave."""
    areas = []
    found = report.setdefault("found", {})

    def cw_at(ac):
        for c in cws:
            if c.a0 - 1.0 <= ac <= c.a1 + 1.0:
                return c
        return None

    # --- intersections: motorised tracks that join / leave through a kerb, or turn off the road axis
    joins = defaultdict(list)
    for tr in tracks:
        if tr.cls not in ROAD_USERS or not tr.moving:
            continue
        ok = valid(tr)
        if ok.sum() < 6:
            continue
        al, ac = tr.al[ok], tr.ac[ok]
        for c in cws:
            for side in c.kerb_sides:
                edge = c.a0 if side == "left" else c.a1
                outside = (ac < edge - 1.5) if side == "left" else (ac > edge + 1.5)
                inside = (ac >= c.a0) & (ac <= c.a1)
                # a crossing of the kerb line between "inside" and "well outside" = side-road traffic
                if outside.any() and inside.any():
                    j = np.nonzero(np.diff(outside.astype(int)) != 0)[0]
                    for k in j:
                        joins[(id(c), side)].append(float(al[k]))
    for c in cws:
        for side in c.kerb_sides:
            for grp in _clusters_1d(joins.get((id(c), side), []), gap=15.0):  # one junction mouth = one area
                if len(grp) < 4:
                    continue
                lo, hi = min(grp) - 6, max(grp) + 6
                half = (c.a1 - c.a0) / 2
                rect = (c.a0, c.a0 + half, lo, hi) if side == "left" else (c.a1 - half, c.a1, lo, hi)
                areas.append({"type": "intersection", "name": f"Junction {len([a for a in areas if a['type'] == 'intersection']) + 1}",
                              "rect": rect, "_cw": c, "_span": (lo, hi)})
    found["intersections"] = sum(1 for a in areas if a["type"] == "intersection")

    # --- U-turns: one vehicle moving in opposite directions in two carriageways
    uturns = []
    if len(cws) > 1:
        for tr in tracks:
            if tr.cls not in ROAD_USERS or not tr.moving:
                continue
            ok = valid(tr)
            if ok.sum() < 10:
                continue
            al, ac = tr.al[ok], tr.ac[ok]
            cs = [cw_at(a) for a in ac]
            ids = {id(c) for c in cs if c is not None}
            if len(ids) >= 2 and np.ptp(al) > 3:
                # where it changes carriageway (it may cross the median gap, where cw_at() is None, in between)
                on = [i for i, c in enumerate(cs) if c is not None]
                k = next((on[n] for n in range(1, len(on)) if cs[on[n]] is not cs[on[n - 1]]), None)
                if k is not None:
                    uturns.append(float(al[k]))
    for grp in _clusters_1d(uturns, gap=10.0):
        if len(grp) < 3:
            continue
        lo, hi = min(grp) - 8, max(grp) + 8
        a, b = cws[0], cws[-1]
        mid_a, mid_b = (a.a0 + a.a1) / 2, (b.a0 + b.a1) / 2
        areas.append({"type": "uturn", "name": f"U-turn {sum(1 for a in areas if a['type'] == 'uturn') + 1}", "rect": (mid_a, mid_b, lo, hi)})
    found["uturns"] = sum(1 for a in areas if a["type"] == "uturn")

    # --- standing behaviour (positions + times) for signals and bus stops
    def stands(tr, max_kph=3.0, min_sec=6.0):
        ok = valid(tr)
        if ok.sum() < 8:
            return []
        t, al, ac = tr.t[ok], tr.al[ok], tr.ac[ok]
        out, i = [], 0
        while i < len(t):
            j = i
            while j + 1 < len(t) and math.hypot(al[j + 1] - al[i], ac[j + 1] - ac[i]) < max_kph / 3.6 * max(1.0, t[j + 1] - t[i]) + 1.5:
                j += 1
            if t[j] - t[i] >= min_sec:
                out.append((t[i], t[j], float(np.median(al[i:j + 1])), float(np.median(ac[i:j + 1]))))
            i = j + 1
        return out

    # signal queues: at one moment most motorised vehicles of a carriageway stand, with the same queue head
    by_time = defaultdict(list)
    for tr in tracks:
        if tr.cls not in ROAD_USERS:
            continue
        for t0, t1, al, ac in stands(tr, min_sec=8.0):
            c = cw_at(ac)
            if c is not None:
                for tt in np.arange(math.ceil(t0), t1, 2.0):
                    by_time[(id(c), int(tt))].append(al)
    present = defaultdict(int)
    for tr in tracks:
        if tr.cls not in ROAD_USERS:
            continue
        ok = valid(tr)
        for tt in set(int(x) // 2 * 2 for x in tr.t[ok]):
            c = cw_at(float(np.median(tr.ac[ok]))) if ok.any() else None
            if c is not None:
                present[(id(c), tt)] += 1
    heads = defaultdict(list)
    for (cid, tt), als in by_time.items():
        if len(als) >= 5 and len(als) >= 0.7 * max(1, present.get((cid, tt), 0)):
            c = next(c for c in cws if id(c) == cid)
            heads[cid].append(min(als) if c.sign > 0 else max(als))  # the queue's front, in driving direction
    for c in cws:
        for grp in _clusters_1d(heads.get(id(c), []), gap=6.0):
            if len(grp) < 8:  # several seconds of a full stop at the same place
                continue
            head = float(np.median(grp))
            lo, hi = (head, head + 45) if c.sign > 0 else (head - 45, head)  # queue extends upstream
            areas.append({"type": "signal", "name": f"Signal queue {len([a for a in areas if a['type'] == 'signal']) + 1}",
                          "rect": (c.a0, c.a1, lo, hi)})
    found["signal_queues"] = sum(1 for a in areas if a["type"] == "signal")

    # bus stops: buses standing repeatedly at the same place
    bus_stands = defaultdict(list)
    for tr in tracks:
        if tr.cls != "Bus":
            continue
        for t0, t1, al, ac in stands(tr, min_sec=6.0):
            c = cw_at(ac)
            if c is not None:
                bus_stands[id(c)].append(al)
    hotspots = []
    for c in cws:
        for grp in _clusters_1d(bus_stands.get(id(c), []), gap=15.0):
            if len(grp) < 2:
                continue
            lo, hi = min(grp) - 8, max(grp) + 8
            # valid only just after an intersection, in the direction of traffic
            after = None
            for a in areas:
                if a["type"] != "intersection" or a.get("_cw") is not c:
                    continue
                jlo, jhi = a["_span"]
                # distance from the junction's exit edge to the stop's entry edge, in the driving direction:
                # traffic moving away (along grows) leaves the junction at jhi; toward the camera at jlo
                gap = (lo - jhi) if c.sign > 0 else (jlo - hi)
                if -2 <= gap <= BUS_STOP_MAX_AFTER_M:
                    after = a["name"]
            side = c.kerb_sides[0] if c.kerb_sides else "right"
            half = min(4.0, (c.a1 - c.a0) / 2)
            rect = (c.a0, c.a0 + half, lo, hi) if side == "left" else (c.a1 - half, c.a1, lo, hi)
            if after:
                areas.append({"type": "bus_stop", "name": f"Bus stop after {after}", "rect": rect, "approved": False})
            else:
                hotspots.append({"buses": len(grp), "along_m": [round(lo, 1), round(hi, 1)]})
    found["bus_stops"] = sum(1 for a in areas if a["type"] == "bus_stop")
    if hotspots:
        report["notes"].append(f"{len(hotspots)} place(s) where buses stop repeatedly but there is no intersection "
                               f"just before: not marked as bus stops, so buses standing there are reported (V1).")
    report["bus_hotspots"] = hotspots
    for a in areas:
        a.pop("_cw", None)
        a.pop("_span", None)
    return areas


def overlay(frame, cfg, gm=None):
    """Preview image of a proposed config drawn on a frame (for the editor and reports)."""
    from violations.zones import camera_config_from_dict
    h, w = frame.shape[:2]
    cam = camera_config_from_dict(cfg, w, h, require_road=False)
    img = frame.copy()
    cam.draw(img, max(1.0, h / 1080))
    return img
