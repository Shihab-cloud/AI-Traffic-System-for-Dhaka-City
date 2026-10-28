"""V5: crossing a SOLID lane line. Changing lanes across a broken line is legal, so only solid lines are drawn.

Dhaka has few painted lane lines; use this on flyovers, the elevated expressway and freshly marked roads.
"""

from collections import deque

import numpy as np

from .base import BaseViolation


class LaneLineCrossing(BaseViolation):
    code = "V5"
    title = "Crossed solid lane line"
    DEFAULTS = {
        "margin_m": 0.6,             # must be this far clear of the line on BOTH sides: straddling is not counted
        "hold_sec": 0.5,             # ...for this long on each side
        "end_margin_m": 1.0,         # crossings beyond the line's ends do not count
        "smooth_samples": 5,
        "min_purity": 0.5,
    }

    def __init__(self, settings=None, camera=None):
        super().__init__(settings, camera)
        self.lines = list(camera.lines) if camera is not None else []
        self.raw = {}    # tid -> (road, deque of xy)
        self.side = {}   # (tid, line index) -> [confirmed side, candidate side, candidate since (s)]

    def update(self, obs, ctx):
        if obs.road is None or obs.xy is None or obs.purity < self.cfg["min_purity"]:
            return None
        lines = [(i, ln) for i, ln in enumerate(self.lines) if ln.road is obs.road]
        if not lines:
            return None
        road, raw = self.raw.get(obs.tid, (None, None))
        if road is not obs.road:
            raw = deque(maxlen=self.cfg["smooth_samples"])
            self.raw[obs.tid] = (obs.road, raw)
        raw.append(np.float64(obs.xy))
        p = np.median(np.float64(raw), axis=0)
        for i, ln in lines:
            lateral, along = ln.measure(p)
            st = self.side.setdefault((obs.tid, i), [0, 0, None])
            if along < -self.cfg["end_margin_m"] or along > ln.length_m + self.cfg["end_margin_m"]:
                st[:] = [0, 0, None]  # beyond the ends: it can go around the line legally
                continue
            if abs(lateral) < self.cfg["margin_m"]:
                continue  # on the line: wait until it is clearly on one side
            s = 1 if lateral > 0 else -1
            if st[1] != s:
                st[1], st[2] = s, obs.time_s
            if obs.time_s - st[2] < self.cfg["hold_sec"]:
                continue
            if st[0] == 0:
                st[0] = s
            elif st[0] != s:
                st[0] = s
                return self.event(obs, {"line": ln.name, "at_m": round(along, 1)})
        return None

    def forget(self, tid):
        self.raw.pop(tid, None)
        for key in [k for k in self.side if k[0] == tid]:
            del self.side[key]
