"""V4: driving against the allowed direction of a one-way carriageway (very common for rickshaws, motorbikes
and CNGs taking a shortcut in Dhaka)."""

from collections import deque

import numpy as np

from .base import BaseViolation


class WrongSide(BaseViolation):
    code = "V4"
    title = "Wrong-side driving"
    DEFAULTS = {
        "min_travel_m": 8.0,         # net distance against the allowed direction
        "min_sec": 1.0,
        "straightness": 0.75,        # net distance / path length: rejects jitter and ID-switch zigzags
        "step_m": 0.5,               # path points are kept every 0.5 m, so standing jitter adds no length
        "max_kph": 120.0,            # a faster jump means the track ID switched to another vehicle
        "smooth_samples": 5,
        "min_purity": 0.5,
        "min_kph": 5.0,              # slower is someone pushing a bike / walking, not driving against traffic
        "edge_m": 4.0,               # positions within this distance of where measurement becomes reliable are
                                     # the noisiest (and where far-away ID switches happen): not used
    }

    def __init__(self, settings=None, camera=None):
        super().__init__(settings, camera)
        self.state = {}  # tid -> {"road", "raw", "path": [(t, xy)], "length"}

    def update(self, obs, ctx):
        if obs.road is None or obs.road.allowed_direction == "both" or obs.purity < self.cfg["min_purity"]:
            self.state.pop(obs.tid, None)
            return None
        if obs.areas & {"uturn", "intersection"}:  # turning at a junction / U-turn opening is legal: start over
            self.state.pop(obs.tid, None)
            return None
        if obs.xy is None or obs.xy[1] < getattr(obs.road, "reliable_from_m", 0.0) + self.cfg["edge_m"]:
            return None
        st = self.state.get(obs.tid)
        if st is None or st["road"] is not obs.road:
            st = self.state[obs.tid] = {"road": obs.road, "raw": deque(maxlen=self.cfg["smooth_samples"]),
                                        "path": [], "length": 0.0}
        st["raw"].append(np.float64(obs.xy))
        p = np.median(np.float64(st["raw"]), axis=0)
        path = st["path"]
        if not path:
            path.append((obs.time_s, p))
            return None
        t_last, p_last = path[-1]
        step = float(np.linalg.norm(p - p_last))
        if step < self.cfg["step_m"]:
            return None
        if step / max(1e-3, obs.time_s - t_last) * 3.6 > self.cfg["max_kph"]:
            st["path"], st["length"] = [(obs.time_s, p)], 0.0
            return None
        path.append((obs.time_s, p))
        st["length"] += step

        t0, p0 = path[0]
        dy = float(p[1] - p0[1])  # + = toward the camera
        wrong_m = -dy if obs.road.allowed_direction == "toward_camera" else dy
        secs = obs.time_s - t0
        if (wrong_m >= self.cfg["min_travel_m"] and secs >= self.cfg["min_sec"]
                and wrong_m / st["length"] >= self.cfg["straightness"]
                and wrong_m / secs * 3.6 >= self.cfg["min_kph"]):
            return self.event(obs, {"wrong_way_m": round(wrong_m, 1), "allowed": obs.road.allowed_direction,
                                    "kph": round(wrong_m / secs * 3.6, 1)}, started_s=t0)
        return None

    def forget(self, tid):
        self.state.pop(tid, None)
