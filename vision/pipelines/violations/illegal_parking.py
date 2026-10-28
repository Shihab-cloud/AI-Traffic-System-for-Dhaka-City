"""V3: stopping, waiting or parking at a no-parking kerb (CNG, Leguna and rickshaw "stands", ride-share motorbikes
waiting for passengers, private cars). The kerb strips are marked in the zone editor ("No-parking kerb").

At busy Dhaka pickup points vehicles rarely stay a full minute - they wait 20-40 s for passengers and go, and the
next one takes the spot - so the default is 20 s: longer than letting a passenger off, shorter than waiting.

Enforced during peak hours AND whenever the road is busy (many vehicles in the zone), because a parked vehicle
then takes a lane that moving traffic needs. Buses are handled by V1, vehicles standing in the running lanes by
V7."""

from datetime import time as dtime

import numpy as np

from .base import MOTORISED, NON_MOTORISED, BaseViolation
from .stationary import StandRule, StationaryMonitor


def in_peak_hours(peak_hours, wall_clock):
    """True if `wall_clock` is inside one of the [["HH:MM", "HH:MM"], ...] ranges (ranges may cross midnight).
    No ranges = enforced all day. Unknown time = enforced (the caller warns about it once)."""
    if not peak_hours or wall_clock is None:
        return True
    now = wall_clock.time()
    for start, end in peak_hours:
        a, b = dtime.fromisoformat(start), dtime.fromisoformat(end)
        if (a <= now < b) if a <= b else (now >= a or now < b):
            return True
    return False


class IllegalParking(StandRule, BaseViolation):
    code = "V3"
    title = "Waiting / parked at a no-parking kerb"
    DEFAULTS = {
        **StandRule.DEFAULTS,
        "classes": sorted((MOTORISED | NON_MOTORISED) - {"Bus"}),
        "dwell_sec": 20.0,
        "radius_m": 2.0,
        "creep_m": 10.0,             # [web] a row of waiting CNGs moves up as the front one leaves: same stand
        "min_passed": 3,
        "max_queued_share": 1.0,     # a row of vehicles parked at the kerb is not a traffic queue
        "busy_vehicles": 15,         # heavy traffic: at least this many vehicles in the road zone on average...
        "busy_window_sec": 30.0,     # ...over this long
        "peak_hours": None,          # filled from the camera config
    }
    EXEMPT_AREAS = {"parking", "signal", "intersection", "bus_stop"}

    def __init__(self, settings=None, camera=None):
        super().__init__(settings, camera)
        if camera is not None and "peak_hours" not in (settings or {}):
            self.cfg["peak_hours"] = camera.peak_hours
        self.classes = set(self.cfg["classes"])
        self.monitor = StationaryMonitor(creep_m=self.cfg["creep_m"])
        self.density = {}  # road id -> [last time, mean vehicles in the zone]

    def _busy(self, road, ctx):
        """Exponential mean of the number of vehicles in the zone (updated once per frame per zone)."""
        n = ctx.scene.count_road.get(id(road), 0)
        d = self.density.get(id(road))
        if d is None:
            d = self.density[id(road)] = [ctx.time_s, float(n)]
        elif d[0] != ctx.time_s:
            a = min(1.0, (ctx.time_s - d[0]) / self.cfg["busy_window_sec"])
            d[0], d[1] = ctx.time_s, d[1] + a * (n - d[1])
        return d[1]

    def enforced(self, road, ctx):
        """(enforced now?, why)"""
        mean = self._busy(road, ctx)
        if self.cfg["peak_hours"] and ctx.wall_clock is not None and in_peak_hours(self.cfg["peak_hours"],
                                                                                   ctx.wall_clock):
            return True, "peak hours"
        if mean >= self.cfg["busy_vehicles"]:
            return True, f"heavy traffic ({mean:.0f} vehicles in the zone)"
        if not self.cfg["peak_hours"]:
            return True, "no-parking all day"
        if ctx.wall_clock is None:
            return True, "time of day unknown: enforced"
        return False, ""

    def update(self, obs, ctx):
        if obs.road is not None:
            self._busy(obs.road, ctx)
        if obs.cls not in self.classes or obs.purity < self.cfg["min_purity"]:
            return None
        if (obs.road is None or obs.road.stopping_allowed or "no_parking" not in obs.areas
                or obs.areas & self.EXEMPT_AREAS):
            self.monitor.drop(obs.tid)
            return None
        got = self._stand_update(obs, ctx)
        if got is None:
            return None
        ok, why = self.enforced(obs.road, ctx)
        if not ok:
            return None
        st, dwell = got
        names = [n for n in (self.camera.area_names_at(obs.point) if self.camera else [])]
        moved = float(np.linalg.norm(st.position() - st.origin))
        return self._stand_event(obs, st, dwell, {"enforced_because": why,
                                                  **({"moved_up_m": round(moved, 1)} if moved > 1 else {}),
                                                  **({"area": ", ".join(names)} if names else {})})
