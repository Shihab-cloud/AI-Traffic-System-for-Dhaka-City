"""V2: over the speed limit: 60 km/h on city roads, 80 km/h on highways and expressways (zones.py), flagged above
the limit plus a small measurement margin (63 km/h in the city, 84 km/h on highways)."""

from .base import BaseViolation


class SpeedViolation(BaseViolation):
    code = "V2"
    title = "Over speed limit"
    DEFAULTS = {
        "tolerance_kph": 3.0,        # enforcement margin for measurement error (about +-5% on a calibrated zone):
        "tolerance_pct": 5.0,        #   flag only above limit + max(tolerance_kph, tolerance_pct of limit)
        "sustain_sec": 1.0,          # smoothed speed above that for this long...
        "min_section_m": 10.0,       # ...AND the average speed since entering the zone is above it too,
        "min_section_sec": 1.5,      #    measured over at least this distance and time
        "min_purity": 0.6,           # class decides the limit, so it must be reliable
        # Zones sized by automatic calibration: speeds carry its stated uncertainty, so flag only beyond
        # limit * (1 + auto_margin_factor * uncertainty) - a measurement error can never make a ticket.
        "auto_margin_factor": 1.5,
        "auto_default_uncertainty_pct": 15.0,
    }

    def __init__(self, settings=None, camera=None):
        super().__init__(settings, camera)
        self.state = {}  # tid -> [road, time first over the threshold, max kph]

    def threshold(self, limit, road=None):
        pct = self.cfg["tolerance_pct"]
        if road is not None and road.scale_source == "auto":
            unc = road.speed_uncertainty_pct or self.cfg["auto_default_uncertainty_pct"]
            pct = max(pct, self.cfg["auto_margin_factor"] * unc)
        return limit + max(self.cfg["tolerance_kph"], limit * pct / 100)

    def update(self, obs, ctx):
        if obs.road is None or obs.kph is None or obs.purity < self.cfg["min_purity"]:
            return None
        limit = self.camera.speed_limit(obs.road, obs.cls)
        if limit is None:
            return None
        thr = self.threshold(limit, obs.road)
        st = self.state.get(obs.tid)
        if st is None or st[0] is not obs.road:
            st = self.state[obs.tid] = [obs.road, None, 0.0]
        if obs.kph <= thr:
            st[1], st[2] = None, 0.0
            return None
        st[1] = obs.time_s if st[1] is None else st[1]
        st[2] = max(st[2], obs.kph)
        if obs.time_s - st[1] < self.cfg["sustain_sec"] or obs.section is None:
            return None
        metres, secs = obs.section
        if metres < self.cfg["min_section_m"] or secs < self.cfg["min_section_sec"]:
            return None
        section_kph = metres / secs * 3.6
        if section_kph <= thr:
            return None
        details = {"kph": round(obs.kph, 1), "max_kph": round(st[2], 1), "section_kph": round(section_kph, 1),
                   "limit_kph": round(limit, 1), "flag_above_kph": round(thr, 1)}
        if obs.road.scale_source == "auto":
            unc = obs.road.speed_uncertainty_pct or self.cfg["auto_default_uncertainty_pct"]
            details["calibration"] = f"automatic, speeds +-{unc:.0f}%"
        return self.event(obs, details, started_s=st[1])

    def forget(self, tid):
        self.state.pop(tid, None)
