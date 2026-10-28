"""Runs every rule on every tracked vehicle, once per processed frame, and reports each (vehicle, violation) once."""

from collections import defaultdict

from .base import Context, Scene
from .bus_blocking import BusBlocking
from .helmet import NoHelmet
from .illegal_parking import IllegalParking
from .lane_change import LaneLineCrossing
from .restricted_vehicle import RestrictedVehicle
from .road_blocking import RoadBlocking
from .speed_violation import SpeedViolation
from .wrong_side import WrongSide

# config key in the camera's "rules" settings -> rule class
RULES = {
    "speed": SpeedViolation,
    "bus_blocking": BusBlocking,
    "illegal_parking": IllegalParking,
    "road_blocking": RoadBlocking,
    "wrong_side": WrongSide,
    "lane_line": LaneLineCrossing,
    "restricted_vehicle": RestrictedVehicle,
    "helmet": NoHelmet,
}
CODES = {cls.code: key for key, cls in RULES.items()}


class ViolationEngine:
    def __init__(self, camera, overrides=None, only=None, helmet_detector=None, forget_sec=10.0, flow_kph=10.0,
                 lost_sec=1.0):
        """overrides: {rule key: {setting: value}} applied on top of the camera's "rules" settings.
        only: rule keys or codes (V1..V8) to run; default all that can run."""
        self.camera, self.flow_kph, self.forget_sec, self.lost_sec = camera, flow_kph, forget_sec, lost_sec
        self.lost_done = set()              # tids whose "left the view" decision has been made
        wanted = None if not only else {CODES.get(k.upper(), k) for k in only}
        self.rules, self.inactive = [], {}  # inactive: code -> why it is not running
        for key, cls in RULES.items():
            settings = {**(camera.rules.get(key) or {}), **((overrides or {}).get(key) or {})}
            if wanted is not None and key not in wanted:
                continue
            if settings.pop("enabled", True) is False:
                self.inactive[cls.code] = "disabled in settings"
            elif key == "helmet" and helmet_detector is None:
                self.inactive[cls.code] = "needs a helmet model"
            elif key == "illegal_parking" and not camera.has_area("no_parking"):
                self.inactive[cls.code] = "no no-parking kerb strip drawn"
            elif key == "lane_line" and not camera.lines:
                self.inactive[cls.code] = "no solid lane lines drawn"
            elif key == "wrong_side" and all(r.allowed_direction == "both" for r in camera.roads):
                self.inactive[cls.code] = "no one-way road zone"
            elif key == "restricted_vehicle" and not any(r.banned_classes for r in camera.roads):
                self.inactive[cls.code] = "no banned classes set"
            elif key == "helmet":
                self.rules.append(NoHelmet(settings, camera, detector=helmet_detector))
            else:
                self.rules.append(cls(settings, camera))
        self.suspended = set()              # codes temporarily not evaluated (e.g. V2 when the frame rate is low)
        self.last_seen = {}                 # tid -> time_s
        self.reported = set()               # (tid, code)
        self.flagged = defaultdict(list)    # tid -> codes, for drawing
        self.events = []

    def reset(self):
        """Forget everything rules have accumulated (e.g. the camera view moved: positions so far are not
        comparable with the ones that follow). Reported events stay reported."""
        for tid in list(self.last_seen):
            for rule in self.rules:
                rule.forget(tid)
        for rule in self.rules:
            if hasattr(rule, "monitor"):   # standing-vehicle rules: stands so far were measured in the old view
                rule.monitor.states.clear()
        self.last_seen.clear()
        self.lost_done.clear()

    def process(self, observations, frame, frame_idx, time_s, wall_clock=None):
        """observations: Observation for every confirmed track in this frame. Returns the new ViolationEvents."""
        ctx = Context(frame, frame_idx, time_s, Scene(observations, self.flow_kph), wall_clock)
        new = []
        for obs in observations:
            self.last_seen[obs.tid] = time_s
            self.lost_done.discard(obs.tid)  # back in view: decide again when it leaves
            for rule in self.rules:
                if rule.code in self.suspended:
                    continue
                ev = rule.update(obs, ctx)
                if ev is None or (obs.tid, ev.code) in self.reported:
                    continue
                self.reported.add((obs.tid, ev.code))
                self.flagged[obs.tid].append(ev.code)
                new.append(ev)
        for tid in [t for t, s in self.last_seen.items() if time_s - s > self.lost_sec and t not in self.lost_done]:
            self.lost_done.add(tid)
            for rule in self.rules:
                if rule.code in self.suspended:
                    continue
                ev = rule.lost(tid)
                if ev is not None and (tid, ev.code) not in self.reported:
                    self.reported.add((tid, ev.code))
                    self.flagged[tid].append(ev.code)
                    new.append(ev)
        for tid in [t for t, s in self.last_seen.items() if time_s - s > self.forget_sec]:
            self.lost_done.discard(tid)
            del self.last_seen[tid]
            self.flagged.pop(tid, None)
            for rule in self.rules:
                rule.forget(tid)
        self.events.extend(new)
        return new
