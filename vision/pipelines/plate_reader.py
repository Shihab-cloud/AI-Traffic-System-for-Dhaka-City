"""
Vehicle Tracking + Licence Plate Reading (Bangladeshi plates)

Same detector/tracker setup as vehicle_tracker.py (imports its helpers), plus, for every tracked vehicle:
    1. a plate detector runs on the vehicle's crop; the best plate inside the vehicle box is kept,
    2. a character detector reads the plate crop: digits, the area word (Dhaka, Chattogram, ...), "Metro" and the
       class letter (Ka, Kha, Ga, ...); these are put back together in BRTA plate order,
    3. the reads from all frames of the track are fused: a weighted vote per digit position, area, Metro and letter,
       so one blurred frame cannot decide the number. Bigger, sharper (more confident) plates count more.

Output: one CSV row per vehicle (track id, class, registration number, first/last time seen, read status ...),
optionally an annotated video, every single read (--reads-csv) and one evidence image per vehicle (--plates-dir:
vehicle crop + its best plate, enlarged) so the numbers can be checked by eye.

Models (Ultralytics .pt files; defaults are from https://github.com/prosensarker4/BLPD, put them in plate_models/)
    --plate-model  plate detector (LPD_Model.pt, YOLOv12m, class "License_Plate")
    --ocr-model    character detector whose class names are digits 0-9, area names, "Metro" and the letters
                   (LPNR_Model.pt, YOLOv12n, 105 classes). Your own model works if it uses the same naming.

Registration format: "<area> [Metro]-<letter> NN-NNNN", e.g. "Dhaka Metro-Ga 12-3456". Area and letter are the OCR
model's class names (romanised), the number uses ASCII digits. A part that could not be read is shown as "?".

Usage
    python plate_reader.py --source video.mp4 --start 60 --end 120 --csv test_plates.csv --plates-dir test_plates
    python plate_reader.py --source video.mp4 --no-show --csv plates.csv --plates-dir plates
"""

import argparse
import csv
import re
import time
from collections import Counter, deque
from datetime import datetime, timedelta
from itertools import combinations
from pathlib import Path

import cv2
import numpy as np
import torch
from ultralytics import YOLO
from ultralytics.cfg import DEFAULT_CFG_DICT

from speed_tracker import draw_label
from vehicle_tracker import (FrameReader, LiveFrameReader, build_tracker_cfg, color_for, is_live,
                             open_capture, select_classes)

# Vehicles that normally carry no BRTA plate: tracked and listed in the CSV, but not searched for a plate.
NO_PLATE_CLASSES = {"bicycle", "rickshaw", "van", "wheelbarrow", "pedestrian", "person", "bhotbhoti", "powertiller"}
# Class letters (end of line 1). Romanised as the BLPD character model names them, plus Bengali for other models.
LETTERS = {"A", "E", "I", "U", "Ka", "Kha", "Ga", "Gha", "Cha", "Chha", "Ja", "Jha", "Ta", "Tha", "TA", "THA", "Da",
           "Dha", "DA", "DHA", "Na", "Pa", "Pha", "Fa", "Ba", "Bha", "Ma", "Ya", "Ra", "La", "Sha", "Sa", "Ha"}
LETTERS |= set("অইউএকখগঘঙচছজঝটঠডঢতথদধনপফবভমযরলশষসহ")
METRO = {"metro", "মেট্রো"}
AREA_FIX = {"Cox-s Bazar": "Cox's Bazar", "Cox-s-Bazar": "Cox's Bazar"}
BN_DIGITS = str.maketrans("০১২৩৪৫৬৭৮৯", "0123456789")
NUMBER_DIGITS = 6        # line 2 is "NN-NNNN"
VEHICLE_PAD = 0.05       # vehicle crop margin (fraction of box size): plates sit on the bumper, at the box edge
PLATE_PAD = 0.10         # plate crop margin for the character detector
MAX_PLATE_W, MAX_PLATE_H = 0.7, 0.5  # a plate is never wider/taller than this fraction of its vehicle box
# The camera's clock overlay (bottom-right "09/22/2026 17:37:15") looks like a two-line plate to the detector.
# Fractions of the frame; plates centred here are ignored unless --ignore is given.
CLOCK_OVERLAY = (0.85, 0.89, 1.0, 1.0)
CONFIRM_CONF = 0.7       # "confirmed" needs every digit to have >= 70% of its vote (and half the reads to agree)
PLATE_COLOR = (0, 255, 255)
HUD_CARDS = 5
FONT = cv2.FONT_HERSHEY_SIMPLEX


def parse_args(argv=None):
    p = argparse.ArgumentParser(description="YOLO vehicle tracking with licence plate reading")
    p.add_argument("--source", required=True, help="Video path")
    p.add_argument("--model", default="bd_vehicles_best.pt", help="Vehicle detection checkpoint")
    p.add_argument("--plate-model", default="plate_models/LPD_Model.pt", help="Plate detection checkpoint")
    p.add_argument("--ocr-model", default="plate_models/LPNR_Model.pt", help="Plate character detection checkpoint")
    p.add_argument("--start", type=float, default=0.0, help="Start at this video time (s)")
    p.add_argument("--end", type=float, default=None, help="Stop at this video time (s)")
    p.add_argument("--start-time", default=None,
                   help='Clock time of the first video frame, "YYYY-MM-DD HH:MM:SS" '
                        "(default: read from a YYYYMMDD_HHMMSS stamp in the file name)")
    # vehicles: same meaning as in vehicle_tracker.py
    p.add_argument("--classes", nargs="+", default=None, help='Vehicle class names to track, or "all"')
    p.add_argument("--exclude", nargs="*", default=None, help="Class names to drop (default: person/pedestrian)")
    p.add_argument("--conf", type=float, default=None,
                   help="Min confidence to start/confirm a track (default: the tracker's own tuned value)")
    p.add_argument("--imgsz", type=int, default=640, help="Vehicle model inference size (multiple of 32)")
    p.add_argument("--roi", type=int, nargs=4, metavar=("X1", "Y1", "X2", "Y2"), default=None,
                   help="Only detect vehicles inside this pixel rectangle")
    p.add_argument("--class-nms", action="store_true", help="Per-class NMS (default is class-agnostic)")
    p.add_argument("--device", default=None, help='"0" for GPU, "cpu" for CPU (default: auto)')
    p.add_argument("--tracker", default="bytetrack",
                   choices=["bytetrack", "botsort", "ocsort", "deepocsort", "tracktrack", "fasttrack"])
    p.add_argument("--reid", action="store_true", help="Use appearance (ReID) features: botsort/deepocsort/tracktrack")
    p.add_argument("--track-buffer-sec", type=float, default=1.0, help="Seconds a lost track is kept alive")
    p.add_argument("--min-frames", type=int, default=5, help="Frames a track must exist to be listed in the CSV")
    # plates
    p.add_argument("--plate-classes", nargs="+", default=None,
                   help="Vehicle classes to search for plates (default: all tracked classes except "
                        "bicycle, rickshaw, van, wheelbarrow, bhotbhoti, powertiller)")
    p.add_argument("--plate-imgsz", type=int, default=640, help="Plate detector input size (a vehicle crop is resized to it)")
    p.add_argument("--plate-conf", type=float, default=0.25, help="Min plate detection confidence")
    p.add_argument("--ocr-imgsz", type=int, default=640, help="Character detector input size (a plate crop is resized to it)")
    p.add_argument("--ocr-conf", type=float, default=0.25, help="Min confidence of one character")
    p.add_argument("--ignore", type=int, nargs=4, action="append", metavar=("X1", "Y1", "X2", "Y2"), default=None,
                   help="Ignore plates centred in this pixel rectangle (repeatable). Default: the clock overlay in "
                        "the bottom-right corner. --ignore 0 0 0 0 ignores nothing")
    p.add_argument("--min-vehicle-px", type=int, default=100,
                   help="Skip vehicles narrower than this (pixels): their plates are too small to read")
    p.add_argument("--min-plate-px", type=int, default=24, help="Do not read plates narrower than this (pixels)")
    p.add_argument("--full-weight-px", type=int, default=100,
                   help="Plates at least this wide count fully in the vote; narrower ones proportionally less")
    p.add_argument("--plate-every", type=int, default=1,
                   help="Search plates every N frames (1 = every frame, most reads; 2-3 = faster)")
    p.add_argument("--max-reads", type=int, default=30,
                   help="Stop reading a vehicle after this many complete reads (saves time; the vote is settled)")
    p.add_argument("--min-agree", type=int, default=3,
                   help="Complete reads that must give exactly the final number for status 'confirmed' "
                        "(they must also be at least half of all complete reads)")
    p.add_argument("--batch", type=int, default=16, help="Crops per plate/character model call (lower it if the GPU runs out of memory)")
    # outputs
    p.add_argument("--csv", default="plates.csv", help="Path to save one row per vehicle (.csv)")
    p.add_argument("--reads-csv", default=None, help="Path to save every single plate read (.csv, for checking)")
    p.add_argument("--plates-dir", default=None, help="Folder for one evidence image per vehicle (vehicle + best plate)")
    p.add_argument("--no-show", action="store_true", help="Don't open a preview window")
    return p.parse_args(argv)


def is_digit_name(name: str) -> bool:
    d = name.strip().translate(BN_DIGITS)
    return len(d) == 1 and d.isdigit()


def read_characters(names: dict, result) -> dict | None:
    """Put one plate's character boxes back in plate order.

    Bangladeshi plates have two lines: "<area> [Metro]-<letter>" on top and the number "NN-NNNN" below.
    Words are taken by class (best-scoring area, best-scoring letter); digits are the row under the words,
    sorted left to right. Returns {area, metro, letter, digits, conf} or None if nothing was read.
    """
    words, digits = [], []
    for (x1, y1, x2, y2), c, cf in zip(result.boxes.xyxy.tolist(), result.boxes.cls.int().tolist(),
                                       result.boxes.conf.tolist()):
        name = names[c].strip()
        if is_digit_name(name):
            digits.append(((x1 + x2) / 2, (y1 + y2) / 2, y2 - y1, name.translate(BN_DIGITS), cf))
        else:
            words.append((name, cf, (y1 + y2) / 2))
    if words and digits:  # the number is on line 2: drop digits detected at or above the words' line
        top = sum(cf * y for _, cf, y in words) / sum(cf for _, cf, _ in words)
        digits = [d for d in digits if d[1] > top]
    if digits:  # keep one row of digits (removes stray boxes above/below it), left to right
        mid_y = float(np.median([d[1] for d in digits]))
        mid_h = float(np.median([d[2] for d in digits]))
        digits = sorted((d for d in digits if abs(d[1] - mid_y) <= 0.6 * mid_h), key=lambda d: d[0])
    areas = [(AREA_FIX.get(n, n), cf) for n, cf, _ in words if n.lower() not in METRO and n not in LETTERS]
    letters = [(n, cf) for n, cf, _ in words if n in LETTERS]
    area = max(areas, key=lambda t: t[1], default=("", 0.0))
    letter = max(letters, key=lambda t: t[1], default=("", 0.0))
    if not digits and not area[0] and not letter[0]:
        return None
    confs = [d[4] for d in digits] + [cf for _, cf in (area, letter) if cf > 0]
    return {
        "area": area[0],
        "metro": any(n.lower() in METRO for n, _, _ in words),
        "letter": letter[0],
        "digits": "".join(d[3] for d in digits),
        "conf": sum(confs) / len(confs),
    }


def registration(area: str, metro: bool, letter: str, number: str) -> str:
    """BRTA order: "Dhaka Metro-Ga 12-3456". Unread parts become "?"; empty if nothing was read."""
    if not (area or letter or number):
        return ""
    return f"{area or '?'}{' Metro' if metro else ''}-{letter or '?'} {number or '?'}"


class PlateVotes:
    """All plate reads of one vehicle, fused into one registration number.

    A read's weight = plate-detector confidence x mean character confidence x plate size factor.
    The number is voted digit by digit over the complete (6-digit) reads, so different frames can each
    contribute the digits they got right; area, Metro and letter are voted as whole words.
    """

    def __init__(self):
        self.digit_votes = [Counter() for _ in range(NUMBER_DIGITS)]  # position -> {digit: weight}
        self.exact = Counter()    # complete number -> reads that gave exactly it
        self.partial = Counter()  # incomplete digit string -> weight
        self.area, self.letter, self.metro = Counter(), Counter(), Counter()
        self.complete = 0         # complete reads
        self.reads = 0            # reads with at least one character
        self.seen = 0             # frames in which a plate was found on this vehicle

    def add(self, read: dict, weight: float):
        self.reads += 1
        digits = read["digits"]
        if len(digits) == NUMBER_DIGITS:
            self.complete += 1
            self.exact[digits] += 1
            for votes, ch in zip(self.digit_votes, digits):
                votes[ch] += weight
        elif len(digits) < NUMBER_DIGITS:  # too many digits (e.g. the dash read as "1"): don't trust any of them
            self.partial[digits] += weight
        if read["area"]:
            self.area[read["area"]] += weight
            self.metro[read["metro"]] += weight
        if read["letter"]:
            self.letter[read["letter"]] += weight

    def result(self, min_agree: int) -> dict:
        number, conf, agree = "", 0.0, 0
        if self.complete:
            total = sum(self.digit_votes[0].values()) or 1.0
            best = [v.most_common(1)[0] for v in self.digit_votes]
            digits = "".join(ch for ch, _ in best)
            conf = min(wt for _, wt in best) / total  # vote share of the least certain digit
            agree = self.exact[digits]
            number = f"{digits[:2]}-{digits[2:]}"
            sure = agree >= min_agree and agree >= self.complete / 2 and conf >= CONFIRM_CONF
            status = "confirmed" if sure else "uncertain"
        elif self.partial:
            number = self.partial.most_common(1)[0][0]
            status = "partial"
        else:
            status = "unreadable" if self.seen or self.reads else "no plate found"
        area = self.area.most_common(1)[0][0] if self.area else ""
        metro = bool(area) and self.metro.most_common(1)[0][0]
        letter = self.letter.most_common(1)[0][0] if self.letter else ""
        return {"registration": registration(area, metro, letter, number), "number": number, "area": area,
                "metro": metro, "letter": letter, "status": status, "conf": conf, "agree": agree}


class Track:
    def __init__(self, frame_idx):
        self.first = self.last = frame_idx
        self.classes = Counter()
        self.plate = PlateVotes()
        self.checked = False     # a plate search ran on this vehicle at least once
        self.text = ""           # current registration, shown on the video
        self.best = None         # (score, vehicle crop, plate box in that crop, plate crop) of the best plate so far
        self.evidence_path = ""


def predict_batches(model, images, batch, **kwargs):
    """Ultralytics treats a list as one batch; split it so a crowded frame does not run out of GPU memory."""
    results = []
    for i in range(0, len(images), batch):
        results += model.predict(images[i:i + batch], verbose=False, **kwargs)
    return results


def pad_box(box, frac_x, frac_y, w, h):
    x1, y1, x2, y2 = box
    px, py = (x2 - x1) * frac_x, (y2 - y1) * frac_y
    return (max(0, int(x1 - px)), max(0, int(y1 - py)), min(w, int(np.ceil(x2 + px))), min(h, int(np.ceil(y2 + py))))


def iou(a, b):
    ix = max(0.0, min(a[2], b[2]) - max(a[0], b[0]))
    iy = max(0.0, min(a[3], b[3]) - max(a[1], b[1]))
    inter = ix * iy
    union = (a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - inter
    return inter / union if union > 0 else 0.0


def video_start_time(source: str, text: str | None):
    """Clock time of video frame 0: --start-time, else a YYYYMMDD_HHMMSS stamp in the file name, else None."""
    if text:
        try:
            return datetime.strptime(text.strip(), "%Y-%m-%d %H:%M:%S")
        except ValueError:
            raise SystemExit(f'--start-time "{text}" must look like "2026-09-22 17:36:15"')
    m = re.search(r"(20\d{6})_(\d{6})", Path(source).stem)
    if m:
        try:
            return datetime.strptime(m.group(1) + m.group(2), "%Y%m%d%H%M%S")
        except ValueError:
            pass
    return None


def fmt_time(frame_idx, fps, clock0):
    sec = frame_idx / fps
    if clock0:
        return (clock0 + timedelta(seconds=round(sec))).strftime("%Y-%m-%d %H:%M:%S")
    return f"{int(sec // 3600)}:{int(sec % 3600 // 60):02d}:{sec % 60:04.1f}"


def fit_crop(crop, width, height):
    """Resize a plate crop into a ``width`` x ``height`` black canvas, keeping its aspect ratio."""
    canvas = np.zeros((height, width, 3), dtype=np.uint8)
    ch, cw = crop.shape[:2]
    if ch < 1 or cw < 1:
        return canvas
    s = min(width / cw, height / ch)
    nw, nh = max(1, int(cw * s)), max(1, int(ch * s))
    thumb = cv2.resize(crop, (nw, nh), interpolation=cv2.INTER_CUBIC if s > 1 else cv2.INTER_AREA)
    x, y = (width - nw) // 2, (height - nh) // 2
    canvas[y:y + nh, x:x + nw] = thumb
    return canvas


def draw_corners(img, box, color, ui):
    """Thin box with thick corners: marks a plate without hiding it."""
    x1, y1, x2, y2 = (int(round(v)) for v in box)
    cv2.rectangle(img, (x1, y1), (x2, y2), color, 1, cv2.LINE_8)
    t = max(2, round(3 * ui))
    n = max(3, min(x2 - x1, y2 - y1) // 3)
    for x, y, dx, dy in ((x1, y1, 1, 1), (x2, y1, -1, 1), (x2, y2, -1, -1), (x1, y2, 1, -1)):
        cv2.line(img, (x, y), (x + dx * n, y), color, t, cv2.LINE_AA)
        cv2.line(img, (x, y), (x, y + dy * n), color, t, cv2.LINE_AA)


def note_hud(cards, tid, text, crop):
    """Put this vehicle's plate at the top of the on-screen list."""
    cards[:] = [c for c in cards if c["id"] != tid]
    cards.insert(0, {"id": tid, "text": f"#{tid} {text}", "crop": crop})
    del cards[HUD_CARDS:]


def draw_hud(frame, cards, ui):
    """Latest plates read, newest first, in a column at the top-right corner."""
    h, w = frame.shape[:2]
    cw, ch, gap = int(300 * ui), int(90 * ui), int(38 * ui)
    x, y = w - cw - int(15 * ui), int(15 * ui)
    for card in cards:
        if y + ch + gap > h:
            break
        frame[y:y + ch, x:x + cw] = fit_crop(card["crop"], cw, ch)
        cv2.rectangle(frame, (x, y), (x + cw, y + ch), PLATE_COLOR, 1)
        draw_label(frame, card["text"], (x, y + ch + int(26 * ui)), PLATE_COLOR, 0.6 * ui)
        y += ch + gap


def evidence_image(best, text):
    """Vehicle crop with its plate boxed, the plate enlarged underneath, and the fused read."""
    _, vehicle, (x1, y1, x2, y2), plate = best
    vehicle = vehicle.copy()
    cv2.rectangle(vehicle, (x1, y1), (x2, y2), PLATE_COLOR, 2)
    width = max(vehicle.shape[1], 480)
    if vehicle.shape[1] != width:
        vehicle = cv2.resize(vehicle, (width, round(vehicle.shape[0] * width / vehicle.shape[1])),
                             interpolation=cv2.INTER_CUBIC)
    plate = cv2.resize(plate, (width, max(1, round(plate.shape[0] * width / plate.shape[1]))),
                       interpolation=cv2.INTER_CUBIC)
    bar = np.zeros((48, width, 3), dtype=np.uint8)
    cv2.putText(bar, text or "(not read)", (10, 34), FONT, 0.9, PLATE_COLOR, 2, cv2.LINE_AA)
    return np.vstack([vehicle, plate, bar])


def flush_evidence(tracks, cutoff_frame, plates_dir, min_agree, on_done=None):
    """Write the evidence image of tracks last seen before ``cutoff_frame`` and free their crops.

    `on_done(tid, track)` [web] is called first, while ``track.best`` still holds the crops."""
    for tid, t in tracks.items():
        if t.best is None or t.last >= cutoff_frame:
            continue
        if on_done is not None:
            on_done(tid, t)
        if plates_dir:
            path = Path(plates_dir) / f"{tid:06d}.jpg"
            ok, buf = cv2.imencode(".jpg", evidence_image(t.best, t.plate.result(min_agree)["registration"]),
                                   [cv2.IMWRITE_JPEG_QUALITY, 92])
            if ok:  # imencode + write_bytes: cv2.imwrite fails on non-ASCII Windows paths
                path.write_bytes(buf.tobytes())
                t.evidence_path = str(path)
        t.best = None


def main(args=None, hooks=None):
    """`args`: argument list or parsed Namespace (default: the command line). `hooks` [web]: receives each vehicle
    whose plate was found (`plate`, when the vehicle has left) and progress (`progress`)."""
    args = args if isinstance(args, argparse.Namespace) else parse_args(args)
    for flag, path in (("--plate-model", args.plate_model), ("--ocr-model", args.ocr_model)):
        if not Path(path).exists():
            raise SystemExit(f"{flag}: '{path}' not found. The defaults are LPD_Model.pt and LPNR_Model.pt from "
                             f"https://github.com/prosensarker4/BLPD (put them in plate_models/), or pass your own.")
    device = args.device or ("0" if torch.cuda.is_available() else "cpu")
    precision = {}
    if device == "cpu":
        print("WARNING: running on CPU - expect low FPS. Check your PyTorch CUDA install.")
    else:
        print(f"Using GPU: {torch.cuda.get_device_name(0)}")
        # Newer Ultralytics (8.4.x) renamed `half` to `quantize`; support both.
        precision = {"quantize": 16} if "quantize" in DEFAULT_CFG_DICT else {"half": True}

    model = YOLO(args.model)
    names = model.names
    class_ids = select_classes(names, args.classes, args.exclude)
    tracked = {names[i].lower() for i in class_ids}
    plate_classes = {c.lower() for c in args.plate_classes} if args.plate_classes else tracked - NO_PLATE_CLASSES
    if plate_classes - tracked:
        print(f"WARNING: --plate-classes not tracked by the model: {sorted(plate_classes - tracked)}")
    print(f"Model: {args.model} | tracking classes: {[names[i] for i in class_ids]}")
    print(f"Plates searched on: {sorted(plate_classes & tracked)}")

    plate_model = YOLO(args.plate_model)
    ocr_model = YOLO(args.ocr_model)
    ocr_names = ocr_model.names
    if not any(is_digit_name(n) for n in ocr_names.values()):
        raise SystemExit(f"--ocr-model {args.ocr_model} has no digit classes (0-9); it must be a plate character "
                         f"detector. Its classes: {list(ocr_names.values())[:20]} ...")
    print(f"Plate model: {args.plate_model} | character model: {args.ocr_model} ({len(ocr_names)} classes)")

    live = is_live(args.source)  # [web] network camera: newest frame, no seeking
    cap = open_capture(args.source)
    if not cap.isOpened():
        raise SystemExit(f"Could not open source: {args.source}")
    fps = cap.get(cv2.CAP_PROP_FPS) or 30
    total_frames = 0 if live else int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
    w, h = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH)), int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    start_frame = 0 if live else max(0, int(round(args.start * fps)))
    end_frame = int(round(args.end * fps)) if args.end else total_frames
    if total_frames:
        end_frame = min(end_frame, total_frames)
    if start_frame:
        cap.set(cv2.CAP_PROP_POS_FRAMES, start_frame)
    clock0 = datetime.now() if live and not args.start_time else video_start_time(args.source, args.start_time)
    print(f"Video start clock time: {clock0}" if clock0 else
          "Video start clock time unknown (use --start-time): first/last seen are video times")

    if args.roi:
        x1r, y1r, x2r, y2r = args.roi
        x1r, y1r, x2r, y2r = max(0, x1r), max(0, y1r), min(w, x2r), min(h, y2r)
        if x2r - x1r < 32 or y2r - y1r < 32:
            raise SystemExit(f"ROI {args.roi} is invalid for a {w}x{h} video")
    else:
        x1r, y1r, x2r, y2r = 0, 0, w, h
    ignore = args.ignore or [[round(f * s) for f, s in zip(CLOCK_OVERLAY, (w, h, w, h))]]
    print(f"Plates ignored inside: {ignore}")

    tracker_cfg = build_tracker_cfg(args.tracker, args.conf, fps, args.track_buffer_sec, args.reid)
    print(f"Tracker: {args.tracker}{' + ReID' if args.reid else ''}")
    reads_file = open(args.reads_csv, "w", newline="", encoding="utf-8-sig") if args.reads_csv else None
    reads_writer = csv.writer(reads_file) if reads_file else None
    if reads_writer:
        reads_writer.writerow(["frame", "time_s", "track_id", "class", "plate_x1", "plate_y1", "plate_x2", "plate_y2",
                               "plate_w", "plate_conf", "area", "metro", "letter", "digits", "char_conf", "weight"])
    if args.plates_dir:
        Path(args.plates_dir).mkdir(parents=True, exist_ok=True)
    if not args.no_show:
        cv2.namedWindow("Plate Reading", cv2.WINDOW_NORMAL)

    common = {"device": device, **precision}
    ui = h / 1080  # scale text and lines with the video resolution
    tracks = {}    # track_id -> Track
    hud = []       # latest plates for the on-screen list
    stale = int(fps * (args.track_buffer_sec + 2))  # a track unseen this long is finished
    frame_idx, n_done, t_start = start_frame - 1, 0, time.time()
    recent = deque(maxlen=30)  # timestamps for a rolling FPS
    WARMUP = 10
    prof = Counter()
    # short queue: this pipeline runs at a few FPS, and on an 8 GB laptop every 11 MB frame counts
    reader = LiveFrameReader(cap) if live else FrameReader(cap, maxsize=4)
    reader.start()

    def plate_done(tid, t):  # [web] vehicle finished: fused read + evidence crops
        r = t.plate.result(args.min_agree)
        hooks.plate({
            "track_id": tid, "class": t.classes.most_common(1)[0][0], "registration": r["registration"],
            "number": r["number"], "area": r["area"], "metro": r["metro"], "letter": r["letter"],
            "status": r["status"], "conf": round(r["conf"], 3), "agree": r["agree"],
            "plate_px": t.best[2][2] - t.best[2][0],
            "complete_reads": t.plate.complete, "plate_frames": t.plate.seen,
            "first_seen": fmt_time(t.first, fps, clock0), "last_seen": fmt_time(t.last, fps, clock0),
            "first_seen_s": round(t.first / fps, 2), "last_seen_s": round(t.last / fps, 2),
        }, evidence_image(t.best, r["registration"]), t.best[3])
    on_done = plate_done if hooks is not None else None

    last_print = time.time()
    try:
        while True:
            frame = reader.read()
            if frame is None:
                break
            # [web] live: frame number from the capture time, because frames are dropped to stay real time
            frame_idx = max(frame_idx + 1, round(reader.elapsed * fps)) if live else frame_idx + 1
            if end_frame and frame_idx >= end_frame:
                break
            n_done += 1
            t0 = time.perf_counter()

            result = model.track(
                frame[y1r:y2r, x1r:x2r], persist=True, tracker=tracker_cfg, classes=class_ids, conf=0.1,
                imgsz=args.imgsz, agnostic_nms=not args.class_nms, verbose=False, **common,
            )[0]
            vehicles = []  # (track_id, majority class, box in frame pixels)
            boxes = result.boxes
            if boxes.id is not None:
                for (bx1, by1, bx2, by2), tid, cls in zip(
                    boxes.xyxy.int().tolist(), boxes.id.int().tolist(), boxes.cls.int().tolist()
                ):
                    t = tracks.get(tid)
                    if t is None:
                        t = tracks[tid] = Track(frame_idx)
                    t.last = frame_idx
                    t.classes[names[cls]] += 1
                    vehicles.append((tid, t.classes.most_common(1)[0][0], (bx1 + x1r, by1 + y1r, bx2 + x1r, by2 + y1r)))
            t1 = time.perf_counter()

            # 1. Plate search on the crops of vehicles that can show a readable plate.
            look = [i for i, (tid, cname, box) in enumerate(vehicles)
                    if cname.lower() in plate_classes and box[2] - box[0] >= args.min_vehicle_px
                    and tracks[tid].plate.complete < args.max_reads and frame_idx % args.plate_every == 0]
            crops, offsets = [], []
            for i in look:
                cx1, cy1, cx2, cy2 = pad_box(vehicles[i][2], VEHICLE_PAD, VEHICLE_PAD, w, h)
                crops.append(frame[cy1:cy2, cx1:cx2])
                offsets.append((cx1, cy1, cx2, cy2))
                tracks[vehicles[i][0]].checked = True
            found = {}  # vehicle index -> (plate box in frame pixels, confidence)
            for i, (cx1, cy1, _, _), res in zip(look, offsets, predict_batches(
                    plate_model, crops, args.batch, imgsz=args.plate_imgsz, conf=args.plate_conf, **common)):
                vx1, vy1, vx2, vy2 = vehicles[i][2]
                for (px1, py1, px2, py2), pc in zip(res.boxes.xyxy.tolist(), res.boxes.conf.tolist()):
                    pbox = (px1 + cx1, py1 + cy1, px2 + cx1, py2 + cy1)
                    mx, my = (pbox[0] + pbox[2]) / 2, (pbox[1] + pbox[3]) / 2
                    # the crop has a margin and may include a neighbour: the plate centre must be on this vehicle
                    if not (vx1 <= mx <= vx2 and vy1 <= my <= vy2) or pc <= found.get(i, (None, -1.0))[1]:
                        continue
                    if pbox[2] - pbox[0] > MAX_PLATE_W * (vx2 - vx1) or pbox[3] - pbox[1] > MAX_PLATE_H * (vy2 - vy1):
                        continue  # far too big for a plate: a false detection
                    if any(ix1 <= mx <= ix2 and iy1 <= my <= iy2 for ix1, iy1, ix2, iy2 in ignore):
                        continue
                    found[i] = (pbox, pc)

            def bumper_gap(i):  # plates sit on the bumper, i.e. near the bottom edge of the box in this view
                vx1, vy1, vx2, vy2 = vehicles[i][2]
                pb = found[i][0]
                return abs(vy2 - (pb[1] + pb[3]) / 2) / max(1, vy2 - vy1)

            for a, b in combinations(sorted(found), 2):  # one plate belongs to one vehicle
                if a in found and b in found and iou(found[a][0], found[b][0]) > 0.5:
                    del found[max(a, b, key=bumper_gap)]
            t2 = time.perf_counter()

            # 2. Read the characters of plates big enough to read.
            to_read, plate_crops = [], []
            for i, (pbox, pc) in found.items():
                tracks[vehicles[i][0]].plate.seen += 1
                if pbox[2] - pbox[0] >= max(1, args.min_plate_px) and pbox[3] - pbox[1] >= 2:
                    qx1, qy1, qx2, qy2 = pad_box(pbox, PLATE_PAD, PLATE_PAD, w, h)
                    to_read.append(i)
                    plate_crops.append(frame[qy1:qy2, qx1:qx2])
            reads = dict(zip(to_read, predict_batches(ocr_model, plate_crops, args.batch, imgsz=args.ocr_imgsz,
                                                      conf=args.ocr_conf, iou=0.5, agnostic_nms=True, **common)))
            for i, (pbox, pc) in found.items():
                tid, cname, vbox = vehicles[i]
                t = tracks[tid]
                size = min(1.0, (pbox[2] - pbox[0]) / max(1, args.full_weight_px))
                read = read_characters(ocr_names, reads[i]) if i in reads else None
                score = pc * size * (read["conf"] if read else 0.01)
                if read:
                    t.plate.add(read, score)
                    if reads_writer:
                        reads_writer.writerow([
                            frame_idx, f"{frame_idx / fps:.2f}", tid, cname, *(round(v) for v in pbox),
                            round(pbox[2] - pbox[0]), f"{pc:.3f}", read["area"], int(read["metro"]), read["letter"],
                            read["digits"], f"{read['conf']:.3f}", f"{score:.3f}",
                        ])
                if t.best is None or score > t.best[0]:  # keep the clearest plate as evidence
                    cx1, cy1, cx2, cy2 = pad_box(vbox, VEHICLE_PAD, VEHICLE_PAD, w, h)
                    qx1, qy1, qx2, qy2 = pad_box(pbox, PLATE_PAD, PLATE_PAD, w, h)
                    rel = (int(pbox[0]) - cx1, int(pbox[1]) - cy1, int(pbox[2]) - cx1, int(pbox[3]) - cy1)
                    t.best = (score, frame[cy1:cy2, cx1:cx2].copy(), rel, frame[qy1:qy2, qx1:qx2].copy())
                if read:
                    r = t.plate.result(args.min_agree)
                    text = r["registration"] if r["status"] in ("confirmed", "uncertain") else ""
                    if text and text != t.text:
                        note_hud(hud, tid, text, t.best[3])
                    t.text = text
            t3 = time.perf_counter()

            # 3. Draw.
            for tid, cname, (bx1, by1, bx2, by2) in vehicles:
                col = color_for(tid)
                cv2.rectangle(frame, (bx1, by1), (bx2, by2), col, max(1, round(2 * ui)))
                text = tracks[tid].text
                draw_label(frame, f"{cname} #{tid}" + (f" | {text}" if text else ""), (bx1, by1 - 6), col, 0.55 * ui)
            for pbox, _ in found.values():
                draw_corners(frame, pbox, PLATE_COLOR, ui)
            draw_hud(frame, hud, ui)
            recent.append(time.time())
            fps_live = (len(recent) - 1) / (recent[-1] - recent[0]) if len(recent) > 1 else 0.0
            if args.roi:
                cv2.rectangle(frame, (x1r, y1r), (x2r, y2r), (0, 200, 255), 2)
            n_read = sum(1 for t in tracks.values() if t.text)
            draw_label(frame, f"FPS: {fps_live:.1f}", (15, int(35 * ui)), (0, 255, 0), 0.7 * ui)
            draw_label(frame, f"Plates read: {n_read}", (15, int(65 * ui)), PLATE_COLOR, 0.7 * ui)

            quit_key = False
            if not args.no_show:
                cv2.imshow("Plate Reading", frame)
                quit_key = cv2.waitKey(1) & 0xFF == ord("q")
            t4 = time.perf_counter()
            if n_done > WARMUP:
                prof["frames"] += 1
                prof["vehicles (detect + track)"] += (t1 - t0) * 1e3
                prof["plate detection"] += (t2 - t1) * 1e3
                prof["plate reading"] += (t3 - t2) * 1e3
                prof["drawing + saving"] += (t4 - t3) * 1e3

            if n_done % max(1, int(fps)) == 0:
                flush_evidence(tracks, frame_idx - stale, args.plates_dir, args.min_agree, on_done)
            if time.time() - last_print > 2:
                last_print = time.time()
                todo = end_frame - frame_idx if end_frame else 0
                eta = todo / fps_live if todo and fps_live > 0 else 0
                pct = f"{100 * (frame_idx - start_frame) / (end_frame - start_frame):5.1f}%" if end_frame else ""
                print(f"\rframe {frame_idx}/{end_frame or '?'} {pct} | {fps_live:5.1f} FPS | plates read {n_read} | "
                      f"ETA {int(eta // 60)}m{int(eta % 60):02d}s | Ctrl+C to stop early   ", end="", flush=True)
                if hooks is not None:  # [web]
                    hooks.progress(frames=frame_idx - start_frame, total=(end_frame - start_frame) if end_frame else 0,
                                   fps=fps_live, vehicles=len(tracks), plates=n_read)
            if quit_key:
                break
    except KeyboardInterrupt:
        print("\nStopped with Ctrl+C - finishing the output files...")
    print()
    reader.stop()
    cap.release()
    if reads_file:
        reads_file.close()
    cv2.destroyAllWindows()
    Path(tracker_cfg).unlink(missing_ok=True)
    flush_evidence(tracks, frame_idx + 1, args.plates_dir, args.min_agree, on_done)

    rows = []
    for tid, t in sorted(tracks.items(), key=lambda kv: kv[1].first):
        n = sum(t.classes.values())
        if n < args.min_frames:
            continue
        r = t.plate.result(args.min_agree)
        rows.append({
            "track_id": tid,
            "class": t.classes.most_common(1)[0][0],
            "registration": r["registration"],
            "plate_number": r["number"],
            "plate_area": r["area"] + (" Metro" if r["metro"] else ""),
            "plate_letter": r["letter"],
            "status": r["status"] if t.checked else "not checked",
            "plate_conf": f"{r['conf']:.2f}" if r["number"] and r["status"] != "partial" else "",
            "agreeing_reads": r["agree"],
            "complete_reads": t.plate.complete,
            "plate_reads": t.plate.reads,
            "plate_frames": t.plate.seen,
            "first_seen": fmt_time(t.first, fps, clock0),
            "last_seen": fmt_time(t.last, fps, clock0),
            "first_seen_s": f"{t.first / fps:.2f}",
            "last_seen_s": f"{t.last / fps:.2f}",
            "frames": n,
            "evidence_image": t.evidence_path,
        })
    with open(args.csv, "w", newline="", encoding="utf-8-sig") as f:
        wr = csv.DictWriter(f, fieldnames=list(rows[0]) if rows else ["track_id"])
        wr.writeheader()
        wr.writerows(rows)

    status = Counter(r["status"] for r in rows)
    print("\n===== PLATES =====")
    print(f"Vehicles (tracks seen >= {args.min_frames} frames): {len(rows)}")
    for s in ("confirmed", "uncertain", "partial", "unreadable", "no plate found", "not checked"):
        if status[s]:
            print(f"  {s:<15}{status[s]:>6}")
    confirmed = [r for r in rows if r["status"] == "confirmed"]
    for r in confirmed[:50]:
        print(f"  #{r['track_id']:<6} {r['class']:<10} {r['registration']:<28} {r['first_seen']} -> {r['last_seen']}")
    if len(confirmed) > 50:
        print(f"  ... {len(confirmed) - 50} more in the CSV")
    print(f"Per-vehicle results written to {args.csv}")
    print(f"Frames processed: {n_done} | avg FPS: {n_done / max(1e-6, time.time() - t_start):.1f}")

    if prof["frames"]:
        n = prof.pop("frames")
        total = sum(prof.values()) / n
        print(f"\n===== TIME PER FRAME (ms, excluding first {WARMUP} frames) =====")
        for k, v in prof.items():
            print(f"{k:<28}{v / n:8.1f}  {100 * v / n / total:5.1f}%")
        print(f"{'total':<28}{total:8.1f}  -> {1000 / total:.1f} FPS")


if __name__ == "__main__":
    main()
