"""Traffic violation rules for Dhaka roads, built on detection + tracking + road-plane positions."""

from .base import MOTORISED, NON_MOTORISED, BaseViolation, Context, Observation, Scene, ViolationEvent
from .engine import CODES, RULES, ViolationEngine
from .evidence import EvidenceWriter
from .zones import AreaZone, CameraConfig, LaneLine, RoadZone, load_camera_config
