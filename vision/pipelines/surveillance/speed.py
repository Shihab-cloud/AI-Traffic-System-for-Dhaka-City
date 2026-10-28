"""Per-track speed on the road plane, from timestamps (works with dropped frames and variable frame rates)."""

import math
from collections import defaultdict, deque

import numpy as np


def fit_kph(path):
    """km/h from [(t, x_m, y_m)]: slope of a least-squares line through the positions, refitted without outliers."""
    return float(np.linalg.norm(fit_velocity(path))) * 3.6


def fit_velocity(path):
    """(vx, vy) m/s from [(t, x_m, y_m)] (see fit_kph)."""
    P = np.asarray(path, np.float64)
    tt = P[:, 0] - P[-1, 0]
    A = np.stack([np.ones_like(tt), tt], 1)
    c = np.linalg.lstsq(A, P[:, 1:], rcond=None)[0]
    if len(P) >= 6:
        res = np.linalg.norm(P[:, 1:] - A @ c, axis=1)
        keep = res <= 3 * np.median(res) + 0.05
        if 4 <= keep.sum() < len(P):
            c = np.linalg.lstsq(A[keep], P[keep, 1:], rcond=None)[0]
    return c[1]


class SpeedEstimator:
    """Velocity from a straight-line least-squares fit of the road-plane positions of the last `window_sec`, with
    positions far off the line (a box edge that jumped for a frame) dropped and the line fitted again.

    Measured on tools/bench_accuracy.py (known speeds, realistic detector noise) against the previous estimate
    (distance between the window's end points, then the median of the last 15 of those): mean error 2.6 -> 2.2
    km/h, 95th percentile 10.9 -> 8.3 km/h (steady driving 4.6 -> 3.8), and it lags a braking vehicle less.
    `smooth` > 1 adds a median over that many estimates (not needed: the fit already averages a second)."""

    def __init__(self, window_sec=1.0, smooth=1, max_kph=120.0):
        self.window_sec, self.smooth, self.max_kph = window_sec, smooth, max_kph
        self.min_span = window_sec / 2       # seconds of history needed for the first measurement
        self.zone = {}                       # tid -> zone the track is measured in
        self.path = {}                       # tid -> deque[(t, x_m, y_m)] within the window
        self.recent = {}                     # tid -> recent measurements (km/h)
        self.first, self.last = {}, {}       # tid -> (t, x_m, y_m) first/last position in the zone
        self.stats = defaultdict(lambda: [0.0, 0, 0.0])  # tid -> [sum, count, max] of the shown speed

    def current(self, tid):
        recent = self.recent.get(tid)
        return float(np.median(recent)) if recent else None

    def update(self, tid, t, zone, xy):
        """Add a road-plane position (metres) at time t (s); return the smoothed speed in km/h, or None."""
        pos = (t, float(xy[0]), float(xy[1]))
        if self.zone.get(tid) is not zone:  # new track, or it moved into another zone: start over
            self.zone[tid] = zone
            self.path[tid] = deque()
            self.recent[tid] = deque(maxlen=self.smooth)
            self.first[tid] = pos
        self.last[tid] = pos
        path = self.path[tid]
        path.append(pos)
        while len(path) > 2 and t - path[1][0] >= self.window_sec:
            path.popleft()
        if t - path[0][0] >= self.min_span and len(path) >= 3:
            kph = fit_kph(path)
            if kph <= self.max_kph:
                self.recent[tid].append(kph)
        kph = self.current(tid)
        if kph is not None:
            s = self.stats[tid]
            s[0], s[1], s[2] = s[0] + kph, s[1] + 1, max(s[2], kph)
        return kph

    def section(self, tid, zone):
        """(metres, seconds) travelled in a straight line since entering `zone`, or None."""
        if self.zone.get(tid) is not zone:
            return None
        (t0, x0, y0), (t1, x1, y1) = self.first[tid], self.last[tid]
        return math.hypot(x1 - x0, y1 - y0), t1 - t0

    def displacement_y(self, tid):
        """Net metres along the zone since entering it (+ = toward the camera)."""
        return self.last[tid][2] - self.first[tid][2] if tid in self.first else 0.0

    def forget(self, tid):
        for d in (self.zone, self.path, self.recent, self.first, self.last, self.stats):
            d.pop(tid, None)
