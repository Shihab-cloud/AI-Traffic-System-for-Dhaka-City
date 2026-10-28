"""V1: a bus standing on the carriageway anywhere except an approved bus stop - picking up / dropping passengers
on a straight road, at the kerb or in a running lane.

Bus stops only count when they are just after an intersection (see zones.py); a bus loading at an unapproved
"stop" on a straight road is reported. Junction and signal areas are exempt (buses wait there for the signal or
to turn). The stand must also block moving traffic: other vehicles drove past it while it stood and it was not
simply waiting behind another standing vehicle (see stationary.py)."""

from .base import BaseViolation
from .stationary import StandRule, StationaryMonitor


class BusBlocking(StandRule, BaseViolation):
    code = "V1"
    title = "Bus stopped outside a bus stop"
    DEFAULTS = {
        **StandRule.DEFAULTS,
        "classes": ["Bus"],          # add "Leguna" to also treat human-haulers as buses
        "dwell_sec": 10.0,           # loading passengers takes longer than this; a moment's halt does not
        "radius_m": 3.0,             # buses inch forward while loading: still the same stop
        "min_passed": 3,
    }
    EXEMPT_AREAS = {"bus_stop", "signal", "intersection"}

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
        names = self.camera.area_names_at(obs.point) if self.camera is not None else []
        if "bus_stop_unapproved" in obs.areas:
            where = "unapproved bus stop (not just after an intersection)"
        elif "no_parking" in obs.areas:
            where = "kerb of a straight road, no bus stop"
        else:
            where = "running lane, no bus stop"
        return self._stand_event(obs, st, dwell, {"where": where, **({"area": ", ".join(names)} if names else {})})
