"""One camera's per-frame processing: detect + track -> road-plane position and speed -> violation rules ->
annotated display frame. Used by both the dashboard workers and the command-line tool."""

import time
from collections import Counter, defaultdict, deque
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field

import cv2
import numpy as np

from violations import Observation, ViolationEngine
from violations.base import MOTORISED
from violations.zones import draw_label

from .camera_motion import CameraMotion
from .speed import SpeedEstimator

VIOLATION_COLOR = (0, 0, 255)
NO_SPEED_COLOR = (180, 180, 180)
SLOW_KPH, FAST_KPH = 30, 60
LEARN_MIN_M = 8.0          # a track counts toward a zone's direction statistics after moving this far along it
FORGET_SEC = 10.0
# Positions are only trusted where one pixel of the detector's input covers at most this many metres of road.
MAX_M_PER_MODEL_PX = 0.5
RELIABLE_COLOR = (255, 255, 0)
TRAIL_SEC = 8.0            # path drawn on the evidence image
HEADING_MIN_M = 3.0        # net movement along the zone before a vehicle's heading is known
SHAPE_SEC = 1.5            # a box suddenly much flatter than in the last SHAPE_SEC has its bottom hidden...
FLATTER = 0.85             # ...when height/width drops below this share of the recent typical value
SHAPE_RESET_SEC = 2.0      # flatter for this long: it really changed shape (turned), accept the new one
VIEW_COLORS = {"compensated": (0, 200, 255), "unverified": (200, 200, 200), "lost": (0, 0, 255)}


def speed_color(kph):
    if kph < SLOW_KPH:
        return 0, 220, 0
    if kph < FAST_KPH:
        return 0, 165, 255
    return 0, 0, 255


def bottom_occluded(boxes, min_overlap=0.3, margin_px=2.0):
    """For each box: is its bottom edge covered by a nearer vehicle's box? On a flat road, the box whose bottom
    edge is lower in the picture is nearer to the camera and in front of the other."""
    if len(boxes) < 2:
        return [False] * len(boxes)
    b = np.float32(boxes)
    x1, y1, x2, y2 = b[:, 0:1], b[:, 1:2], b[:, 2:3], b[:, 3:4]
    overlap = np.minimum(x2, x2.T) - np.maximum(x1, x1.T)          # [i, j]: horizontal overlap of i and j
    nearer = y2.T > y2 + margin_px                                  # j's bottom below i's bottom
    covers = y1.T < y2 - margin_px                                  # j's top above i's bottom edge
    hit = (overlap > min_overlap * (x2 - x1)) & nearer & covers
    np.fill_diagonal(hit, False)
    return hit.any(axis=1).tolist()


def zones_roi(camera, w, h):
    """Pixel rectangle around all zones, with room above the far edge for the tops of vehicle boxes.

    Detecting only inside it is faster, and far-away vehicles get more pixels at the same model input size.
    Returns the full frame when the zones cover most of it anyway."""
    pts = np.concatenate([r.poly for r in camera.roads] + [a.poly for a in camera.areas] +
                         [ln.pts for ln in camera.lines])
    x0, y0 = pts.min(axis=0)
    x1, y1 = pts.max(axis=0)
    x0, x1 = max(0, int(x0 - 0.04 * w)), min(w, int(x1 + 0.04 * w))
    y0, y1 = max(0, int(y0 - 0.12 * h)), min(h, int(y1 + 0.03 * h))
    if (x1 - x0) * (y1 - y0) > 0.85 * w * h or x1 - x0 < 64 or y1 - y0 < 64:
        return 0, 0, w, h
    return x0, y0, x1, y1


def reliable_limits(camera, roi, imgsz, max_m_per_model_px=MAX_M_PER_MODEL_PX):
    """{road zone: metres from its far edge where reliable measurement starts}.

    The detector sees the detection area scaled so its longer side is `imgsz` pixels, so one detector pixel is
    (roi size / imgsz) frame pixels; box edges are only that precise."""
    x0, y0, x1, y1 = roi
    frame_px_per_model_px = max(x1 - x0, y1 - y0) / imgsz
    return {id(r): r.reliable_from(max_m_per_model_px / frame_px_per_model_px) for r in camera.roads}


@dataclass
class FrameResult:
    display: np.ndarray
    events: list
    tracks: int
    fps: float
    timings: dict = field(default_factory=dict)


class Pipeline:
    def __init__(self, detector, camera, frame_size, start_time=None, is_live=False, helmet=None,
                 overrides=None, only=None, min_frames=3, auto_roi=True, display_width=1280, min_speed_fps=6.0,
                 plates=None, reference=None, stabilize=True):
        """plates: optional surveillance.anpr.PlateCollector - keeps each motor vehicle's best full-resolution
        crops so the plates of violating vehicles can be read.
        reference: the clean frame the zones were drawn on (BGR); without it the first frame is taken as the view
        the zones belong to. stabilize: follow camera movement (surveillance/camera_motion.py)."""
        self.det, self.camera, self.plates = detector, camera, plates
        self.W, self.H = frame_size
        self.roi_ref = zones_roi(camera, self.W, self.H) if auto_roi else (0, 0, self.W, self.H)
        self.roi = self.roi_ref   # detection area in the current view (follows the camera when it moves)
        self.stabilize, self.reference = stabilize, reference
        self.motion = self._pool = None
        self._boxes = []          # last frame's vehicle boxes: masked out when measuring camera movement
        self.reliable_y = reliable_limits(camera, self.roi, detector.imgsz)
        for r in camera.roads:  # rules that need a safety margin beyond it read it from the zone
            r.reliable_from_m = self.reliable_y[id(r)]
        self.start_time, self.is_live = start_time, is_live
        self.min_frames, self.min_speed_fps = min_frames, min_speed_fps
        self.speeds = SpeedEstimator()
        self.engine = ViolationEngine(camera, overrides, only, helmet)
        # [web] speeds on the video only when this run checks V2 (the web's other-violations box does not; the
        # rules still use the speeds internally to tell stopped from moving vehicles)
        self.show_speeds = any(r.code == "V2" for r in self.engine.rules)
        for r in camera.roads:  # [web] the zone's label then leaves out its speed category and limit
            r.show_speed = self.show_speeds
        self.votes = defaultdict(Counter)
        self.trails = defaultdict(deque)  # tid -> (t, x, y) bottom-centre points, for the evidence image
        self.shapes = defaultdict(deque)  # tid -> (t, height / width) of boxes whose bottom edge was visible
        self.flat_since = {}              # tid -> time its box became suspiciously flat
        self.last_seen = {}
        self.directions = {r.name: Counter() for r in camera.roads}  # zone -> {"toward": n, "away": n}
        self._counted = set()
        self.s = min(1.0, display_width / self.W)
        self.dw, self.dh = int(self.W * self.s) // 2 * 2, int(self.H * self.s) // 2 * 2
        self.ui = max(0.55, self.dh / 900)
        self.frames = 0
        self.fps = 0.0
        self._t_prev = None
        self.speed_paused = False

    def process(self, frame, t, wall=None):
        """frame: BGR at frame_size; t: seconds (video time, or capture time for live)."""
        timings = {}
        t0 = time.perf_counter()
        self.frames += 1
        if self._t_prev is not None and t > self._t_prev:
            inst = 1.0 / (t - self._t_prev)
            self.fps = inst if self.fps == 0 else 0.9 * self.fps + 0.1 * inst
        self._t_prev = t
        # Live camera too slow for reliable speeds (needs several samples per 1 s window): pause V2, say so.
        self.speed_paused = self.is_live and self.frames > 30 and self.fps < self.min_speed_fps
        suspended = {"V2"} if self.speed_paused else set()
        # Camera movement is measured on the CPU while the detector runs (on the Neural Engine / GPU when
        # available); the detection area is the one placed after the previous frame (padding covers a frame of
        # movement).
        job = None
        if self.stabilize:
            if self.motion is None:
                self._start_motion(frame)
            job = self._pool.submit(self.motion.update, frame, t, self._boxes)

        x0, y0, x1, y1 = roi = self.roi
        tracks = self.det.track(frame[y0:y1, x0:x1] if roi != (0, 0, self.W, self.H) else frame)
        timings["detect_ms"] = (time.perf_counter() - t0) * 1e3
        if job is not None:
            t_m = time.perf_counter()
            before = self.motion.state
            job.result()
            self._after_motion(before)
            timings["motion_wait_ms"] = (time.perf_counter() - t_m) * 1e3
            if not self.motion.enforce:   # zones do not match the picture: no violation can be judged
                suspended = {r.code for r in self.engine.rules}
        self.engine.suspended = suspended
        view_lost = self.motion is not None and not self.motion.enforce
        moved = self.motion is not None and not self.motion.identity

        t1 = time.perf_counter()
        observations, shown = [], []
        hidden_foot = bottom_occluded([b for b, _, _ in tracks])
        for k, ((bx1, by1, bx2, by2), tid, cname) in enumerate(tracks):
            bx1, bx2, by1, by2 = bx1 + x0, bx2 + x0, by1 + y0, by2 + y0
            point = ((bx1 + bx2) / 2, by2)   # ground point, in the zones' (reference) view from here on
            if moved:
                point = tuple(float(v) for v in self.motion.to_ref(point)[0])
            road = None if view_lost else self.camera.road_at(point)
            coarse = None
            if road:
                # A box cut off by the frame / detection-area edge has a wrong bottom-centre: keep the last speed.
                # ... and so does a box whose bottom edge is hidden behind a nearer vehicle (the detector boxes
                # only the visible part, so the bottom edge - the ground point - jumps up the road by metres)
                clipped = (bx1 <= x0 + 1 or bx2 >= x1 - 2 or by2 >= y1 - 2 or hidden_foot[k]
                           or self._foot_hidden(tid, t, bx1, by1, bx2, by2, by2 >= y1 - 2))
                coarse = None if clipped else tuple(float(v) for v in road.to_metres(point))
            precise = coarse is not None and coarse[1] >= self.reliable_y[id(road)]
            votes = self.votes[tid]
            votes[cname] += 1
            major, n_major = votes.most_common(1)[0]
            n = sum(votes.values())
            self.last_seen[tid] = t
            trail = self.trails[tid]
            trail.append((t, point[0], point[1]))
            while trail and t - trail[0][0] > TRAIL_SEC:
                trail.popleft()
            kph = xy = section = None
            heading = 0
            if road:
                # too far away to measure: no speed, direction or stopping from here (coarse position only)
                xy = coarse if precise else None
                if xy is None:
                    kph = self.speeds.current(tid) if self.speeds.zone.get(tid) is road else None
                else:
                    kph = self.speeds.update(tid, t, road, xy)
                    self._learn_direction(tid, road)
                section = self.speeds.section(tid, road)
                if self.speeds.zone.get(tid) is road:
                    dy = self.speeds.displacement_y(tid)
                    heading = (1 if dy > 0 else -1) if abs(dy) >= HEADING_MIN_M else 0
            box = (int(bx1), int(by1), int(round(bx2)), int(round(by2)))   # whole pixels for crops and drawing
            shown.append((tid, major, n, box, kph))
            if self.plates is not None and road is not None and major in MOTORISED and by2 < y1 - 2:
                self.plates.observe(tid, frame, box, t, major)   # [web] the class, for the passed-vehicle list
            if n >= self.min_frames:
                observations.append(Observation(
                    tid=tid, frame_idx=self.frames, time_s=t, cls=major, purity=n_major / n, n_frames=n,
                    bbox=box, point=point, road=road, xy=xy, kph=kph, section=section,
                    areas=frozenset() if view_lost else self.camera.areas_at(point), heading=heading,
                    xy_coarse=coarse))
        self._boxes = [b for _, _, _, b, _ in shown]
        events = self.engine.process(observations, frame, self.frames, t, wall)
        for ev in events:
            if ev.frame is None:  # evidence is this frame: add where the vehicle came from
                ev.path = [(x, y) for _, x, y in self.trails.get(ev.obs.tid, ())]
                if moved and ev.path:   # trail is kept in zone coordinates; the photo is the current view
                    ev.path = [tuple(map(float, p)) for p in self.motion.to_frame(ev.path)]
            if moved:   # on record: positions were corrected for camera movement
                ev.details["camera_view"] = self.motion.describe()
        if self.plates is not None:
            self.plates.tick(t, {tid for tid, *_ in shown})
        for tid in [k for k, s in self.last_seen.items() if t - s > FORGET_SEC]:
            del self.last_seen[tid]
            self.votes.pop(tid, None)
            self.trails.pop(tid, None)
            self.shapes.pop(tid, None)
            self.flat_since.pop(tid, None)
            self.speeds.forget(tid)
        timings["rules_ms"] = (time.perf_counter() - t1) * 1e3

        t2 = time.perf_counter()
        display = self.draw(frame, shown, t, wall)
        timings["draw_ms"] = (time.perf_counter() - t2) * 1e3
        return FrameResult(display, events, len(tracks), self.fps, timings)

    def _foot_hidden(self, tid, t, bx1, by1, bx2, by2, cut):
        """Whether the box's bottom edge is hidden although no nearer box was detected over it (the vehicle in
        front was missed, or is itself hidden): the box is suddenly much flatter than this track's recent boxes -
        a hidden lower part makes it shorter, not narrower."""
        ratio = (by2 - by1) / max(1.0, bx2 - bx1)
        hist = self.shapes[tid]
        while hist and t - hist[0][0] > SHAPE_SEC:
            hist.popleft()
        flat = len(hist) >= 4 and ratio < FLATTER * float(np.median([r for _, r in hist]))
        if flat:
            since = self.flat_since.setdefault(tid, t)
            if t - since < SHAPE_RESET_SEC:
                return True
            hist.clear()   # flatter for a long time: it turned, or the earlier boxes were the odd ones
        self.flat_since.pop(tid, None)
        if not cut:
            hist.append((t, ratio))
        return False

    def _start_motion(self, frame):
        ref = self.reference
        if ref is None or ref.shape[:2] != frame.shape[:2]:
            ref = cv2.resize(ref, (self.W, self.H)) if ref is not None else frame
        polys = [r.poly for r in self.camera.roads] + [a.poly for a in self.camera.areas]
        self.motion = CameraMotion(ref, polys)
        self._pool = ThreadPoolExecutor(1, thread_name_prefix="camera-motion")

    def close(self):
        if self._pool is not None:
            self._pool.shutdown(wait=False)

    def _after_motion(self, before):
        if self.motion.state == "lost" and before != "lost":
            # whatever was measured before is in a view that no longer exists: start over when it is back
            self.engine.reset()
            self.speeds = SpeedEstimator()
            self.trails.clear()
        self.roi = self._frame_roi()

    def _frame_roi(self):
        """The detection area moved along with the camera."""
        if self.motion is None or self.motion.identity or self.roi_ref == (0, 0, self.W, self.H):
            return self.roi_ref
        x0, y0, x1, y1 = self.roi_ref
        c = self.motion.to_frame([[x0, y0], [x1, y0], [x1, y1], [x0, y1]])
        x0, y0 = np.maximum(c.min(axis=0), 0).astype(int)
        x1, y1 = np.minimum(c.max(axis=0), [self.W, self.H]).astype(int)
        if x1 - x0 < 64 or y1 - y0 < 64:
            return 0, 0, self.W, self.H
        return int(x0), int(y0), int(x1), int(y1)

    def view_status(self):
        """Camera movement relative to the zones' view (None when not followed)."""
        return self.motion.describe() if self.motion is not None else None

    def _learn_direction(self, tid, road):
        key = (tid, road.name)
        if key in self._counted:
            return
        dy = self.speeds.displacement_y(tid)
        if abs(dy) >= LEARN_MIN_M:
            self._counted.add(key)
            self.directions[road.name]["toward" if dy > 0 else "away"] += 1

    def direction_suggestions(self, min_vehicles=20, one_way_share=0.9):
        """Per road zone: counts and a suggested allowed_direction (only when traffic is clearly one-way)."""
        out = {}
        for name, c in self.directions.items():
            total = c["toward"] + c["away"]
            suggestion = None
            if total >= min_vehicles:
                share = max(c["toward"], c["away"]) / total
                if share >= one_way_share:
                    suggestion = "toward_camera" if c["toward"] > c["away"] else "away_from_camera"
                elif share <= 0.75:
                    suggestion = "both"
            out[name] = {"toward": c["toward"], "away": c["away"], "suggestion": suggestion}
        return out

    def draw(self, frame, shown, t, wall):
        s, ui = self.s, self.ui
        disp = cv2.resize(frame, (self.dw, self.dh), interpolation=cv2.INTER_LINEAR) if s < 1 else frame.copy()
        m = self.motion
        if m is None or m.identity:
            self._draw_zones(disp, s, ui)
        else:  # draw the zones in their own view, then move that drawing onto the current view
            A, Ai = m.A.copy(), m.Ainv.copy()
            A[:, 2] *= s
            Ai[:, 2] *= s
            size = (self.dw, self.dh)
            ref_view = cv2.warpAffine(disp, A, size)
            layer = ref_view.copy()
            self._draw_zones(layer, s, ui)
            changed = np.any(layer != ref_view, axis=2).astype(np.uint8) * 255
            back = cv2.warpAffine(layer, Ai, size)
            mask = cv2.warpAffine(changed, Ai, size, flags=cv2.INTER_NEAREST) > 0
            disp[mask] = back[mask]
        x0, y0, x1, y1 = (int(v * s) for v in self.roi)
        if (x0, y0, x1, y1) != (0, 0, self.dw, self.dh):
            cv2.rectangle(disp, (x0, y0), (x1 - 1, y1 - 1), (90, 90, 90), 1)
        for tid, major, n, (bx1, by1, bx2, by2), kph in shown:
            codes = self.engine.flagged.get(tid)
            show_speed = self.show_speeds and kph is not None and n >= self.min_frames  # [web] show_speeds
            col = VIOLATION_COLOR if codes else (speed_color(kph) if show_speed else NO_SPEED_COLOR)
            p1, p2 = (int(bx1 * s), int(by1 * s)), (int(bx2 * s), int(by2 * s))
            cv2.rectangle(disp, p1, p2, col, max(1, round((3 if codes else 1.5) * ui)))
            label = f"{major} #{tid}" + (f" {kph:.0f}km/h" if show_speed else "")
            if codes:
                label += " " + " ".join(codes)
            draw_label(disp, label, (p1[0], p1[1] - 4), col, 0.42 * ui, 1)
        stamp = wall.strftime("%Y-%m-%d %H:%M:%S") if wall else f"t={t:7.1f}s"
        draw_label(disp, f"{stamp}  {self.fps:4.1f} FPS", (10, int(26 * ui)), (255, 255, 255), 0.6 * ui)
        line = 56
        if self.speed_paused and self.show_speeds:  # [web] show_speeds
            draw_label(disp, "Speed check paused: frame rate too low", (10, int(line * ui)), (0, 165, 255), 0.6 * ui)
            line += 30
        if m is not None and m.state != "stable":
            text = {"compensated": f"Camera moved {m.shift_px:.0f} px / zoom {m.zoom:.2f}: zones re-aligned",
                    "unverified": "Camera view not verified (low contrast): assuming it has not moved",
                    "lost": "Camera view changed: zones do not match - enforcement paused"}[m.state]
            draw_label(disp, text, (10, int(line * ui)), VIEW_COLORS[m.state], 0.6 * ui)
        return disp

    def _draw_zones(self, img, s, ui):
        """Zones and the reliable-measurement lines, in the zones' own (reference) coordinates."""
        self.camera.draw(img, ui * 0.8, s)
        for r in self.camera.roads if self.show_speeds else ():  # where reliable measurement starts ([web] V2 only)
            y = self.reliable_y[id(r)]
            if 0 < y < r.length_m:
                a, b = (tuple(map(int, p)) for p in r.to_pixels([[0, y], [r.width_m, y]]) * s)
                cv2.line(img, a, b, RELIABLE_COLOR, max(1, round(2 * ui)), cv2.LINE_AA)
