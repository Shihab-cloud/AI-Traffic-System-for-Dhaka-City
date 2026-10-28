"""Data passed to every violation rule, and the rule interface.

All rules work on timestamps (seconds), never on frame counts, so a live camera that drops frames when the
computer falls behind gives the same results as a video file processed frame by frame.
"""

from dataclasses import dataclass, field
from typing import Optional

# Classes of bd_vehicles_best.pt. "Van" in Bangladeshi datasets is the pedal cargo rickshaw-van.
MOTORISED = {"Bus", "Car", "MPV", "Pickup", "Truck", "CNG", "Easybike", "Leguna", "Motorbike", "Bhotbhoti",
             "PowerTiller"}
NON_MOTORISED = {"Rickshaw", "Bicycle", "Van", "Wheelbarrow"}
# Two-wheelers filter through stopped queues in Dhaka, so their movement says nothing about whether traffic flows.
FILTERING_CLASSES = {"Motorbike", "Bicycle"}


@dataclass
class Observation:
    """One tracked vehicle in one frame."""
    tid: int
    frame_idx: int
    time_s: float                    # seconds since the start of the video / live session
    cls: str                         # majority-vote class of the track so far
    purity: float                    # share of the track's frames that voted for `cls`
    n_frames: int                    # frames the track has been seen
    bbox: tuple                      # x1, y1, x2, y2 (full-frame pixels)
    point: tuple                     # bottom-centre of the box = where the vehicle touches the road
    road: Optional[object] = None    # RoadZone containing `point`
    xy: Optional[tuple] = None       # road-plane metres; None when the box is cut off by the frame edge
    kph: Optional[float] = None      # smoothed speed
    section: Optional[tuple] = None  # (metres, seconds) travelled since entering `road`
    areas: frozenset = frozenset()   # AreaZone tags containing `point` (see AreaZone.tag)
    heading: int = 0                 # +1 moving toward the camera, -1 away, 0 not known yet
    # road-plane metres also where they are too coarse for speed (far end of a zone): good enough to tell whether
    # a vehicle is ahead of / behind another one. None only when the box is cut off.
    xy_coarse: Optional[tuple] = None


@dataclass
class ViolationEvent:
    code: str                        # e.g. "V2"
    title: str                       # e.g. "Over speed limit"
    obs: Observation                 # the observation that triggered it
    details: dict = field(default_factory=dict)
    started_s: Optional[float] = None  # when the offending behaviour began
    frame: Optional[bytes] = None      # JPEG of the evidence frame, when it is not the current one
    extra_frames: list = field(default_factory=list)  # [(label, time_s, JPEG)], e.g. the moment it stopped
    path: list = field(default_factory=list)          # [(x, y)] full-frame pixels of the vehicle's recent path


class Scene:
    """Everything seen in the current frame, so a rule can look at the traffic around a vehicle."""

    def __init__(self, observations, flow_kph=10.0):
        self.flow_kph = flow_kph
        self.observations = observations
        self.present = {o.tid for o in observations}
        self.by_road = {}       # road id -> observations with a speed
        self.count_road = {}    # road id -> vehicles of any kind inside the zone (traffic density)
        for o in observations:
            if o.road is not None:
                self.count_road[id(o.road)] = self.count_road.get(id(o.road), 0) + 1
                if o.kph is not None:
                    self.by_road.setdefault(id(o.road), []).append(o)

    def flowing_others(self, obs):
        """Other 3+ wheel vehicles in the same road zone moving at >= flow_kph.

        If traffic in the zone is moving while this vehicle is not, it has not stopped because of a signal or a jam.
        """
        if obs.road is None:
            return 0
        return sum(1 for o in self.by_road.get(id(obs.road), ())
                   if o.tid != obs.tid and o.kph >= self.flow_kph and o.cls not in FILTERING_CLASSES)


@dataclass
class Context:
    frame: object                    # BGR image (untouched by drawing), for rules that look at pixels
    frame_idx: int
    time_s: float
    scene: Scene
    wall_clock: Optional[object] = None  # datetime of this frame, if the recording start time is known


class BaseViolation:
    """A traffic rule. `update` is called every processed frame for every confirmed track; return a
    ViolationEvent once the rule is broken. The engine reports each (track, code) only once."""

    code = ""
    title = ""
    DEFAULTS = {}

    def __init__(self, settings=None, camera=None):
        self.camera = camera
        self.cfg = {**self.DEFAULTS, **(settings or {})}

    def update(self, obs: Observation, ctx: Context) -> Optional[ViolationEvent]:
        raise NotImplementedError

    def lost(self, tid):
        """The vehicle has left the view (not seen for a moment). Rules that decide over a whole track return their
        ViolationEvent here."""
        return None

    def forget(self, tid):
        """The track has not been seen for a while."""

    def event(self, obs, details=None, started_s=None, frame=None):
        return ViolationEvent(self.code, self.title, obs, details or {}, started_s, frame)
