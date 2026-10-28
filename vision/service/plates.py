"""Plate reading with our models: BLPD plate detector + our character model (v2, 320 px).

The speed and violation pipelines show every vehicle to a `WebPlateCollector`, which keeps its best (largest)
full-resolution crops, and ask for a read when a vehicle commits a violation. The other-violations box also lists every
vehicle that passes (`on_vehicle`: the passed-vehicle list), with its plate read the same way. Plates are read as
plate_reader.py reads them: the plate must lie on the vehicle's own box (the crop's margin may hold a neighbour's
plate), the camera's clock overlay is not a plate, plates under 24 px are not read, and the reads are voted per vehicle
(PlateVotes), so a plate gets the same status ("confirmed" / "uncertain" / "partial" / ...) as plate_reader.py gives,
with one addition: "confirmed" also needs a plate at least CONFIRM_MIN_PX wide.
"""

import itertools
import queue
import threading
import time
from collections import Counter, defaultdict

import cv2
import numpy as np
import torch
from ultralytics.cfg import DEFAULT_CFG_DICT

from . import config
from plate_reader import (CLOCK_OVERLAY, MAX_PLATE_H, MAX_PLATE_W, NO_PLATE_CLASSES, NUMBER_DIGITS,  # noqa: E402
                          PLATE_PAD, VEHICLE_PAD, PlateVotes, evidence_image, pad_box, read_characters)

# A confirmed read fills the ticket's registration by itself, so it must come from a plate the characters can be
# seen on. The character model guesses the same number again and again on blurred plates: TEST clip, car #4252
# "confirmed" 12-0412 from 4 of 8 reads of a white 25 px blob; with a 40 px minimum, microbus #335 (41 px, 11-9911)
# and dump truck #2759 (44 px, 11-0599) were still "confirmed" on plates smeared by motion streaks. The only confirmed
# read known right on this camera was a clear 45 px plate (#2518, 21-6482), which now stays "uncertain" too: a wrong
# number on a ticket is worse than the officer typing it.
CONFIRM_MIN_PX = 50
# Crops per plate-detector call: ~76 ms per crop instead of ~280 ms one by one (RTX 2050, vehicle crops).
BATCH = 8
# Passed-vehicle list: a vehicle is listed once the tracker has lost it for good (it keeps a lost vehicle's id for
# 2 s, surveillance/detector.py), from its LOG_READS largest crops (a violator: all `keep`); shorter tracks than
# LOG_MIN_FRAMES are detector noise (plate_reader.py --min-frames).
LOG_GONE_SEC = 2.5
LOG_READS = 10
LOG_MIN_FRAMES = 5
# Vehicles waiting to be read: with a recorded video the video waits beyond MAX_WAITING (every vehicle is read); a live
# camera cannot wait, so beyond MAX_WAITING_LIVE passing vehicles are listed unread (violators are always read).
MAX_WAITING = 24
MAX_WAITING_LIVE = 200
# Multi-camera tracking: each listed vehicle's appearance vector comes from its VIEWS largest views (tight crops,
# at least VIEW_INTERVAL_SEC apart, so not three nearly identical frames).
VIEWS = 3
VIEW_INTERVAL_SEC = 0.3


class PlateModels:
    """Plate detector + character detector, loaded once and shared by all runs (one copy in GPU memory)."""

    def __init__(self, plate_model=config.PLATE_MODEL, ocr_model=config.OCR_MODEL, ocr_imgsz=config.OCR_IMGSZ,
                 plate_imgsz=640, plate_conf=0.25, ocr_conf=0.25, min_plate_px=24, full_weight_px=100):
        self.plate_path, self.ocr_path = plate_model, ocr_model
        self.plate_imgsz, self.ocr_imgsz = plate_imgsz, ocr_imgsz
        self.plate_conf, self.ocr_conf = plate_conf, ocr_conf
        self.min_plate_px, self.full_weight_px = min_plate_px, full_weight_px
        self.lock = threading.Lock()
        self._models = None
        self.common = {}

    def _load(self):
        if self._models is None:
            from ultralytics import YOLO
            if torch.cuda.is_available():
                self.common = {"device": "0", **({"quantize": 16} if "quantize" in DEFAULT_CFG_DICT else {"half": True})}
            else:
                self.common = {"device": "cpu"}
            self._models = YOLO(str(self.plate_path)), YOLO(str(self.ocr_path))
        return self._models

    def read(self, vehicle, vbox=None, ignore=()):
        """One vehicle crop -> (read dict or None, vote weight, plate crop or None, plate width in px, plate box).

        vbox: the vehicle's box in the crop (the crop has a margin); the plate's centre must be on it. ignore: boxes
        in the crop where a "plate" is something else (the camera's clock overlay). The weight is plate_reader.py's
        score: plate confidence x size factor x mean character confidence (0.01 when nothing was read)."""
        return self.read_batch([(vehicle, vbox, ignore)])[0]

    def read_batch(self, items):
        """[(vehicle crop, vbox, ignore)] -> [read() result for each], the models run on several crops per call."""
        with self.lock:
            plate_model, ocr_model = self._load()
            found = []   # per crop: (plate box, confidence) or None
            for i in range(0, len(items), BATCH):
                chunk = items[i:i + BATCH]
                results = plate_model.predict([c[0] for c in chunk], imgsz=self.plate_imgsz, conf=self.plate_conf,
                                              verbose=False, **self.common)
                found += [self._best_plate(vehicle, vbox, ignore, r) for (vehicle, vbox, ignore), r in zip(chunk, results)]
            plates, to_read = [], []
            for k, ((vehicle, _, _), f) in enumerate(zip(items, found)):
                plate = None
                if f is not None:
                    H, W = vehicle.shape[:2]
                    qx1, qy1, qx2, qy2 = pad_box(f[0], PLATE_PAD, PLATE_PAD, W, H)
                    plate = vehicle[qy1:qy2, qx1:qx2].copy()
                    if plate.size == 0:
                        plate = None
                    elif f[0][2] - f[0][0] >= self.min_plate_px and f[0][3] - f[0][1] >= 2:
                        to_read.append(k)
                plates.append(plate)
            reads = {}
            for i in range(0, len(to_read), 2 * BATCH):
                ks = to_read[i:i + 2 * BATCH]
                results = ocr_model.predict([plates[k] for k in ks], imgsz=self.ocr_imgsz, conf=self.ocr_conf, iou=0.5,
                                            agnostic_nms=True, verbose=False, **self.common)
                reads.update({k: read_characters(ocr_model.names, r) for k, r in zip(ks, results)})
            out = []
            for k, f in enumerate(found):
                if f is None:
                    out.append((None, 0.0, None, 0, None))
                    continue
                box, pc = f
                pw, read = round(box[2] - box[0]), reads.get(k)
                weight = pc * min(1.0, pw / self.full_weight_px) * (read["conf"] if read else 0.01)
                out.append((read, weight, plates[k], pw, tuple(int(v) for v in box)))
            return out

    @staticmethod
    def _best_plate(vehicle, vbox, ignore, result):
        """The most confident plate detection that can be this vehicle's plate, as (box, confidence), or None."""
        H, W = vehicle.shape[:2]
        vx1, vy1, vx2, vy2 = vbox or (0, 0, W, H)
        best = None
        for box, pc in zip(result.boxes.xyxy.tolist(), result.boxes.conf.tolist()):
            mx, my = (box[0] + box[2]) / 2, (box[1] + box[3]) / 2
            if not (vx1 <= mx <= vx2 and vy1 <= my <= vy2):
                continue  # a neighbour's plate in the crop's margin
            if box[2] - box[0] > MAX_PLATE_W * (vx2 - vx1) or box[3] - box[1] > MAX_PLATE_H * (vy2 - vy1):
                continue  # far too big for a plate: a false detection
            if any(ix1 <= mx <= ix2 and iy1 <= my <= iy2 for ix1, iy1, ix2, iy2 in ignore or ()):
                continue
            if best is None or pc > best[1]:
                best = (box, pc)
        return best


def unread(min_agree=3, status=None):
    r = {**PlateVotes().result(min_agree), "plate_px": 0, "reads": 0, "complete": 0}
    return {**r, "status": status} if status else r


class WebPlateCollector:
    """Keeps every vehicle's best full-resolution crops and reads plates in a background thread.

    observe() is called for each vehicle in each frame, request() when it commits a violation. A requested vehicle is
    read once it has left the picture (or after follow_sec): one coming toward the camera is closest, its plate
    largest, just before it leaves; one going away was closest when it came in, before it broke any rule. So each
    vehicle keeps its `keep` largest crops, at least interval_sec apart (plate_reader.py also stops reading a vehicle
    after 30 complete reads), from the frames before and after the violation.

    With on_vehicle (the passed-vehicle list), every vehicle that leaves is read too, from its LOG_READS largest crops
    (stopping after the first BATCH when none shows a plate), after the violators. A violator that leaves is read once,
    for its cases and its list entry.

    on_result(key, result, plate_image, evidence_image) and on_vehicle(vehicle, result, plate_image, evidence_image)
    are called from the reader thread. `result` is PlateVotes.result() plus plate_px (width of the best plate), reads
    (crops with characters) and complete (6-digit reads); evidence_image is plate_reader.py's: the vehicle with its
    plate boxed, the plate enlarged, the fused read. `vehicle`: track_id, class (majority), first_s / last_s (video
    time it was first / last seen), frames, thumb (JPEG of its largest view, any size), and for multi-camera tracking
    entry / exit (bottom-centre of its first / last box, fractions of the frame), frame ([w, h]), embedding and colour
    (service/reid.py; None when the encoder is off).

    read_listed=False lists passing vehicles without reading their plates (the speed box: only violators' plates are
    read there; the list is for the Vehicle IDs)."""

    def __init__(self, models, on_result, on_vehicle=None, min_agree=3, keep=30, interval_sec=0.1, follow_sec=20.0,
                 min_vehicle_px=100, live=False, read_listed=True, encoder=None):
        self.models, self.on_result, self.on_vehicle, self.min_agree = models, on_result, on_vehicle, min_agree
        self.keep, self.interval, self.follow, self.min_vehicle_px = keep, interval_sec, follow_sec, min_vehicle_px
        self.live, self.read_listed, self.encoder = live, read_listed, encoder
        self.best = defaultdict(list)    # tid -> [(width, jpeg, vehicle box in the crop, clock box in the crop)]
        self.last = {}                   # tid -> last sample time
        self.seen = {}                   # tid -> last time the tracker saw it
        self.wanted = {}                 # tid -> [key, deadline]
        # A vehicle with two violations (e.g. a bicycle that is banned AND on the wrong side) has two cases, and both
        # need the plate: later cases ride along with the first one.
        self.more_keys = {}              # first case's key -> later cases of the same vehicle
        self.vehicles = {}               # tid -> passed-vehicle list entry being built (with on_vehicle)
        # Violators first (priority 0), then passing vehicles (1), each in the order they left.
        self.jobs = queue.PriorityQueue()
        self.order = itertools.count()
        self.waiting = 0                 # passing vehicles waiting to be read
        self.waiting_lock = threading.Lock()
        self.thread = threading.Thread(target=self._run, daemon=True, name="plates")
        self.thread.start()

    def observe(self, tid, frame, bbox, t, cls=None):
        """A vehicle box (whole pixels) in this frame; cls: its class, if known (pedal vehicles carry no plate)."""
        x1, y1, x2, y2 = bbox
        width = x2 - x1
        if self.on_vehicle is not None:
            H, W = frame.shape[:2]
            foot = [round((x1 + x2) / 2 / W, 4), round(y2 / H, 4)]   # where it touches the road
            v = self.vehicles.get(tid)
            if v is None:
                v = self.vehicles[tid] = {"first": t, "last": t, "classes": Counter(), "frames": 0, "thumb": None,
                                          "entry": foot, "frame": [W, H], "views": [], "view_t": -1e9}
            v["last"], v["frames"], v["exit"] = t, v["frames"] + 1, foot
            if cls:
                v["classes"][cls] += 1
            if v["thumb"] is None or width > 1.1 * v["thumb"][0]:   # its largest view, for the list
                jpg = self._jpeg(frame, bbox, 90)
                if jpg:
                    v["thumb"] = (width, jpg[0])
            views = v["views"]
            if (self.encoder is not None and t - v["view_t"] >= VIEW_INTERVAL_SEC
                    and (len(views) < VIEWS or width > 1.05 * views[-1][0])):
                ok, buf = cv2.imencode(".jpg", frame[max(y1, 0):y2, max(x1, 0):x2], [cv2.IMWRITE_JPEG_QUALITY, 90])
                if ok:
                    v["view_t"] = t
                    views.append((width, buf.tobytes()))
                    views.sort(key=lambda w: -w[0])
                    del views[VIEWS:]
        if (width < self.min_vehicle_px or (cls and cls.lower() in NO_PLATE_CLASSES)
                or t - self.last.get(tid, -1e9) < self.interval):
            return
        best = self.best[tid]
        if len(best) >= self.keep and width <= best[-1][0] * 1.03:
            return  # not closer than what we already have
        self.last[tid] = t
        jpg = self._jpeg(frame, bbox, 95)
        if jpg:
            best.append((width, *jpg))
            best.sort(key=lambda b: -b[0])
            del best[self.keep:]

    @staticmethod
    def _jpeg(frame, bbox, quality):
        """(JPEG of the vehicle with plate_reader's margin, vehicle box in it, clock overlay box in it) or None."""
        x1, y1, x2, y2 = bbox
        H, W = frame.shape[:2]
        cx1, cy1, cx2, cy2 = pad_box(bbox, VEHICLE_PAD, VEHICLE_PAD, W, H)
        crop = frame[cy1:cy2, cx1:cx2]
        ok, buf = cv2.imencode(".jpg", crop, [cv2.IMWRITE_JPEG_QUALITY, quality]) if crop.size else (False, None)
        if not ok:
            return None
        kx1, ky1, kx2, ky2 = (round(f * s) for f, s in zip(CLOCK_OVERLAY, (W, H, W, H)))
        return buf.tobytes(), (x1 - cx1, y1 - cy1, x2 - cx1, y2 - cy1), (kx1 - cx1, ky1 - cy1, kx2 - cx1, ky2 - cy1)

    def request(self, tid, key, t):
        """Read this vehicle's plate for case `key` (the violation's id)."""
        first = self.wanted.get(tid)
        if first is None:
            self.wanted[tid] = [key, t + self.follow]
        elif key != first[0]:
            self.more_keys.setdefault(first[0], []).append(key)

    def tick(self, t, present):
        """After each frame: read the requested vehicles that left or were followed long enough, list the vehicles
        that left, forget vehicles gone for 10 s. With a recorded video, wait while too many vehicles wait to be read."""
        for tid in present:
            self.seen[tid] = t
        gone = lambda tid: t - self.seen.get(tid, t) > LOG_GONE_SEC  # noqa: E731
        for tid, (key, deadline) in list(self.wanted.items()):
            if gone(tid) or t >= deadline:
                self._submit(tid, key, listed=gone(tid))
                del self.wanted[tid]
        for tid in [k for k in self.vehicles if k not in self.wanted and gone(k)]:
            self._submit(tid, None, listed=True)
        for tid in [k for k, s in self.seen.items() if t - s > 10 and k not in self.wanted]:
            for d in (self.best, self.last, self.seen, self.vehicles):
                d.pop(tid, None)
        while not self.live and self.waiting >= MAX_WAITING:
            time.sleep(0.05)

    def flush(self):
        """End of the video: read every vehicle still waiting, list the ones still in view, wait for the reader."""
        for tid, (key, _) in list(self.wanted.items()):
            self._submit(tid, key, listed=True)
        self.wanted.clear()
        for tid in list(self.vehicles):
            self._submit(tid, None, listed=True)
        self.jobs.join()

    def _submit(self, tid, key, listed):
        """Queue a read: for case `key` (and the vehicle's later cases) and/or, if `listed`, its list entry."""
        keys = [key, *self.more_keys.pop(key, [])] if key else []
        vehicle = None
        if listed and self.on_vehicle is not None:
            v = self.vehicles.pop(tid, None)
            if v is not None and v["frames"] >= LOG_MIN_FRAMES:
                vehicle = {"track_id": tid, "class": v["classes"].most_common(1)[0][0] if v["classes"] else "",
                           "first_s": v["first"], "last_s": v["last"], "frames": v["frames"],
                           "thumb": v["thumb"][1] if v["thumb"] else None,
                           "entry": v["entry"], "exit": v.get("exit", v["entry"]), "frame": v["frame"],
                           "views": [jpg for _, jpg in v["views"]]}
        if not keys and vehicle is None:
            return
        crops = list(self.best.get(tid, []))   # a copy: the vehicle may still be in view and get new crops
        read = bool(keys) or self.read_listed
        if not keys:
            if self.live and self.waiting >= MAX_WAITING_LIVE:
                self.on_vehicle(vehicle, unread(self.min_agree, "not read"), None, None)   # reader far behind
                return
            with self.waiting_lock:
                self.waiting += 1
        self.jobs.put((0 if keys else 1, next(self.order),
                       {"keys": keys, "vehicle": vehicle, "read": read,
                        "crops": (crops if keys else crops[:LOG_READS]) if read else []}))

    def _run(self):
        while True:
            _, _, job = self.jobs.get()
            try:
                result, plate, evidence = (self._read(job) if job["read"]
                                           else (unread(self.min_agree, "not read"), None, None))
            except Exception as e:  # never kill the reader thread
                print(f"Plate reader error: {e!r}")
                result, plate, evidence = unread(self.min_agree), None, None
            vehicle = job["vehicle"]
            if vehicle is not None:
                views = vehicle.pop("views", [])
                vehicle["embedding"] = vehicle["colour"] = None
                if self.encoder is not None and views:
                    try:
                        imgs = [cv2.imdecode(np.frombuffer(j, np.uint8), cv2.IMREAD_COLOR) for j in views]
                        vehicle["embedding"], vehicle["colour"] = self.encoder.features(imgs)
                    except Exception as e:
                        print(f"Appearance vector error: {e!r}")
            try:
                for key in job["keys"]:
                    self.on_result(key, result, plate, evidence)
                if job["vehicle"] is not None:
                    self.on_vehicle(job["vehicle"], result, plate, evidence)
            except Exception as e:
                print(f"Plate result not delivered: {e!r}")
            finally:
                if not job["keys"]:
                    with self.waiting_lock:
                        self.waiting -= 1
                self.jobs.task_done()

    def _read(self, job):
        """(result, best plate crop, evidence image) of one vehicle's crops, largest first."""
        votes, best = PlateVotes(), None   # best: (weight, vehicle crop, plate box in it, plate crop)
        widest = {}   # complete number read -> widest plate it was read on
        crops = job["crops"]
        for i in range(0, len(crops), BATCH):
            items = []
            for _, jpg, vbox, clock in crops[i:i + BATCH]:
                img = cv2.imdecode(np.frombuffer(jpg, np.uint8), cv2.IMREAD_COLOR)
                if img is not None:
                    items.append((img, vbox, [clock]))
            for (img, _, _), (read, weight, plate, pw, pbox) in zip(items, self.models.read_batch(items)):
                if plate is None:
                    continue
                votes.seen += 1
                if read:
                    votes.add(read, weight)
                    if len(read["digits"]) == NUMBER_DIGITS:
                        widest[read["digits"]] = max(widest.get(read["digits"], 0), pw)
                if best is None or weight > best[0]:  # keep the clearest plate as evidence
                    best = (weight, img, pbox, plate)
            if not job["keys"] and not votes.seen:
                break   # a passing vehicle with no plate in its largest crops: the smaller ones will not show one
        result = {**votes.result(self.min_agree), "reads": votes.reads, "complete": votes.complete,
                  "plate_px": best[2][2] - best[2][0] if best else 0}
        if result["status"] == "confirmed" and widest.get(result["number"].replace("-", ""), 0) < CONFIRM_MIN_PX:
            result["status"] = "uncertain"
        evidence = evidence_image(best, result["registration"]) if best else None
        return result, best[3] if best else None, evidence
