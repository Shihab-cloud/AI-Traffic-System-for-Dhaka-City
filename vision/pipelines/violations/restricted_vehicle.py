"""V8: a vehicle class that is banned on this road (rickshaws on VIP/main roads, CNGs/Easybikes/Legunas on
flyovers and the elevated expressway, Bhotbhoti/PowerTiller on highways). Set per road zone: "banned_classes"."""

from .base import BaseViolation


class RestrictedVehicle(BaseViolation):
    code = "V8"
    title = "Vehicle banned on this road"
    DEFAULTS = {
        "min_purity": 0.75,          # CNG / Easybike / Leguna look alike: be sure of the class
        "min_sec": 1.5,              # seen inside the zone at least this long
        "min_frames": 10,            # and in at least this many frames of the whole track
    }

    def __init__(self, settings=None, camera=None):
        super().__init__(settings, camera)
        self.inside = {}  # tid -> (road, entered at s)

    def update(self, obs, ctx):
        if obs.road is None or obs.cls not in obs.road.banned_classes:
            self.inside.pop(obs.tid, None)
            return None
        road, since = self.inside.get(obs.tid, (None, None))
        if road is not obs.road:
            since = obs.time_s
            self.inside[obs.tid] = (obs.road, since)
        if (obs.time_s - since >= self.cfg["min_sec"] and obs.n_frames >= self.cfg["min_frames"]
                and obs.purity >= self.cfg["min_purity"]):
            return self.event(obs, {"class_confidence": round(obs.purity, 2)}, started_s=since)
        return None

    def forget(self, tid):
        self.inside.pop(tid, None)
