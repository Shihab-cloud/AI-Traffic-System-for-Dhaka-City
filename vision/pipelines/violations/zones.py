"""
Camera configuration for violation detection: road zones, special areas and solid lane lines.

violation_zones.json (one file per camera position):
{
  "frame_size": [2560, 1440],
  "peak_hours": [["07:00", "10:30"], ["16:00", "20:30"]],   # null = parking rule enforced all day
  "speed_limits_kph": {...},                                # optional, overrides DEFAULT_SPEED_LIMITS
  "rules": {"bus_blocking": {"dwell_sec": 15}, ...},        # optional, overrides each rule's DEFAULTS
  "zones": [
    {"type": "road", "name": "Mirpur Rd southbound", "points": [[x, y] x4], "width_m": 10.5, "length_m": 90,
     "road_category": "city", "allowed_direction": "toward_camera", "speed_limit_kph": null,
     "banned_classes": ["Rickshaw"], "stopping_allowed": false},
    {"type": "intersection", "name": "Indira Rd junction", "points": [[x, y], ...]},   # any polygon, >= 3 points
    {"type": "bus_stop", "name": "Shyamoli stop", "points": [...], "approved": false},
    {"type": "no_parking", "name": "Left kerb", "points": [...]},
    {"type": "signal",   "name": "Queue before stop line", "points": [...]},
    {"type": "parking",  "name": "Legal parking bay", "points": [...]},
    {"type": "uturn",    "name": "U-turn opening", "points": [...]}
  ],
  "lane_lines": [{"name": "Solid line lane 1|2", "points": [[x1, y1], [x2, y2]]}]
}

An old speed_zones.json also loads: its zones become city road zones with no direction rule.

Bus stops: Dhaka's bus stops are placed just AFTER an intersection (far side), so a bus stop only counts when an
intersection is marked at most BUS_STOP_MAX_AFTER_M before it, in the direction traffic flows. A bus stop drawn
anywhere else on a straight road is treated as an unapproved stop: buses standing there are reported (V1). Set
"approved": true on a stop to accept it anyway (an official mid-block bus bay).
"""

import json
from pathlib import Path

import cv2
import numpy as np

FONT = cv2.FONT_HERSHEY_SIMPLEX
ROAD_CATEGORIES = ("city", "highway", "expressway")
DIRECTIONS = ("both", "toward_camera", "away_from_camera")
AREA_TYPES = ("no_parking", "bus_stop", "intersection", "signal", "parking", "uturn")
AREA_COLORS = {"bus_stop": (0, 200, 0), "signal": (0, 220, 255), "parking": (255, 120, 0), "uturn": (200, 0, 200),
               "no_parking": (60, 60, 230), "intersection": (230, 230, 230)}
BUS_STOP_MAX_AFTER_M = 120.0   # a far-side bus stop starts within this distance after the intersection
# [web] Kerb-side areas are often drawn (or found by Auto zones) just OUTSIDE a road zone's edge, where vehicles stand
# off the moving traffic. A vehicle standing in one is on that road: it is measured in the road's coordinates
# (beyond its width), so the standing rules (V1, V3) see it. An area belongs to the road zone it overlaps or comes
# within KERB_TOUCH x frame width of.
KERB_AREAS = ("no_parking", "bus_stop", "parking")
KERB_TOUCH = 0.02
ROAD_COLOR = (255, 200, 0)
LINE_COLOR = (255, 255, 255)

# Speed limits used for enforcement: 60 km/h on city roads, 80 km/h on national highways and expressways, for every
# motor vehicle. Classes without an engine (rickshaw, bicycle, van, wheelbarrow) are never checked for speed.
# A zone's "speed_limit_kph" sets a LOWER local limit (school zones, markets); "speed_limits_kph" in the camera
# config overrides a category or a class (e.g. {"highway": {"Truck": 50}} for the BRTA 2024 truck limit).
_MOTOR = ("Bus", "Car", "MPV", "Pickup", "Truck", "CNG", "Easybike", "Leguna", "Motorbike", "Bhotbhoti",
          "PowerTiller")
CATEGORY_LIMITS = {"city": 60, "highway": 80, "expressway": 80}
DEFAULT_SPEED_LIMITS = {cat: {c: kph for c in _MOTOR} for cat, kph in CATEGORY_LIMITS.items()}


def draw_label(img, text, org, color, scale=0.6, thickness=None):
    """Text on a dark filled box so it stays readable on any background."""
    thickness = thickness or max(1, round(scale * 3))
    (tw, th), base = cv2.getTextSize(text, FONT, scale, thickness)
    x, y = int(org[0]), max(th + 4, int(org[1]))
    cv2.rectangle(img, (x - 3, y - th - 4), (x + tw + 3, y + base), (20, 20, 20), -1)
    cv2.putText(img, text, (x, y), FONT, scale, color, thickness, cv2.LINE_AA)


class RoadZone:
    """A real rectangle on the road with known size, plus the traffic rules that apply inside it.

    Road coordinates: x across the zone (0 = left edge), y along it (0 = far edge, length_m = near edge),
    so a vehicle driving toward the camera has increasing y.
    """

    kind = "road"

    def __init__(self, name, points, width_m, length_m, scale=(1.0, 1.0), road_category="city",
                 allowed_direction="both", speed_limit_kph=None, banned_classes=(), stopping_allowed=False,
                 scale_source="measured", speed_uncertainty_pct=None):
        if road_category not in ROAD_CATEGORIES:
            raise ValueError(f"zone '{name}': road_category must be one of {ROAD_CATEGORIES}")
        if allowed_direction not in DIRECTIONS:
            raise ValueError(f"zone '{name}': allowed_direction must be one of {DIRECTIONS}")
        if len(points) != 4:
            raise ValueError(f"road zone '{name}' needs exactly 4 corners")
        if not (float(width_m) > 0 and float(length_m) > 0):
            raise ValueError(f"road zone '{name}': enter its real width and length in metres")
        if not cv2.isContourConvex(np.int32(np.float32(points) * np.float32(scale))):
            raise ValueError(f"road zone '{name}': corners cross over; order them far-left, far-right, "
                             f"near-right, near-left")
        self.name, self.width_m, self.length_m = name, float(width_m), float(length_m)
        self.road_category, self.allowed_direction = road_category, allowed_direction
        self.speed_limit_kph = None if speed_limit_kph is None else float(speed_limit_kph)
        self.banned_classes = [str(c) for c in banned_classes]
        self.stopping_allowed = bool(stopping_allowed)
        # "measured": width / length entered by a person; "auto": from automatic calibration (surveillance/
        # autozone.py), whose speed uncertainty the speed rule allows for
        self.scale_source = "auto" if scale_source == "auto" else "measured"
        self.speed_uncertainty_pct = None if speed_uncertainty_pct is None else float(speed_uncertainty_pct)
        self.poly = np.float32(points) * np.float32(scale)
        dst = np.float32([[0, 0], [width_m, 0], [width_m, length_m], [0, length_m]])
        self.H = cv2.getPerspectiveTransform(self.poly, dst)
        self.H_inv = np.linalg.inv(self.H)

    def contains(self, pt):
        return cv2.pointPolygonTest(self.poly, (float(pt[0]), float(pt[1])), False) >= 0

    @property
    def flow_sign(self):
        """+1 when traffic must move toward the camera (y grows), -1 away from it, 0 when both ways are allowed."""
        return {"toward_camera": 1, "away_from_camera": -1}.get(self.allowed_direction, 0)

    def to_metres(self, pt):
        return cv2.perspectiveTransform(np.float32([[pt]]), self.H)[0, 0]

    def to_pixels(self, pts_m):
        return cv2.perspectiveTransform(np.float32([pts_m]), self.H_inv)[0]

    def metres_per_pixel(self, y_m):
        """Ground distance covered by one image pixel (along the road) at `y_m` metres from the far edge."""
        p = self.to_pixels([[self.width_m / 2, y_m]])[0]
        a, b = self.to_metres(p), self.to_metres(p + [0, 1])
        return float(np.linalg.norm(b - a))

    def reliable_from(self, max_m_per_px):
        """Distance (m from the far edge) from which one pixel covers at most `max_m_per_px` on the road.

        Further away, a few pixels of box jitter are metres of fake movement, so positions there are not used
        for speed, direction or stopping. Returns length_m if no part of the zone is that precise."""
        for y in np.linspace(0, self.length_m, 181):
            if self.metres_per_pixel(y) <= max_m_per_px:
                return float(y)
        return self.length_m

    def to_dict(self):
        return {"type": "road", "name": self.name,
                "points": [[round(float(x), 1), round(float(y), 1)] for x, y in self.poly],
                "width_m": self.width_m, "length_m": self.length_m, "road_category": self.road_category,
                "allowed_direction": self.allowed_direction, "speed_limit_kph": self.speed_limit_kph,
                "banned_classes": self.banned_classes, "stopping_allowed": self.stopping_allowed,
                "scale_source": self.scale_source, "speed_uncertainty_pct": self.speed_uncertainty_pct}

    def describe(self):
        speed = getattr(self, "show_speed", True)  # [web] False when no speed rule runs (Pipeline sets it)
        parts = [f"{self.width_m:g}x{self.length_m:g} m"] + ([self.road_category] if speed else [])
        if self.allowed_direction != "both":
            parts.append(self.allowed_direction.replace("_", " ") + " only")
        if self.speed_limit_kph and speed:
            parts.append(f"max {self.speed_limit_kph:g} km/h")
        if self.banned_classes:
            parts.append("no " + "/".join(self.banned_classes))
        if self.scale_source == "auto":
            parts.append("auto-calibrated")
        return f"{self.name} ({', '.join(parts)})"

    def draw(self, img, ui=1.0, step_m=10, s=1.0):
        """Zone outline, a cross line every `step_m` metres, and an arrow for the allowed direction.
        `s` scales full-frame coordinates to the size of `img`."""
        thick = max(1, round(2 * ui))
        cv2.polylines(img, [(self.poly * s).astype(np.int32)], True, ROAD_COLOR, thick, cv2.LINE_AA)
        for d in np.arange(step_m, self.length_m, step_m):
            a, b = self.to_pixels([[0, d], [self.width_m, d]]) * s
            cv2.line(img, tuple(map(int, a)), tuple(map(int, b)), ROAD_COLOR, 1, cv2.LINE_AA)
        if self.allowed_direction != "both":
            y0, y1 = 0.35 * self.length_m, 0.65 * self.length_m
            if self.allowed_direction == "away_from_camera":
                y0, y1 = y1, y0
            a, b = self.to_pixels([[self.width_m / 2, y0], [self.width_m / 2, y1]]) * s
            cv2.arrowedLine(img, tuple(map(int, a)), tuple(map(int, b)), ROAD_COLOR, max(2, round(4 * ui)),
                            cv2.LINE_AA, tipLength=0.15)
        x, y = map(int, self.poly[0] * s)
        draw_label(img, self.describe(), (x, y - 8), ROAD_COLOR, 0.55 * ui)


class AreaZone:
    """A polygon that changes how rules apply inside it:
    no_parking    kerb strip where standing is illegal parking (V3) in peak hours or heavy traffic
    bus_stop      buses may stand here - only if it is just after an intersection (or "approved")
    intersection  junction mouth: vehicles wait here to turn / for the traffic police, never a stop violation
    signal        queue before a stop line: never a stop violation
    parking       legal parking bay
    uturn         legal U-turn opening (not wrong-side driving)"""

    def __init__(self, kind, name, points, scale=(1.0, 1.0), approved=False):
        if kind not in AREA_TYPES:
            raise ValueError(f"area '{name}': type must be one of {AREA_TYPES}")
        if len(points) < 3:
            raise ValueError(f"area '{name}' needs at least 3 points")
        self.kind, self.name = kind, name
        self.poly = np.float32(points) * np.float32(scale)
        self.approved = bool(approved)
        self.valid, self.reason = True, ""    # bus stops: set by CameraConfig.check_bus_stops()
        self.road = None                      # [web] kerb-side area: the road zone it lies along (CameraConfig)

    def contains(self, pt):
        return cv2.pointPolygonTest(self.poly, (float(pt[0]), float(pt[1])), False) >= 0

    @property
    def tag(self):
        """What a rule sees: an invalid bus stop is not a bus stop."""
        return "bus_stop_unapproved" if self.kind == "bus_stop" and not self.valid else self.kind

    def to_dict(self):
        d = {"type": self.kind, "name": self.name,
             "points": [[round(float(x), 1), round(float(y), 1)] for x, y in self.poly]}
        if self.kind == "bus_stop":
            d["approved"] = self.approved
        return d

    def draw(self, img, ui=1.0, s=1.0):
        col = AREA_COLORS[self.kind] if self.valid else (0, 0, 255)
        pts = (self.poly * s).astype(np.int32)
        x0, y0 = np.maximum(pts.min(axis=0), 0)
        x1, y1 = pts.max(axis=0) + 1
        roi = img[y0:y1, x0:x1]  # tint only the polygon's bounding box: much cheaper than the whole frame
        if roi.size:
            overlay = roi.copy()
            cv2.fillPoly(overlay, [pts - [x0, y0]], col)
            cv2.addWeighted(overlay, 0.18, roi, 0.82, 0, roi)
        cv2.polylines(img, [pts], True, col, max(1, round(2 * ui)), cv2.LINE_AA)
        x, y = map(int, pts[0])
        txt = f"{self.kind.replace('_', ' ')}: {self.name}" + ("" if self.valid else " (NOT after a junction)")
        draw_label(img, txt, (x, y - 8), col, 0.5 * ui)


class LaneLine:
    """A painted SOLID lane line (crossing it is prohibited). Only draw the solid parts: a broken line may be
    crossed legally. The line is measured in the road zone that contains its midpoint."""

    def __init__(self, name, points, roads, scale=(1.0, 1.0)):
        self.name = name
        self.pts = np.float32(points) * np.float32(scale)
        mid = self.pts.mean(axis=0)
        self.road = next((r for r in roads if r.contains(mid)), None)
        if self.road is None:
            raise ValueError(f"lane line '{name}': its midpoint is not inside any road zone")
        a, b = (np.float64(self.road.to_metres(p)) for p in self.pts)
        self.a_m, self.b_m = a, b
        self.length_m = float(np.linalg.norm(b - a))
        if self.length_m < 1:
            raise ValueError(f"lane line '{name}' is shorter than 1 m")
        self.u = (b - a) / self.length_m          # unit vector along the line
        self.n = np.array([-self.u[1], self.u[0]])  # unit normal

    def measure(self, xy):
        """(signed lateral distance in m, position along the line in m) of a road-plane point."""
        d = np.asarray(xy, np.float64) - self.a_m
        return float(d @ self.n), float(d @ self.u)

    def to_dict(self):
        return {"name": self.name, "points": [[round(float(x), 1), round(float(y), 1)] for x, y in self.pts]}

    def draw(self, img, ui=1.0, s=1.0):
        a, b = (tuple(map(int, p * s)) for p in self.pts)
        cv2.line(img, a, b, LINE_COLOR, max(2, round(3 * ui)), cv2.LINE_AA)
        draw_label(img, f"solid: {self.name}", (a[0] + 5, a[1] - 8), LINE_COLOR, 0.45 * ui)


class CameraConfig:
    def __init__(self, roads, areas=(), lines=(), peak_hours=None, speed_limits=None, rules=None,
                 frame_size=None):
        self.roads, self.areas, self.lines = list(roads), list(areas), list(lines)
        self.peak_hours = peak_hours
        self.speed_limits = {cat: dict(v) for cat, v in DEFAULT_SPEED_LIMITS.items()}
        for cat, table in (speed_limits or {}).items():
            self.speed_limits.setdefault(cat, {}).update(table)
        self.rules = rules or {}
        self.frame_size = frame_size
        for a in self.areas:  # [web]
            a.road = self._kerb_road(a) if a.kind in KERB_AREAS else None
        self.check_bus_stops()

    def road_at(self, pt):
        road = next((r for r in self.roads if r.contains(pt)), None)
        if road is None:  # [web] standing in a kerb strip / bay drawn beside the road zone: on that road
            road = next((a.road for a in self.areas if a.road is not None and a.contains(pt)), None)
        return road

    def _kerb_road(self, area):
        """[web] The road zone a kerb-side area lies along: the one it overlaps or touches, else None."""
        if not self.roads:
            return None
        width = (self.frame_size or [0])[0] or float(max(r.poly[:, 0].max() for r in self.roads))
        pts =[tuple(map(float, p)) for p in area.poly] + [tuple(map(float, area.poly.mean(axis=0)))]
        best, best_d = None, -KERB_TOUCH * width
        for r in self.roads:
            d = max(cv2.pointPolygonTest(r.poly, p, True) for p in pts)  # > 0 inside, < 0 outside (pixels)
            if d >= best_d:
                best, best_d = r, d
        return best

    def areas_at(self, pt):
        return frozenset(a.tag for a in self.areas if a.contains(pt))

    def area_names_at(self, pt):
        return [a.name for a in self.areas if a.contains(pt)]

    def has_area(self, kind):
        return any(a.kind == kind for a in self.areas)

    def _road_for(self, pts):
        """Road zone containing the polygon's centre, else the one nearest to it."""
        c = np.float32(pts).mean(axis=0)
        inside = self.road_at(c)
        if inside or not self.roads:
            return inside
        return max(self.roads, key=lambda r: cv2.pointPolygonTest(r.poly, (float(c[0]), float(c[1])), True))

    def check_bus_stops(self, max_after_m=BUS_STOP_MAX_AFTER_M):
        """Marks each bus stop valid / invalid (far-side rule, see the module notes) and returns a report."""
        junctions = [a for a in self.areas if a.kind == "intersection"]
        report = []
        for stop in (a for a in self.areas if a.kind == "bus_stop"):
            stop.valid, stop.reason = False, ""
            road = self._road_for(stop.poly)
            if stop.approved:
                stop.valid, stop.reason = True, "approved mid-block bus bay"
            elif road is None:
                stop.reason = "not on a road zone"
            else:
                # Upstream edge of the stop (where a bus arrives) vs. downstream edge of each junction.
                ys = [float(road.to_metres(p)[1]) for p in stop.poly]
                best = None
                for j in junctions:
                    jy = [float(road.to_metres(p)[1]) for p in j.poly]
                    signs = [road.flow_sign] if road.flow_sign else [1, -1]
                    for sgn in signs:
                        # along the flow: toward camera (+1) = increasing y
                        gap = (min(ys) - max(jy)) if sgn > 0 else (min(jy) - max(ys))
                        if -2.0 <= gap <= max_after_m and (best is None or gap < best[1]):
                            best = (j.name, gap)
                if best:
                    stop.valid = True
                    stop.reason = f"{max(0.0, best[1]):.0f} m after intersection '{best[0]}'"
                elif not junctions:
                    stop.reason = "no intersection marked before it: buses standing here are reported"
                else:
                    stop.reason = (f"not within {max_after_m:.0f} m after an intersection (in the direction of "
                                   f"traffic): buses standing here are reported")
            report.append({"name": stop.name, "valid": stop.valid, "reason": stop.reason})
        return report

    def speed_limit(self, road, cls):
        """Limit for this class in this zone, or None if the class has no speed limit."""
        limit = self.speed_limits.get(road.road_category, {}).get(cls)
        if limit is None:
            return None
        return min(limit, road.speed_limit_kph) if road.speed_limit_kph else float(limit)

    def to_dict(self):
        return {"frame_size": self.frame_size, "peak_hours": self.peak_hours,
                "rules": self.rules,
                "zones": [r.to_dict() for r in self.roads] + [a.to_dict() for a in self.areas],
                "lane_lines": [ln.to_dict() for ln in self.lines]}

    def save(self, path):
        Path(path).write_text(json.dumps(self.to_dict(), indent=2))

    def draw(self, img, ui=1.0, s=1.0):
        for a in self.areas:
            a.draw(img, ui, s)
        for r in self.roads:
            r.draw(img, ui, s=s)
        for ln in self.lines:
            ln.draw(img, ui, s)


def load_camera_config(path, frame_w, frame_h, quiet=False):
    return camera_config_from_dict(json.loads(Path(path).read_text()), frame_w, frame_h, quiet)


def camera_config_from_dict(cfg, frame_w, frame_h, quiet=True, require_road=True):
    """Build (and validate) a camera config; zones are scaled from cfg["frame_size"] to frame_w x frame_h.
    Raises ValueError with a readable message when something is wrong."""
    cw, ch = cfg.get("frame_size") or [frame_w, frame_h]
    scale = (frame_w / cw, frame_h / ch)
    if scale != (1.0, 1.0) and not quiet:
        print(f"Zones were clicked on a {cw}x{ch} frame; scaling them to {frame_w}x{frame_h}.")
    roads, areas = [], []
    for z in cfg.get("zones", []):
        kind = z.get("type", "road")
        if kind == "road":
            roads.append(RoadZone(z["name"], z["points"], z["width_m"], z["length_m"], scale,
                                  road_category=z.get("road_category", "city"),
                                  allowed_direction=z.get("allowed_direction", "both"),
                                  speed_limit_kph=z.get("speed_limit_kph"),
                                  banned_classes=z.get("banned_classes", []),
                                  stopping_allowed=z.get("stopping_allowed", False),
                                  scale_source=z.get("scale_source", "measured"),
                                  speed_uncertainty_pct=z.get("speed_uncertainty_pct")))
        else:
            areas.append(AreaZone(kind, z["name"], z["points"], scale, approved=z.get("approved", False)))
    if not roads and require_road:
        raise ValueError("Draw at least one road zone")
    lines = [LaneLine(ln["name"], ln["points"], roads, scale) for ln in cfg.get("lane_lines", [])]
    return CameraConfig(roads, areas, lines, cfg.get("peak_hours"), cfg.get("speed_limits_kph"),
                        cfg.get("rules"), [frame_w, frame_h])
