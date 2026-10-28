"""Shared "is this vehicle standing still, and is it really blocking traffic?" logic for V1, V3 and V7.

A vehicle standing on the road is only a violation when the road around it is NOT stopped too. Dhaka footage is
full of look-alikes - red lights, police-held junctions, jams - so a stand only counts when:

* other traffic actually PASSES it: 3+ wheelers in the same road zone that were behind it and are now ahead
  (or the other way round) while it stood. In a jam or at a red light nobody passes. Motorbikes and bicycles
  filter through stopped queues, so they do not count.
* it is at the head of its queue: if another stopped vehicle stands right in front of it in the same lane, it is
  waiting behind that one (the one in front is the blocker), and that time does not count.
"""

from collections import deque

import cv2
import numpy as np

from .base import FILTERING_CLASSES

MAX_GAP_SEC = 0.5      # a longer gap between two sightings does not count as "traffic was flowing" time
PASS_DEADBAND_M = 1.5  # a passing vehicle must be clearly behind, then clearly ahead
MAX_BLIND_SEC = 1.0    # only decide while the position is measured: a car driving into the unmeasurable far end
                       # (or behind a pole) must not keep its standing timer
MOVING_KPH = 5.0       # a vehicle slower than this is standing (for queue / passing decisions)
HANDOFF_RETRY_SEC = 1.5  # a new track ID keeps trying to take over a nearby orphaned stand this long: its first
                         # positions are often off (the vehicle is still partly hidden when it reappears)
DUPLICATE_M = 1.5        # [web] a stand that began this close to where a reported one began...
DUPLICATE_GAP_SEC = 30.0  # ...at most this long after that vehicle was last seen is the same vehicle (a parked
                          # motorbike hidden by a crowd for 20 s comes back with a new track ID)
# The detector often swaps these look-alikes on one vehicle; for an ID-switch hand-over they are the same vehicle.
SAME_KIND = [{"Motorbike", "Bicycle"}, {"CNG", "Easybike", "Leguna"}, {"Car", "MPV"}, {"Pickup", "Truck"},
             {"Rickshaw", "Van"}]


def same_kind(a, b):
    return a == b or any(a in g and b in g for g in SAME_KIND)


class StandState:
    def __init__(self, road, cls, xy, t):
        self.road, self.cls = road, cls
        self.recent = deque([(t, xy)])
        self.anchor = np.float64(xy)
        self.origin = np.float64(xy)   # [web] where it first stopped (the anchor follows a vehicle inching up)
        self.start_s = t
        self.last_s = t
        self.flow_s = 0.0          # seconds during which other traffic in the zone was moving
        self.queued_s = 0.0        # seconds spent right behind another standing vehicle
        self.side = {}             # other tid -> -1 / +1: behind / ahead of this vehicle along the road
        self.passed = set()        # tids of 3+ wheelers that went past it while it stood
        self.seen_s = t            # last time it had a measured position inside the radius
        self.photo = None          # (time_s, JPEG) taken photo_after_sec after it stopped: "before" evidence
        self.reported = False
        self.fresh = False         # started for a new track ID without taking over an earlier stand

    def position(self):
        return np.median(np.float64([p for _, p in self.recent]), axis=0)


def stand_photo(frame, bbox, max_width=1920):
    """JPEG of the scene with the vehicle boxed, scaled down (taken once per stand)."""
    h, w = frame.shape[:2]
    s = min(1.0, max_width / w)
    img = cv2.resize(frame, (int(w * s), int(h * s)), interpolation=cv2.INTER_AREA) if s < 1 else frame.copy()
    x1, y1, x2, y2 = (int(v * s) for v in bbox)
    cv2.rectangle(img, (x1, y1), (x2, y2), (0, 200, 255), max(2, round(3 * img.shape[0] / 1080)))
    return cv2.imencode(".jpg", img, [cv2.IMWRITE_JPEG_QUALITY, 85])[1].tobytes()


class StationaryMonitor:
    """Tracks how long each vehicle has stood within `radius_m` of one spot on the road plane.

    - Position is the median of the last `smooth_sec` of bottom-centre points, so box jitter from rickshaws and
      people passing in front of the vehicle does not reset the timer.
    - Slow Dhaka traffic (3-7 km/h) leaves the radius within a few seconds, so crawling is never "standing".
    - When the tracker loses a standing vehicle and gives it a new ID (common when a bus is occluded, or a parked
      motorbike behind a crowd), the new track inherits the timer if it appears within `handoff_radius_m` of the
      same spot within `handoff_sec`, the old ID is no longer visible and the class is the same or a look-alike.
    - [web] `creep_m`: a vehicle that inches up (a CNG row at a kerb stand moves up a car length each time the
      front one leaves) keeps its stand while it stays within `creep_m` of where it first stopped; without it,
      every move beyond `radius_m` starts a new stand.
    """

    def __init__(self, smooth_sec=0.5, handoff_sec=8.0, handoff_radius_m=2.5, queue_gap_m=9.0, lane_half_m=1.6,
                 flow_kph=10.0, creep_m=None):
        self.smooth_sec, self.handoff_sec, self.handoff_radius_m = smooth_sec, handoff_sec, handoff_radius_m
        self.queue_gap_m, self.lane_half_m, self.flow_kph = queue_gap_m, lane_half_m, flow_kph
        self.creep_m = creep_m
        self.states = {}  # tid -> StandState

    def drop(self, tid):
        self.states.pop(tid, None)

    def _adopt(self, obs, present, xy):
        """A stand left behind by another track ID at the same spot (ID switch)."""
        best, best_d = None, self.handoff_radius_m
        for tid, st in self.states.items():
            if tid == obs.tid or tid in present or st.road is not obs.road or not same_kind(st.cls, obs.cls):
                continue
            d = float(np.linalg.norm(st.position() - xy))
            if d <= best_d:
                best, best_d = tid, d
        return self.states.pop(best) if best is not None else None

    def _neighbours(self, st, obs, scene, dt):
        """Updates who passed the stand, whether traffic flows, and whether it is queued behind someone."""
        me = st.position()
        direction = obs.road.flow_sign or obs.heading
        queued = flowing = False
        for o in scene.observations:
            # ahead / behind only needs metres, not the precision speed needs: a vehicle that drives past into the
            # far end of the zone has still passed, and a queue head standing there still heads the queue
            oxy = o.xy if o.xy is not None else o.xy_coarse
            if o.tid == obs.tid or o.road is not obs.road or oxy is None:
                continue
            dy = oxy[1] - me[1]
            moving = o.kph is not None and o.kph >= MOVING_KPH
            if (direction and not moving and abs(oxy[0] - me[0]) <= self.lane_half_m
                    and 0 < dy * direction <= self.queue_gap_m):
                queued = True  # someone standing right in front of it, in its lane
            if o.cls in FILTERING_CLASSES:
                continue
            if moving and o.kph >= self.flow_kph:
                flowing = True
            if abs(dy) < PASS_DEADBAND_M:
                continue
            side = 1 if dy > 0 else -1
            before = st.side.get(o.tid)
            if before is not None and before != side and moving:
                st.passed.add(o.tid)
            st.side[o.tid] = side
        if flowing:
            st.flow_s += dt
        if queued:
            st.queued_s += dt
        return queued

    def update(self, obs, radius_m, scene, present=()):
        """Returns the vehicle's current StandState (None when it is not on a measurable road)."""
        t = obs.time_s
        self.states = {k: s for k, s in self.states.items() if t - s.last_s <= self.handoff_sec}
        st = self.states.get(obs.tid)
        if obs.road is None:
            self.drop(obs.tid)
            return None
        if obs.xy is None:  # box cut off by the frame edge: no new position, keep the timer running
            if st is not None and st.road is obs.road:
                self._neighbours(st, obs, scene, min(MAX_GAP_SEC, t - st.last_s))
                st.last_s = t
            return st
        xy = np.float64(obs.xy)
        if st is None or st.road is not obs.road:
            st = self._adopt(obs, present, xy)
            if st is None:
                st = StandState(obs.road, obs.cls, xy, t)
                st.fresh = True
            self.states[obs.tid] = st
        dt = min(MAX_GAP_SEC, t - st.last_s)
        st.recent.append((t, xy))
        while len(st.recent) > 1 and t - st.recent[0][0] > self.smooth_sec:
            st.recent.popleft()
        st.last_s = st.seen_s = t
        if st.fresh and t - st.start_s <= HANDOFF_RETRY_SEC:   # settled now: is this an earlier stand after all?
            old = self._adopt(obs, present, st.position())
            if old is not None:
                old.recent, old.last_s, old.seen_s = st.recent, t, t
                st = self.states[obs.tid] = old
        if np.linalg.norm(st.position() - st.anchor) > radius_m:  # it moved
            if self.creep_m is not None and np.linalg.norm(st.position() - st.origin) <= self.creep_m:
                st.anchor = st.position()   # [web] inched up: still the same stand
                self._neighbours(st, obs, scene, dt)
            else:                           # drove off: a new stand starts here
                st = StandState(obs.road, obs.cls, st.position(), t)
                self.states[obs.tid] = st
        else:
            self._neighbours(st, obs, scene, dt)
        return st

    @staticmethod
    def dwell_sec(st, t):
        return t - st.start_s


class StandRule:
    """Common decision for the "standing too long" rules. Subclasses say where the rule applies."""

    DEFAULTS = {
        "dwell_sec": 20.0,
        "radius_m": 2.5,
        "min_passed": 3,             # 3+ wheelers that drove past it while it stood (none pass in a jam)
        "max_queued_share": 0.3,     # at most this share of the stand spent right behind another standing vehicle
        "photo_after_sec": 2.0,      # "before" photo once it has stood this long
        "min_purity": 0.6,
    }

    def __init__(self, settings=None, camera=None):
        super().__init__(settings, camera)
        self.reported_stands = []    # [web] StandStates already reported (see _same_as_reported)

    def _stand_update(self, obs, ctx):
        """Returns (StandState, dwell) when the stand qualifies now, else None."""
        st = self.monitor.update(obs, self.cfg["radius_m"], ctx.scene, ctx.scene.present)
        if st is None or st.reported:
            return None
        dwell = self.monitor.dwell_sec(st, obs.time_s)
        if (st.photo is None and dwell >= self.cfg["photo_after_sec"] and st.queued_s < 0.5 * dwell
                and ctx.frame is not None and getattr(ctx.frame, "size", 0)):
            st.photo = (obs.time_s, stand_photo(ctx.frame, obs.bbox))
        if (dwell >= self.cfg["dwell_sec"] and obs.time_s - st.seen_s <= MAX_BLIND_SEC
                and len(st.passed) >= self.cfg["min_passed"]
                and st.queued_s <= self.cfg["max_queued_share"] * dwell):
            if self._same_as_reported(st, obs):
                st.reported = True
                return None
            return st, dwell
        return None

    def _same_as_reported(self, st, obs):
        """[web] A vehicle already reported, under another track ID: the detector boxes a parked motorbike and the
        man sitting on it separately, the tracker gives a vehicle a new ID while the old one is still alive (the
        hand-over only takes stands whose ID is gone), or the vehicle was hidden longer than the hand-over time.
        Same spot, same kind of vehicle, and this stand began while the reported one was still seen there or
        shortly after = the same vehicle. (A CNG moving up into the spot the one in front left began its stand
        further back, so it still counts.)"""
        self.reported_stands = [s for s in self.reported_stands if obs.time_s - s.last_s <= 120]
        return any(s is not st and s.road is st.road and same_kind(s.cls, obs.cls)
                   and st.start_s <= s.last_s + DUPLICATE_GAP_SEC
                   and float(np.linalg.norm(s.origin - st.origin)) <= DUPLICATE_M for s in self.reported_stands)

    def _stand_event(self, obs, st, dwell, extra=None):
        st.reported = True
        self.reported_stands.append(st)
        x_m = float(obs.xy[0] if obs.xy is not None else st.position()[0])
        kerb_m = min(x_m, obs.road.width_m - x_m)
        details = {"dwell_s": round(dwell, 1), "vehicles_passed": len(st.passed),
                   "traffic_moving_s": round(st.flow_s, 1), "queued_s": round(st.queued_s, 1),
                   "from_kerb_m": round(max(0.0, kerb_m), 1), **(extra or {})}
        ev = self.event(obs, details, started_s=st.start_s)
        if st.photo is not None:
            ev.extra_frames.append(("stopped", st.photo[0], st.photo[1]))
        return ev
