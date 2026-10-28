"""V7: a vehicle standing in a running lane - not at the kerb strip, not in a bay - while traffic has to go round
it: CNGs, Legunas and rickshaws picking up passengers mid-road, cars dropping someone off, broken-down or
abandoned vehicles. Always enforced. Buses are V1, kerb parking V3.

A red light, a police-held junction or a jam is not blocking: nobody passes a vehicle standing in a stopped
queue, and a vehicle right behind another standing vehicle is waiting, not blocking (see stationary.py)."""

from .base import MOTORISED, NON_MOTORISED, BaseViolation
from .stationary import StandRule, StationaryMonitor


class RoadBlocking(StandRule, BaseViolation):
    code = "V7"
    title = "Blocking a running lane"
    DEFAULTS = {
        **StandRule.DEFAULTS,
        "classes": sorted((MOTORISED | NON_MOTORISED) - {"Bus"}),
        "dwell_sec": 20.0,
        "radius_m": 2.5,
        "min_passed": 4,
    }
    EXEMPT_AREAS = {"no_parking", "parking", "signal", "intersection", "bus_stop", "bus_stop_unapproved", "uturn"}

    def __init__(self, settings=None, camera=None):
        super().__init__(settings, camera)
        self.classes = set(self.cfg["classes"])
        self.monitor = StationaryMonitor()

    def update(self, obs, ctx):
        if obs.cls not in self.classes or obs.purity < self.cfg["min_purity"]:
            return None
        if obs.road is None or obs.road.stopping_allowed or obs.areas & self.EXEMPT_AREAS:
            self.monitor.drop(obs.tid)
            return None
        got = self._stand_update(obs, ctx)
        if got is None:
            return None
        st, dwell = got
        kerbs = self.camera is not None and self.camera.has_area("no_parking")
        return self._stand_event(obs, st, dwell, {"where": "running lane" if kerbs else
                                                  "carriageway (no kerb strip marked on this camera)"})
