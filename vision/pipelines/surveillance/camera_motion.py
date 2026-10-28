"""Keeps the zones on the road when the camera moves.

Zones are drawn on one view of the scene (the reference). A pole swaying in the wind, a bumped or re-aimed camera,
a PTZ preset that does not return exactly, or a handheld recording all shift the picture, and the zones would then
measure the wrong part of the road. Every frame (every 5th once the camera has proved steady) this estimates the
shift / zoom / rotation from the current view to the reference, vehicles masked out, so the pipeline can measure
every vehicle in reference coordinates: optical flow of background corners from frame to frame (cheap), and at
least once a second a direct ORB + RANSAC match to the reference itself (precise; removes accumulated drift).

States
  stable       the view matches the reference (fixed camera): nothing to correct
  compensated  the view moved; positions are mapped back, zones stay on the road
  unverified   the view could not be matched just now (night, rain, glare); the camera was steady, so it is
               assumed not to have moved and enforcement continues
  lost         the view moved and cannot be matched, or the zones have left the picture: enforcement pauses
"""

import math
from pathlib import Path

import cv2
import numpy as np

STEADY_CHECKS = 50       # after this many steady checks in a row, check only every 5th frame
LOST_AFTER_SEC = 2.0     # no match this long after the view was seen moving: zones cannot be trusted
MIN_INLIERS = 20
ANCHOR_SEC = 1.0         # match to the reference at least this often (between: optical flow)
REANCHOR_SEC = 60.0      # refresh the reference (slow lighting change) at most this often
MIN_IN_VIEW = 0.5        # share of the zones' area that must still be in the picture


def reference_path(data_dir, camera_id, version):
    """Where the clean frame a zone version was drawn on / learned from is kept."""
    return Path(data_dir) / "zone_refs" / f"cam{camera_id}_v{version}.jpg"


def save_reference(data_dir, camera_id, version, frame):
    p = reference_path(data_dir, camera_id, version)
    p.parent.mkdir(parents=True, exist_ok=True)
    cv2.imwrite(str(p), frame, [cv2.IMWRITE_JPEG_QUALITY, 92])
    return p


def load_reference(data_dir, camera_id, version):
    p = reference_path(data_dir, camera_id, version)
    return cv2.imread(str(p)) if p.is_file() else None


def _rigid(M):
    """zoom, rotation (deg) of a 2x3 similarity transform."""
    return math.hypot(M[0, 0], M[1, 0]), math.degrees(math.atan2(M[1, 0], M[0, 0]))


def _compose(A, B):
    """A after B (2x3 affines)."""
    A3, B3 = np.vstack([A, [0, 0, 1]]), np.vstack([B, [0, 0, 1]])
    return (A3 @ B3)[:2]


def _invert(A):
    return cv2.invertAffineTransform(A)


class CameraMotion:
    def __init__(self, reference, zone_polys=(), work_width=640, n_features=2000):
        """reference: BGR frame (pipeline frame size) the zones belong to; zone_polys: their pixel polygons -
        mostly road, where traffic moves, so features there are only used when the background has too few."""
        self.H, self.W = reference.shape[:2]
        self.k = min(1.0, work_width / self.W)
        self.orb = cv2.ORB_create(n_features, fastThreshold=10)
        self.matcher = cv2.BFMatcher(cv2.NORM_HAMMING)
        self.zone_polys = [np.float32(p) for p in zone_polys]
        self._set_reference(reference, self.zone_polys)
        self.base = np.float32([[1, 0, 0], [0, 1, 0]])   # current reference -> zone coordinates
        self.A = self.base.copy()                         # current frame -> zone coordinates
        self.Ainv = self.A.copy()
        self.state, self.inliers, self.in_view = "stable", 0, 1.0
        self.shift_px, self.zoom, self.rotation_deg = 0.0, 1.0, 0.0
        self.steady, self.n = 0, 0
        self.last_ok_t = self.last_move_t = self.anchor_t = None
        self.checked = False   # whether the last update() actually measured
        self.prev_gray = self.prev_pts = None   # optical flow state
        self.anchor_due = None                  # next absolute match to the reference (video time)

    # ------------------------------------------------------------ features
    def _gray(self, frame):
        g = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY) if frame.ndim == 3 else frame
        if self.k < 1:
            g = cv2.resize(g, (round(self.W * self.k), round(self.H * self.k)), interpolation=cv2.INTER_AREA)
        return cv2.equalizeHist(g)   # some robustness to exposure changes

    def _set_reference(self, frame, polys):
        """polys: the zones in this frame's pixels."""
        g = self._gray(frame)
        mask = np.full(g.shape, 255, np.uint8)
        for p in polys:
            cv2.fillPoly(mask, [np.int32(p * self.k)], 0)
        kp, des = self.orb.detectAndCompute(g, mask)
        if des is None or len(kp) < 150:   # the zones fill most of the view: use everything, RANSAC sorts it out
            kp, des = self.orb.detectAndCompute(g, None)
        self.ref_pts = np.float32([p.pt for p in kp]) if kp else np.zeros((0, 2), np.float32)
        self.ref_des = des

    def _mask(self, shape, boxes):
        mask = np.full(shape, 255, np.uint8)
        for x1, y1, x2, y2 in boxes:   # vehicles move on their own: their features say nothing about the camera
            cv2.rectangle(mask, (int(x1 * self.k) - 2, int(y1 * self.k) - 2),
                          (int(x2 * self.k) + 2, int(y2 * self.k) + 2), 0, -1)
        return mask

    def _match_reference(self, g, mask):
        """Absolute: current view -> reference, from ORB features (precise, ~20 ms)."""
        if self.ref_des is None or len(self.ref_des) < MIN_INLIERS:
            return None, 0
        kp, des = self.orb.detectAndCompute(g, mask)
        if des is None or len(kp) < MIN_INLIERS:
            return None, 0
        good = []
        for m in self.matcher.knnMatch(des, self.ref_des, k=2):
            if len(m) == 2 and m[0].distance < 0.8 * m[1].distance:
                good.append(m[0])
        if len(good) < MIN_INLIERS:
            return None, 0
        src = np.float32([kp[m.queryIdx].pt for m in good])
        dst = self.ref_pts[[m.trainIdx for m in good]]
        M, inl = cv2.estimateAffinePartial2D(src, dst, method=cv2.RANSAC, ransacReprojThreshold=2.5,
                                             maxIters=2000, confidence=0.995)
        if M is None:
            return None, 0
        n = int(inl.sum())
        if n < MIN_INLIERS or n < 0.15 * len(good):
            return None, n
        M = M.astype(np.float32)
        M[:, 2] /= self.k   # work resolution -> full resolution (similarity part is scale-free)
        return M, n

    def _track_points(self, g, mask):
        """Relative: current view -> previous view, by optical flow of background corners (~3 ms)."""
        if self.prev_gray is None or self.prev_pts is None or len(self.prev_pts) < MIN_INLIERS:
            return None, 0
        p1, st, _ = cv2.calcOpticalFlowPyrLK(self.prev_gray, g, self.prev_pts, None, winSize=(21, 21), maxLevel=3)
        if p1 is None:
            return None, 0
        ok = st.ravel() == 1
        xy = np.int32(np.round(p1.reshape(-1, 2)))
        inside = (xy[:, 0] >= 0) & (xy[:, 1] >= 0) & (xy[:, 0] < g.shape[1]) & (xy[:, 1] < g.shape[0])
        ok &= inside
        ok[inside] &= mask[xy[inside, 1], xy[inside, 0]] > 0   # now covered by a vehicle: not background
        if ok.sum() < MIN_INLIERS:
            return None, 0
        R, inl = cv2.estimateAffinePartial2D(p1[ok], self.prev_pts[ok], method=cv2.RANSAC,
                                             ransacReprojThreshold=1.0)
        if R is None:
            return None, 0
        inl = inl.ravel() == 1
        n = int(inl.sum())
        if n < MIN_INLIERS or n < 0.5 * ok.sum():
            return None, n
        self.prev_pts = p1[ok][inl]
        R = R.astype(np.float32)
        R[:, 2] /= self.k
        return R, n

    def _close(self, A, B, tol_px=1.5):
        """Whether two transforms put every corner of the picture within tol_px of each other."""
        c = np.float32([[0, 0], [self.W, 0], [self.W, self.H], [0, self.H]])
        return float(np.abs((c @ A[:, :2].T + A[:, 2]) - (c @ B[:, :2].T + B[:, 2])).max()) < tol_px

    # ------------------------------------------------------------ per frame
    def update(self, frame, t, exclude_boxes=()):
        """Call once per frame (BGR at the pipeline's frame size). Returns self.

        Frame to frame the view is followed by optical flow; at least every ANCHOR_SEC (and whenever the flow
        fails) it is matched to the reference itself, which also removes any drift the flow accumulated."""
        self.n += 1
        self.checked = False
        if self.steady >= STEADY_CHECKS and self.n % 5 and self.state == "stable":
            self.prev_gray = None   # the flow chain is broken: the next check is an absolute one
            return self
        self.checked = True
        g = self._gray(frame)
        mask = self._mask(g.shape, exclude_boxes)
        A, n, absolute = None, 0, False
        if self.anchor_due is not None and t < self.anchor_due:
            R, n = self._track_points(g, mask)
            if R is not None:
                A = _compose(self.A, R)
        if A is None:
            M, n = self._match_reference(g, mask)
            if M is not None:
                A, absolute = _compose(self.base, M), True
                self.anchor_due = t + ANCHOR_SEC
            else:
                self.anchor_due = None   # try again next frame
        self.inliers = n
        if A is not None:
            if self._close(A, self.base):
                A = self.base.copy()   # steady camera: no jitter from estimation noise
            # no smoothing: it would lag behind a moving camera and turn the lag into fake vehicle speed
            if not self._close(A, self.A, 3.0):
                self.last_move_t = t
            self.A, self.Ainv = A.astype(np.float32), _invert(A.astype(np.float32))
            self.last_ok_t = t
            if absolute:
                # slow lighting change: re-anchor on the current view while it still matches well
                if self.anchor_t is not None and n < 60 and t - self.anchor_t > REANCHOR_SEC:
                    self._set_reference(frame, [self.to_frame(p) for p in self.zone_polys])
                    self.base = self.A.copy()
                    self.anchor_t = t
                self.anchor_t = t if self.anchor_t is None else self.anchor_t
            if absolute or self.prev_pts is None or len(self.prev_pts) < 120:
                self.prev_pts = cv2.goodFeaturesToTrack(g, 400, 0.01, 8, mask=mask)
            self.prev_gray = g
        else:
            self.prev_gray = self.prev_pts = None
        zoom, rot = _rigid(self.A)
        c = np.float32([self.W / 2, self.H / 2])
        self.shift_px = float(np.linalg.norm(self.A[:, :2] @ c + self.A[:, 2] - c))
        self.zoom, self.rotation_deg = zoom, rot
        self.in_view = self._in_view()
        moved = self.shift_px >= 3 or abs(zoom - 1) >= 0.005 or abs(rot) >= 0.2
        if A is None:
            # a camera seen moving recently, or standing well off its reference view, may be moving right now
            recently_moving = (self.last_move_t is not None and t - self.last_move_t < 10) or self.shift_px > 15
            stale = self.last_ok_t is None or t - self.last_ok_t > LOST_AFTER_SEC
            self.state = "lost" if (recently_moving and stale) else ("unverified" if stale else self.state)
        else:
            self.state = "compensated" if moved else "stable"
        if self.in_view < MIN_IN_VIEW:
            self.state = "lost"
        self.steady = self.steady + 1 if (self.state == "stable" and A is not None) else 0
        return self

    def _in_view(self):
        if not self.zone_polys:
            return 1.0
        total = inside = 0.0
        for p in self.zone_polys:
            q = self.to_frame(p)
            total += cv2.contourArea(q)
            clipped, _ = cv2.intersectConvexConvex(cv2.convexHull(q),
                                                   np.float32([[0, 0], [self.W, 0], [self.W, self.H], [0, self.H]]))
            inside += clipped
        return inside / total if total > 0 else 1.0

    # ------------------------------------------------------------ mapping
    @property
    def identity(self):
        return bool(np.allclose(self.A, [[1, 0, 0], [0, 1, 0]], atol=1e-4))

    @property
    def enforce(self):
        return self.state != "lost"

    def to_ref(self, pts):
        """Frame pixels -> zone (reference) pixels. pts: (N, 2) or one (x, y)."""
        p = np.float32(pts).reshape(-1, 2)
        return p @ self.A[:, :2].T + self.A[:, 2]

    def to_frame(self, pts):
        p = np.float32(pts).reshape(-1, 2)
        return p @ self.Ainv[:, :2].T + self.Ainv[:, 2]

    def describe(self):
        return {"state": self.state, "shift_px": round(self.shift_px, 1), "zoom": round(self.zoom, 3),
                "rotation_deg": round(self.rotation_deg, 2), "inliers": self.inliers,
                "zones_in_view": round(self.in_view, 2)}
