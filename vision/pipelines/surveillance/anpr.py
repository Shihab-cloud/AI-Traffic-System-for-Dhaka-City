"""Bangladeshi number-plate reading (ANPR) for violating vehicles.

How it works
    1. Best shots: while a vehicle is tracked, the pipeline keeps its few largest full-resolution crops (a plate
       is most readable when the vehicle is nearest the camera).
    2. When the vehicle commits a violation, its crops are queued - including crops taken during the next few
       seconds, as it comes closer - and read in a background thread so the video pipeline never waits.
    3. Each crop: a plate detector finds the plate, a character detector trained on Bangladeshi plates finds the
       Bangla characters, and they are parsed into the BRTA layout:
           line 1: city [metro] - class letter         e.g. ঢাকা মেট্রো-গ
           line 2: 2-digit series - 4-digit number     e.g. ১২-৩৪৫৬
    4. Readings from several crops are combined by a confidence-weighted vote per character position.

A plate is only reported when the evidence supports it; otherwise the case is marked "unreadable" (with the
best plate image for the officer). It never guesses: a wrong plate is worse than no plate.
"""

import queue
import threading
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional

import cv2
import numpy as np

DIGITS = "০১২৩৪৫৬৭৮৯"
CITY = {"Dhaka": ("ঢাকা", "DHAKA"), "khulona": ("খুলনা", "KHULNA"), "zoshOro": ("যশোর", "JASHORE")}
METRO = ("মেট্রো", "METRO")
CLASS_LETTER = {"ka": ("ক", "KA"), "go": ("গ", "GA"), "co": ("চ", "CHA"), "To": ("ট", "TA"), "lo": ("ল", "LA"),
                "ho": ("হ", "HA"), "bo": ("ব", "BA"), "na": ("ন", "NA")}

# Acceptance thresholds, tuned on the validation plates for (almost) no wrong numbers and checked on the held-out
# test plates (see models/README.md).
MIN_PLATE_PX = 110      # narrower plates are never read (2-4% wrong numbers at 70-100 px on test plates)
MIN_AGREE = 3           # crops that must give exactly the same six digits
MIN_DIGIT_CONF = 0.7    # every digit of an agreeing crop must be at least this confident
MIN_WORD_CONF = 0.6     # city / class letter: confidence needed in the agreeing crops


@dataclass
class PlateRead:
    city: Optional[str] = None           # token name, e.g. "Dhaka"
    metro: bool = False
    letter: Optional[str] = None         # token name, e.g. "go"
    digits: list = field(default_factory=list)       # ["1", "2", ...] left to right on line 2
    digit_conf: list = field(default_factory=list)
    city_conf: float = 0.0
    letter_conf: float = 0.0
    plate_px: int = 0                    # plate width in the source frame (resolution evidence)

    @property
    def number_ok(self):
        return len(self.digits) == 6

    @property
    def complete(self):
        return self.number_ok and self.city is not None and self.letter is not None

    def text(self, script="bn"):
        i = 0 if script == "bn" else 1
        num = "".join(DIGITS[int(d)] if script == "bn" else d for d in self.digits)
        num = f"{num[:2]}-{num[2:]}" if len(num) == 6 else (num or "?")
        head = CITY[self.city][i] if self.city else "?"
        if self.metro:
            head += " " + METRO[i]
        head += "-" + (CLASS_LETTER[self.letter][i] if self.letter else "?")
        return f"{head} {num}"


def _iou(a, b):
    x1, y1, x2, y2 = max(a[0], b[0]), max(a[1], b[1]), min(a[2], b[2]), min(a[3], b[3])
    inter = max(0, x2 - x1) * max(0, y2 - y1)
    return inter / max(1e-6, (a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - inter)


def _inside(a, b):
    """Share of box a that lies inside box b."""
    x1, y1, x2, y2 = max(a[0], b[0]), max(a[1], b[1]), min(a[2], b[2]), min(a[3], b[3])
    return max(0, x2 - x1) * max(0, y2 - y1) / max(1e-6, (a[2] - a[0]) * (a[3] - a[1]))


def parse_plate(dets, w, h, plate_px=0):
    """dets: [(token, conf, x1, y1, x2, y2)] from the character detector on a plate crop of size w x h."""
    words = [d for d in dets if not d[0].isdigit()]
    digits = [d for d in dets if d[0].isdigit()]
    r = PlateRead(plate_px=plate_px)
    # Line 2 (series - number) lies below the words of line 1.
    if words:
        top = float(np.median([(d[3] + d[5]) / 2 for d in words]))
        word_h = float(np.median([d[5] - d[3] for d in words]))
        digits = [d for d in digits if (d[3] + d[5]) / 2 > top + 0.45 * word_h]
    else:
        digits = [d for d in digits if (d[3] + d[5]) / 2 > 0.4 * h]
    # One box per printed digit: overlapping boxes of different digit classes -> keep the more confident one.
    digits.sort(key=lambda d: -d[1])
    kept = []
    for d in digits:
        if all(_iou(d[2:], k[2:]) < 0.4 for k in kept):
            kept.append(d)
    kept.sort(key=lambda d: d[2])
    r.digits = [d[0] for d in kept]
    r.digit_conf = [d[1] for d in kept]
    cities = [d for d in words if d[0] in CITY]
    city_box = None
    if cities:
        best = max(cities, key=lambda d: d[1])
        r.city, r.city_conf, city_box = best[0], best[1], best[2:]
    metros = [d for d in words if d[0] == "meTrO" and d[1] >= 0.3]
    metro_box = None
    if metros:
        r.metro = True
        metro_box = max(metros, key=lambda d: d[1])[2:]
    # The class letter is the last token of line 1: right of "metro" (or of the city), not part of either word.
    anchor = metro_box or city_box
    letters = [d for d in words if d[0] in CLASS_LETTER
               and (anchor is None or (d[2] + d[4]) / 2 > anchor[2] - 0.02 * w)
               and not any(b is not None and _inside(d[2:], b) > 0.5 for b in (city_box, metro_box))]
    if letters:
        best = max(letters, key=lambda d: d[1])
        r.letter, r.letter_conf = best[0], best[1]
    return r


@dataclass
class PlateResult:
    status: str                 # "read" (all parts), "partial" (number only), "unreadable"
    text_bn: str = ""
    text_en: str = ""
    confidence: float = 0.0
    readings: int = 0           # crops in which a full 6-digit number was read
    agreeing: int = 0           # of those, how many agree with the final number
    plate_px: int = 0           # widest plate seen
    image: Optional[np.ndarray] = None   # best plate crop (always kept as evidence)


def vote(reads, min_plate_px=MIN_PLATE_PX, min_agree=MIN_AGREE, min_digit_conf=MIN_DIGIT_CONF,
         min_word_conf=MIN_WORD_CONF):
    """Combine readings of one vehicle. Each reading is weighted by its confidence and plate width.

    A number is reported only if `min_agree` readings give exactly the same six digits, each digit read with at
    least `min_digit_conf` confidence in those readings."""
    usable = [r for r in reads if r.number_ok and r.plate_px >= min_plate_px]
    if not usable:
        return PlateResult("unreadable", plate_px=max([r.plate_px for r in reads], default=0))
    weight = lambda r: (sum(r.digit_conf) / 6) * min(1.0, r.plate_px / 200)
    number = []
    for i in range(6):
        c = Counter()
        for r in usable:
            c[r.digits[i]] += weight(r) * r.digit_conf[i]
        number.append(c.most_common(1)[0][0])
    agreeing = [r for r in usable if r.digits == number and min(r.digit_conf) >= min_digit_conf]
    # City and class letter are reported only when enough of the agreeing crops read the same one confidently;
    # otherwise the result is "partial" (number only) and the officer reads them from the plate image.
    def agreed(attr, conf_attr):
        votes = Counter(getattr(r, attr) for r in agreeing if getattr(r, attr) and getattr(r, conf_attr) >= min_word_conf)
        if not votes:
            return None
        value, n = votes.most_common(1)[0]
        return value if n >= min_agree - 1 and n > len(agreeing) / 2 else None
    metro = sum(1 if r.metro else -1 for r in agreeing)
    final = PlateRead(city=agreed("city", "city_conf"), metro=metro > 0, letter=agreed("letter", "letter_conf"),
                      digits=number)
    best = max(agreeing or usable, key=lambda r: min(r.digit_conf))
    conf = (len(agreeing) / len(usable)) * min(best.digit_conf)
    # Report only with real support: enough confident crops that agree on all six digits, and no real dispute.
    if len(agreeing) < min_agree or len(agreeing) / len(usable) < 0.5:
        return PlateResult("unreadable", confidence=round(conf, 2), readings=len(usable), agreeing=len(agreeing),
                           plate_px=max(r.plate_px for r in reads))
    status = "read" if final.city and final.letter else "partial"
    return PlateResult(status, final.text("bn"), final.text("en"), round(conf, 2), len(usable), len(agreeing),
                       max(r.plate_px for r in reads))


class PlateReader:
    """Plate detector + Bangla character detector on one vehicle crop."""

    def __init__(self, plate_model, char_model, plate_imgsz=416, char_imgsz=320):
        from ultralytics import YOLO
        self.plates = YOLO(str(plate_model), task="detect")
        self.chars = YOLO(str(char_model), task="detect")
        self.plate_imgsz, self.char_imgsz = plate_imgsz, char_imgsz
        self.lock = threading.Lock()

    def read(self, vehicle_crop):
        """(PlateRead or None, plate image or None)"""
        with self.lock:
            r = self.plates.predict(vehicle_crop, imgsz=self.plate_imgsz, conf=0.35, verbose=False)[0]
            if not len(r.boxes):
                return None, None
            i = int(r.boxes.conf.argmax())
            x1, y1, x2, y2 = r.boxes.xyxy[i].int().tolist()
            pw, ph = x2 - x1, y2 - y1
            if pw < 20 or ph < 8:
                return None, None
            H, W = vehicle_crop.shape[:2]
            px, py = int(0.08 * pw), int(0.1 * ph)
            plate = vehicle_crop[max(0, y1 - py):min(H, y2 + py), max(0, x1 - px):min(W, x2 + px)]
            c = self.chars.predict(plate, imgsz=self.char_imgsz, conf=0.25, verbose=False)[0]
            names = self.chars.names
            dets = [(names[int(k)], float(cf), *map(float, b)) for k, cf, b in
                    zip(c.boxes.cls.tolist(), c.boxes.conf.tolist(), c.boxes.xyxy.tolist())]
            return parse_plate(dets, plate.shape[1], plate.shape[0], pw), plate


class PlateCollector:
    """Keeps each vehicle's best (largest) full-resolution crops and reads plates of violators in the background.

    `on_result(key, PlateResult)` is called from the background thread when a requested vehicle has been read.
    """

    def __init__(self, reader, on_result, keep=5, interval_sec=0.2, follow_sec=6.0, max_jobs=200):
        self.reader, self.on_result = reader, on_result
        self.keep, self.interval, self.follow = keep, interval_sec, follow_sec
        self.best = defaultdict(list)    # tid -> [(height, jpeg bytes)]
        self.last = {}                   # tid -> last sample time
        self.seen = {}                   # tid -> last time the tracker saw it
        self.wanted = {}                 # tid -> [key, deadline]
        self.jobs = queue.Queue(max_jobs)
        self.thread = threading.Thread(target=self._run, daemon=True, name="anpr")
        self.thread.start()

    def observe(self, tid, frame, bbox, t, cls=None):
        """Called for every motor vehicle in a road zone, each processed frame. cls [web]: its class (used by the web
        service's collector, not here)."""
        if t - self.last.get(tid, -1e9) < self.interval:
            return
        x1, y1, x2, y2 = bbox
        h = y2 - y1
        best = self.best[tid]
        if len(best) >= self.keep and h <= best[-1][0] * 1.03:
            return  # not closer than what we already have
        self.last[tid] = t
        H, W = frame.shape[:2]
        pad = int(0.04 * (x2 - x1))
        crop = frame[max(0, y1 - pad):min(H, y2 + pad), max(0, x1 - pad):min(W, x2 + pad)]
        if crop.size == 0:
            return
        jpg = cv2.imencode(".jpg", crop, [cv2.IMWRITE_JPEG_QUALITY, 95])[1].tobytes()
        best.append((h, jpg))
        best.sort(key=lambda b: -b[0])
        del best[self.keep:]

    def request(self, tid, key, t):
        """Read this vehicle's plate (key identifies the case, e.g. the violation id)."""
        if tid not in self.wanted:
            self.wanted[tid] = [key, t + self.follow]

    def tick(self, t, present):
        """Send finished requests (follow time over, or the vehicle left) to the reader; forget old tracks."""
        for tid in present:
            self.seen[tid] = t
        for tid, (key, deadline) in list(self.wanted.items()):
            if t >= deadline or t - self.seen.get(tid, t) > 1.5:  # gone for 1.5 s, not just hidden briefly
                self._submit(key, [j for _, j in self.best.get(tid, [])])
                del self.wanted[tid]
        for tid in [k for k in self.best if k not in present and k not in self.wanted]:
            if t - self.seen.get(tid, t) > 10:
                self.best.pop(tid, None)
                self.last.pop(tid, None)
                self.seen.pop(tid, None)

    def _submit(self, key, crops):
        try:
            self.jobs.put_nowait((key, crops))
        except queue.Full:
            self.on_result(key, PlateResult("unreadable"))

    def flush(self):
        """End of video: read everything still waiting, and wait for the reader."""
        for tid, (key, _) in list(self.wanted.items()):
            self._submit(key, [j for _, j in self.best.get(tid, [])])
        self.wanted.clear()
        self.jobs.join()

    def _run(self):
        while True:
            key, crops = self.jobs.get()
            try:
                reads, best_img, best_px = [], None, -1
                for jpg in crops:
                    img = cv2.imdecode(np.frombuffer(jpg, np.uint8), cv2.IMREAD_COLOR)
                    pr, plate = self.reader.read(img)
                    if pr is None:
                        continue
                    reads.append(pr)
                    if pr.plate_px > best_px:
                        best_img, best_px = plate, pr.plate_px
                result = vote(reads)
                result.image = best_img
                self.on_result(key, result)
            except Exception as e:  # never kill the reader thread
                print(f"ANPR error: {e}")
                self.on_result(key, PlateResult("unreadable"))
            finally:
                self.jobs.task_done()


def find_models(models_dir):
    """Paths of the plate detector and the character model, if installed."""
    d = Path(models_dir)
    plate = next((p for p in (d / "plate_detector.onnx",) if p.exists()), None)
    # PyTorch, not CoreML: the half-precision CoreML export changes the read characters on ~1 in 4 plates, and the
    # acceptance thresholds were tuned on this model. Plate reading is in the background, so speed is not critical.
    chars = d / "bd_plate_chars.pt" if (d / "bd_plate_chars.pt").exists() else None
    return plate, chars
