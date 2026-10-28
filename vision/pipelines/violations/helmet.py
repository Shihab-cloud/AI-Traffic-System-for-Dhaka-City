"""V6: motorbike rider or pillion without a helmet (both must wear one under the Road Transport Act 2018).

A classifier (models/helmet_cls.*) looks at a full-resolution crop of each moving motorbike - riders included -
a few times per second and gives the probability that someone on it is bare-headed. See models/README.md for its
training data and measured accuracy.

The decision is made once per motorbike, when it leaves the view, over all its sightings: at least 4 confident
bare-head sightings that are at least 3/4 of all confident sightings. Deciding early (at the first few frames)
let blur and occlusion through; deciding over the whole track did not, on the footage it was tuned on. The
evidence image is the frame with the strongest bare-head sighting.

[web] Kakoli overpass check (2026-10-28, every motorbike track of Part-1 and three Part-2 stretches; tracks the rule
reported were labelled by eye from their crops: helmet / bare-headed / cannot tell): the CSE499B settings (3
sightings, half of them, helmet below P 0.3, both directions) reported 85 motorbikes in Part-1 (18 min), of which
48 clearly wore helmets and 1 was clearly bare-headed, and 7 in the Part-2 stretches (4 helmeted, 2 bare-headed
pillions). Motorbikes going AWAY from this camera are seen from behind: the driver is hidden by the pillion and a
black helmet looks like black hair, and none of their reports was a confirmed bare head (13 helmeted, 15 unclear).
So the rule now judges only motorbikes coming toward the camera (`directions`) and asks for 4 sightings, 3/4 of
them bare, with P <= 0.5 counting as helmet: Part-1 16 reports (7 helmeted, 1 bare-headed, 8 unclear), Part-2
stretches 3 (both bare-headed pillions, 1 helmeted rider whose crop held the bare head of the next bike's rider).
The settings were chosen on these same tracks, so expect a little worse elsewhere. Motorbikes in a kerb strip
outside the road zone (V3 measures those since 2026-10-28, see zones.KERB_AREAS) are not judged: they crawl through
pavement crowds there and bare-headed pedestrians fill the crop (5 of 8 cases on the full Part-2 before this check).
A fine-tuned classifier with
this camera's helmeted crops and the Indonesian bare heads learned "this camera = helmet" and caught nothing; the
local VLM answered "helmet" for every crop, bare-headed ones included: neither is used.
"""

import cv2

from .base import BaseViolation

# Vehicles whose riders / passengers sit at head height next to a motorbike: their heads end up in its crop.
HEAD_LEVEL = ("Motorbike", "Bicycle", "Rickshaw", "Van")


class NoHelmet(BaseViolation):
    code = "V6"
    title = "Motorbike rider without helmet"
    DEFAULTS = {
        "classes": ["Motorbike"],
        "min_purity": 0.8,           # the vehicle model must be sure it is a motorbike (not a bicycle / cycle-van)
        "interval_sec": 0.25,        # classify each motorbike at most this often
        "min_box_px": 100,           # motorbike box height (full-res pixels); smaller = heads too small to judge
        "min_kph": 5.0,              # only moving motorbikes: someone sitting on a parked bike is not riding
        "expand_top": 0.45,          # the motorbike box often ends at the riders' shoulders: extend it so heads are inside
        "expand_side": 0.08,
        "bare_prob": 0.8,            # a sighting counts as "bare head" at or above this probability...
        "helmet_prob": 0.5,          # ...and as "helmets on" at or below this; in between it is ignored ([web] was 0.3)
        "min_votes": 4,              # bare-head sightings needed over the track ([web] was 3)
        "min_ratio": 0.75,           # bare-head sightings / all confident sightings over the track ([web] was 0.5)
        # [web] only motorbikes moving this way are judged ("toward_camera" / "away_from_camera"): from behind, the
        # driver is hidden by the pillion and black helmets look like hair (see the module notes)
        "directions": ["toward_camera"],
    }
    HEADINGS = {"toward_camera": 1, "away_from_camera": -1}

    def __init__(self, settings=None, camera=None, detector=None):
        """`detector(crop_bgr) -> probability (0-1) that someone on the motorbike has no helmet`."""
        super().__init__(settings, camera)
        self.detector = detector
        self.headings = {self.HEADINGS[d] for d in self.cfg["directions"]}  # [web]
        self.tracks = {}  # tid -> {"bare", "helmet", "last", "best_p", "best_obs", "best_frame"}

    def update(self, obs, ctx):
        if self.detector is None or obs.cls not in self.cfg["classes"] or obs.road is None:
            return None
        if obs.purity < self.cfg["min_purity"] or obs.heading not in self.headings:  # [web] heading 0 = not known yet
            return None
        if not obs.road.contains(obs.point):  # [web] in a kerb strip beside the road: pavement crowds fill the crop
            return None
        st = self.tracks.setdefault(obs.tid, {"bare": 0, "helmet": 0, "last": -1e9, "best_p": 0.0,
                                              "best_obs": None, "best_frame": None})
        if obs.time_s - st["last"] < self.cfg["interval_sec"]:
            return None
        x1, y1, x2, y2 = obs.bbox
        bw, bh = x2 - x1, y2 - y1
        if bh < self.cfg["min_box_px"] or obs.kph is None or obs.kph < self.cfg["min_kph"]:
            return None
        # In a column of bikes (or beside a rickshaw / van) other people's heads sit right above this bike: skip.
        top = y1 - self.cfg["expand_top"] * bh
        for o in ctx.scene.observations:
            if o.tid == obs.tid or o.cls not in HEAD_LEVEL:
                continue
            ox1, oy1, ox2, oy2 = o.bbox
            if min(x2, ox2) - max(x1, ox1) > 0.3 * min(bw, ox2 - ox1) and oy2 > top and oy1 < y1 + 0.5 * bh:
                return None
        H, W = ctx.frame.shape[:2]
        crop = ctx.frame[max(0, int(top)):min(H, int(y2)),
                         max(0, int(x1 - self.cfg["expand_side"] * bw)):min(W, int(x2 + self.cfg["expand_side"] * bw))]
        if crop.size == 0:
            return None
        st["last"] = obs.time_s
        p = float(self.detector(crop))
        if p >= self.cfg["bare_prob"]:
            st["bare"] += 1
            if p > st["best_p"]:  # keep the clearest evidence frame (JPEG, only for the best sighting)
                st["best_p"], st["best_obs"] = p, obs
                st["best_frame"] = cv2.imencode(".jpg", ctx.frame, [cv2.IMWRITE_JPEG_QUALITY, 90])[1].tobytes()
        elif p <= self.cfg["helmet_prob"]:
            st["helmet"] += 1
        return None

    def lost(self, tid):
        st = self.tracks.pop(tid, None)
        if not st or st["best_obs"] is None:
            return None
        bare, helmet = st["bare"], st["helmet"]
        if bare >= self.cfg["min_votes"] and bare / (bare + helmet) >= self.cfg["min_ratio"]:
            return self.event(st["best_obs"], {"bare_head_sightings": bare, "helmet_sightings": helmet,
                                               "max_probability": round(st["best_p"], 2)}, frame=st["best_frame"])
        return None

    def forget(self, tid):
        self.tracks.pop(tid, None)
