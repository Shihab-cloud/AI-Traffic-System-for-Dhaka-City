"""
Vehicle Detection, Tracking & Speed Estimation

Same detector/tracker setup as vehicle_tracker.py (per-track majority-vote class, ROI, tracker choice),
plus a speed for every vehicle.

How speed is measured
    You mark one or more "speed zones" on the road. A zone is 4 image points that are the corners of a
    real rectangle on the road surface (e.g. the ends of lane-marking dashes on two lane lines), plus that
    rectangle's real width and length in metres. From these, a perspective transform (homography) maps
    image pixels to metres on a top-down view of the road. A vehicle's position is the bottom-centre of
    its box (where it touches the road); its speed is how far that point moves, in metres, over the last
    --window seconds, median-smoothed. Speed is only measured inside a zone.

Usage
    1. Calibrate once per camera position: click 4 corners per zone, then type its size in the terminal.
        python speed_tracker.py --source video.mp4 --calibrate speed_zones.json --at 60
    2. Run:
        python speed_tracker.py --source video.mp4 --zones speed_zones.json --no-show --csv speeds.csv
"""

import argparse
import csv
import json
import math
import time
from collections import Counter, defaultdict, deque
from pathlib import Path

import cv2
import numpy as np
import torch
from ultralytics import YOLO
from ultralytics.cfg import DEFAULT_CFG_DICT

from vehicle_tracker import (FrameReader, LiveFrameReader, build_tracker_cfg, is_live, open_capture,
                             select_classes)

CORNERS = ["far-left", "far-right", "near-right", "near-left"]  # click order; "far" = top of the image
SLOW_KPH, FAST_KPH = 30, 60  # box colour: green below SLOW, orange up to FAST, red above
NO_SPEED_COLOR = (180, 180, 180)
ZONE_COLOR = (255, 200, 0)
MIN_ZONE_LENGTH_M = 20  # shorter zones are crossed too quickly to measure a speed
FONT = cv2.FONT_HERSHEY_SIMPLEX


def parse_args(argv=None):
    p = argparse.ArgumentParser(description="YOLO vehicle tracking with speed estimation")
    p.add_argument("--source", required=True, help="Video path")
    p.add_argument("--model", default="bd_vehicles_best.pt", help="Ultralytics detection checkpoint")
    p.add_argument("--zones", default="speed_zones.json", help="Speed-zone file made with --calibrate")
    p.add_argument("--calibrate", metavar="JSON", default=None,
                   help="Click speed zones on a frame of --source, save them to this file, then exit")
    p.add_argument("--at", type=float, default=0.0, help="With --calibrate: video time (s) of the frame to click on")
    p.add_argument("--window", type=float, default=1.0,
                   help="Seconds of movement per speed measurement (longer = smoother but slower to react)")
    p.add_argument("--smooth", type=int, default=15, help="Show the median of this many recent measurements")
    p.add_argument("--max-kph", type=float, default=120,
                   help="Discard measurements above this (caused by ID switches or jumping boxes)")
    p.add_argument("--classes", nargs="+", default=None, help='Class names to keep, or "all"')
    p.add_argument("--exclude", nargs="*", default=None, help="Class names to drop (default: person/pedestrian)")
    p.add_argument("--conf", type=float, default=None,
                   help="Min confidence to start/confirm a track (default: the tracker's own tuned value)")
    p.add_argument("--imgsz", type=int, default=640, help="Inference size (multiple of 32)")
    p.add_argument("--roi", type=int, nargs=4, metavar=("X1", "Y1", "X2", "Y2"), default=None,
                   help="Only detect inside this pixel rectangle")
    p.add_argument("--class-nms", action="store_true", help="Per-class NMS (default is class-agnostic)")
    p.add_argument("--device", default=None, help='"0" for GPU, "cpu" for CPU (default: auto)')
    p.add_argument("--tracker", default="bytetrack",
                   choices=["bytetrack", "botsort", "ocsort", "deepocsort", "tracktrack", "fasttrack"])
    p.add_argument("--reid", action="store_true", help="Use appearance (ReID) features: botsort/deepocsort/tracktrack")
    p.add_argument("--track-buffer-sec", type=float, default=1.0, help="Seconds a lost track is kept alive")
    p.add_argument("--min-frames", type=int, default=5, help="Frames a track must exist before it is shown/counted")
    p.add_argument("--csv", default=None, help="Path to save one row per vehicle with its speeds (.csv)")
    p.add_argument("--frames-csv", default=None, help="Path to save one row per box per frame (large file)")
    p.add_argument("--no-show", action="store_true", help="Don't open a preview window")
    # [web] speed-limit violations (reported to the web system through `hooks`)
    p.add_argument("--speed-limit", type=float, default=60,
                   help="Speed limit in km/h where a zone has no 'speed_limit_kph' (Dhaka city roads: 60)")
    p.add_argument("--limit-margin", type=float, default=None,
                   help="Measurement margin over the limit (default: max(3 km/h, 5%% of the limit))")
    p.add_argument("--sustain-sec", type=float, default=1.0,
                   help="Seconds the speed must stay over limit + margin before it counts")
    return p.parse_args(argv)


class SpeedZone:
    """A real rectangle on the road with known size; maps image pixels to metres on the road plane.

    Road coordinates: x across the zone (0 = left edge), y along it (0 = far edge, length_m = near edge).
    """

    def __init__(self, name, points, width_m, length_m, scale=(1.0, 1.0)):
        self.name, self.width_m, self.length_m = name, float(width_m), float(length_m)
        self.poly = np.float32(points) * np.float32(scale)
        dst = np.float32([[0, 0], [width_m, 0], [width_m, length_m], [0, length_m]])
        self.H = cv2.getPerspectiveTransform(self.poly, dst)
        self.H_inv = np.linalg.inv(self.H)

    def contains(self, pt):
        return cv2.pointPolygonTest(self.poly, (float(pt[0]), float(pt[1])), False) >= 0

    def to_metres(self, pt):
        return cv2.perspectiveTransform(np.float32([[pt]]), self.H)[0, 0]

    def to_pixels(self, pts_m):
        return cv2.perspectiveTransform(np.float32([pts_m]), self.H_inv)[0]

    def to_dict(self):
        return {"name": self.name, "points": [[round(float(x), 1), round(float(y), 1)] for x, y in self.poly],
                "width_m": self.width_m, "length_m": self.length_m}

    def draw(self, img, ui=1.0, step_m=10):
        """Zone outline, plus a cross line every `step_m` metres so distances can be checked by eye."""
        thick = max(1, round(2 * ui))
        cv2.polylines(img, [self.poly.astype(np.int32)], True, ZONE_COLOR, thick, cv2.LINE_AA)
        for d in np.arange(step_m, self.length_m, step_m):
            a, b = self.to_pixels([[0, d], [self.width_m, d]])
            cv2.line(img, tuple(map(int, a)), tuple(map(int, b)), ZONE_COLOR, 1, cv2.LINE_AA)
        x, y = map(int, self.poly[0])
        draw_label(img, f"{self.name}: {self.width_m:g} x {self.length_m:g} m", (x, y - 8), ZONE_COLOR, 0.6 * ui)


def warn_if_short(zone):
    if zone.length_m < MIN_ZONE_LENGTH_M:
        print(f"WARNING: zone '{zone.name}' is only {zone.length_m:g} m long. A vehicle at 50 km/h crosses it in "
              f"{zone.length_m / 13.9:.1f} s, but a speed needs about 0.5-1 s of movement inside the zone. "
              f"Make zones at least {MIN_ZONE_LENGTH_M} m long (e.g. several lane-marking dashes).")


def load_zones(path, frame_w, frame_h):
    cfg = json.loads(Path(path).read_text())
    cw, ch = cfg.get("frame_size", [frame_w, frame_h])
    scale = (frame_w / cw, frame_h / ch)
    if scale != (1.0, 1.0):
        print(f"Zones were clicked on a {cw}x{ch} frame; scaling them to {frame_w}x{frame_h}.")
    zones = [SpeedZone(z["name"], z["points"], z["width_m"], z["length_m"], scale) for z in cfg["zones"]]
    if not zones:
        raise SystemExit(f"No zones in {path}")
    for z in zones:
        warn_if_short(z)
    return zones


class SpeedEstimator:
    """Per-track speed on the road plane: distance moved over the last `window_sec`, median-smoothed."""

    def __init__(self, fps, window_sec, smooth, max_kph):
        self.fps, self.max_kph, self.smooth = fps, max_kph, smooth
        self.window = max(2, round(window_sec * fps))  # frames
        self.min_span = max(1, self.window // 2)       # frames of history needed for the first measurement
        self.zone = {}                                 # tid -> zone the track is measured in
        self.path = {}                                 # tid -> deque[(frame, x_m, y_m)] within the window
        self.recent = {}                               # tid -> recent measurements (km/h)
        self.first, self.last = {}, {}                 # tid -> (frame, x_m, y_m) first/last position in the zone
        self.stats = defaultdict(lambda: [0.0, 0, 0.0])  # tid -> [sum, count, max] of the shown speed

    def current(self, tid):
        recent = self.recent.get(tid)
        return float(np.median(recent)) if recent else None

    def update(self, tid, frame_idx, zone, xy):
        """Add a road-plane position (metres); return the smoothed speed in km/h, or None if not known yet."""
        pos = (frame_idx, float(xy[0]), float(xy[1]))
        if self.zone.get(tid) is not zone:  # new track, or it moved into another zone: start over
            self.zone[tid] = zone
            self.path[tid] = deque()
            self.recent[tid] = deque(maxlen=self.smooth)
            self.first[tid] = pos
        self.last[tid] = pos
        path = self.path[tid]
        path.append(pos)
        while frame_idx - path[0][0] > self.window:
            path.popleft()
        f0, x0, y0 = path[0]
        if frame_idx - f0 >= self.min_span:
            kph = math.hypot(pos[1] - x0, pos[2] - y0) / ((frame_idx - f0) / self.fps) * 3.6
            if kph <= self.max_kph:
                self.recent[tid].append(kph)
        kph = self.current(tid)
        if kph is not None:
            s = self.stats[tid]
            s[0], s[1], s[2] = s[0] + kph, s[1] + 1, max(s[2], kph)
        return kph

    def summary(self, tid):
        """Per-track results. Section speed = straight-line distance from zone entry to exit / time taken."""
        (f0, x0, y0), (f1, x1, y1) = self.first[tid], self.last[tid]
        dist, secs = math.hypot(x1 - x0, y1 - y0), (f1 - f0) / self.fps
        total, n, peak = self.stats[tid]
        if dist < 3:
            direction = "stationary"
        else:
            direction = "toward camera" if y1 > y0 else "away from camera"
        return {
            "zone": self.zone[tid].name,
            "first_s": round(f0 / self.fps, 2),
            "last_s": round(f1 / self.fps, 2),
            "direction": direction,
            "avg_kph": round(total / n, 1) if n else None,
            "max_kph": round(peak, 1) if n else None,
            "section_m": round(dist, 1),
            "section_s": round(secs, 2),
            "section_kph": round(dist / secs * 3.6, 1) if secs >= 1 else None,
        }


def speed_color(kph):
    if kph < SLOW_KPH:
        return 0, 220, 0
    if kph < FAST_KPH:
        return 0, 165, 255
    return 0, 0, 255


def draw_label(img, text, org, color, scale=0.6, thickness=None):
    """Text on a dark filled box so it stays readable on any background."""
    thickness = thickness or max(1, round(scale * 3))
    (tw, th), base = cv2.getTextSize(text, FONT, scale, thickness)
    x, y = int(org[0]), max(th + 4, int(org[1]))
    cv2.rectangle(img, (x - 3, y - th - 4), (x + tw + 3, y + base), (20, 20, 20), -1)
    cv2.putText(img, text, (x, y), FONT, scale, color, thickness, cv2.LINE_AA)


def ask_float(prompt):
    while True:
        try:
            value = float(input(prompt).strip())
            if value > 0:
                return value
        except ValueError:
            pass
        print("Please type a positive number, e.g. 7.5")


def show_top_down(frame, zone, height_px=800):
    """Warp the zone to a top-down view: if the calibration is right, lane lines come out straight and parallel."""
    ppm = height_px / zone.length_m
    top = cv2.warpPerspective(frame, np.diag([ppm, ppm, 1.0]) @ zone.H, (max(1, int(zone.width_m * ppm)), height_px))
    for d in np.arange(10, zone.length_m, 10):
        cv2.line(top, (0, int(d * ppm)), (top.shape[1], int(d * ppm)), ZONE_COLOR, 1)
    cv2.imshow(f"Top-down check: {zone.name} (lines every 10 m)", top)


def calibrate(source, out_path, at_sec):
    cap = cv2.VideoCapture(source)
    cap.set(cv2.CAP_PROP_POS_MSEC, at_sec * 1000)
    ok, frame = cap.read()
    cap.release()
    if not ok:
        raise SystemExit(f"Could not read a frame at {at_sec}s from {source}")
    h, w = frame.shape[:2]
    ui = h / 1080
    zones, clicks = [], []

    def on_mouse(event, x, y, *_):
        if event == cv2.EVENT_LBUTTONDOWN and len(clicks) < 4:
            clicks.append((x, y))

    win = "Speed zones  |  click 4 corners  |  u = undo  s = save  q = quit"
    cv2.namedWindow(win, cv2.WINDOW_NORMAL)
    cv2.setMouseCallback(win, on_mouse)
    print("Click the 4 corners of a real rectangle on the road, in this order: " + ", ".join(CORNERS) + ".")
    print("Good corners: ends of lane-marking dashes on two lane lines, or kerb/median edges you can measure.")
    print("Then type the rectangle's real width and length (metres) here in the terminal.\n")

    while True:
        img = frame.copy()
        for z in zones:
            z.draw(img, ui)
        n = len(clicks)  # taken before waitKey so a click is drawn before we act on it
        for i, pt in enumerate(clicks):
            cv2.circle(img, pt, max(3, int(6 * ui)), (0, 0, 255), -1)
            draw_label(img, f"{i + 1} {CORNERS[i]}", (pt[0] + 10, pt[1] - 10), (0, 0, 255), 0.6 * ui)
        if n > 1:
            cv2.polylines(img, [np.int32(clicks)], n == 4, (0, 0, 255), max(1, round(2 * ui)), cv2.LINE_AA)
        if n < 4:
            draw_label(img, f"Click point {n + 1}: {CORNERS[n]}", (20, int(50 * ui)), (255, 255, 255), 0.9 * ui)
        cv2.imshow(win, img)
        key = cv2.waitKey(30) & 0xFF
        if cv2.getWindowProperty(win, cv2.WND_PROP_VISIBLE) < 1:
            break

        if n == 4:
            if not cv2.isContourConvex(np.int32(clicks)):
                print("Those points cross over each other. Click them in order: " + ", ".join(CORNERS))
                clicks.clear()
                continue
            name = input(f"Zone name [zone{len(zones) + 1}]: ").strip() or f"zone{len(zones) + 1}"
            width = ask_float("Real width in metres (left edge to right edge): ")
            length = ask_float("Real length in metres (far edge to near edge): ")
            zones.append(SpeedZone(name, clicks, width, length))
            warn_if_short(zones[-1])
            clicks.clear()
            show_top_down(frame, zones[-1])
            print("Check the top-down window: lane lines should be straight and parallel.\n"
                  "Click 4 more corners for another zone, u = undo, s = save.\n")
        elif key == ord("u"):
            if clicks:
                clicks.pop()
            elif zones:
                print(f"Removed zone {zones.pop().name}")
        elif key == ord("s"):
            if not zones:
                print("No zone to save yet.")
                continue
            Path(out_path).write_text(json.dumps({"frame_size": [w, h], "zones": [z.to_dict() for z in zones]}, indent=2))
            print(f"Saved {len(zones)} zone(s) to {out_path}")
            break
        elif key in (ord("q"), 27):
            print("Quit without saving.")
            break
    cv2.destroyAllWindows()


def main(args=None, hooks=None):
    """`args`: argument list or parsed Namespace (default: the command line). `hooks` [web]: object that receives
    speed violations (`violation`), collects plate crops (`plate_collector`) and progress (`progress`)."""
    args = args if isinstance(args, argparse.Namespace) else parse_args(args)
    if args.calibrate:
        calibrate(args.source, args.calibrate, args.at)
        return
    if not Path(args.zones).exists():
        raise SystemExit(f"Zone file '{args.zones}' not found. Create it first:\n"
                         f'  python speed_tracker.py --source "{args.source}" --calibrate {args.zones} --at 60')

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
    print(f"Model: {args.model} | tracking classes: {[names[i] for i in class_ids]}")

    live = is_live(args.source)  # [web] network camera: newest frame, time measured on the clock
    cap = open_capture(args.source)
    if not cap.isOpened():
        raise SystemExit(f"Could not open source: {args.source}")
    fps = cap.get(cv2.CAP_PROP_FPS) or 30
    total_frames = 0 if live else int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
    w, h = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH)), int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    zones = load_zones(args.zones, w, h)
    print(f"Speed zones: {', '.join(f'{z.name} ({z.width_m:g} x {z.length_m:g} m)' for z in zones)}")
    # [web] per-zone speed limit ("speed_limit_kph" in the zone file), else --speed-limit
    zone_cfg = {z.get("name"): z for z in json.loads(Path(args.zones).read_text())["zones"]}
    zone_limits = {name: z.get("speed_limit_kph") for name, z in zone_cfg.items()}
    over_since, speeding = {}, set()   # tid -> frame its speed went over limit + margin; reported tids
    # [web] reads the speeders' plates; lists every vehicle (Vehicle IDs across cameras) without reading its plate
    plates = hooks.plate_collector(read_listed=False) if hooks is not None else None

    if args.roi:
        x1r, y1r, x2r, y2r = args.roi
        x1r, y1r, x2r, y2r = max(0, x1r), max(0, y1r), min(w, x2r), min(h, y2r)
        if x2r - x1r < 32 or y2r - y1r < 32:
            raise SystemExit(f"ROI {args.roi} is invalid for a {w}x{h} video")
    else:
        x1r, y1r, x2r, y2r = 0, 0, w, h

    tracker_cfg = build_tracker_cfg(args.tracker, args.conf, fps, args.track_buffer_sec, args.reid)
    print(f"Tracker: {args.tracker}{' + ReID' if args.reid else ''}")
    speeds = SpeedEstimator(fps, args.window, args.smooth, args.max_kph)
    frames_file = open(args.frames_csv, "w", newline="") if args.frames_csv else None
    frames_writer = csv.writer(frames_file) if frames_file else None
    if frames_writer:
        frames_writer.writerow(["frame", "time_s", "track_id", "class", "track_class", "conf",
                                "x1", "y1", "x2", "y2", "zone", "x_m", "y_m", "kph"])
    if not args.no_show:
        cv2.namedWindow("Speed Tracking", cv2.WINDOW_NORMAL)

    ui = h / 1080  # scale text and lines with the video resolution
    class_votes = defaultdict(Counter)  # track_id -> Counter(class_name)
    track_major = {}                    # counted track_id -> its current majority class
    counts = Counter()
    frames, t_start = 0, time.time()
    recent = deque(maxlen=30)  # timestamps for a rolling FPS
    reader = LiveFrameReader(cap) if live else FrameReader(cap)
    reader.start()

    last_print = time.time()
    try:
        while True:
            frame = reader.read()
            if frame is None:
                break
            # [web] live: frame number from the capture time, because frames are dropped to stay real time
            frames = max(frames + 1, round(reader.elapsed * fps)) if live else frames + 1
            clean = frame.copy() if hooks is not None else None  # [web] evidence without drawings
            present = set()
            roi = frame[y1r:y2r, x1r:x2r]
            result = model.track(
                roi, persist=True, tracker=tracker_cfg, classes=class_ids, conf=0.1,
                imgsz=args.imgsz, device=device, agnostic_nms=not args.class_nms,
                verbose=False, **precision,
            )[0]

            for zone in zones:
                zone.draw(frame, ui)
            boxes = result.boxes
            if boxes.id is not None:
                for (bx1, by1, bx2, by2), tid, cls, cf in zip(
                    boxes.xyxy.int().tolist(), boxes.id.int().tolist(), boxes.cls.int().tolist(), boxes.conf.tolist()
                ):
                    bx1, bx2, by1, by2 = bx1 + x1r, bx2 + x1r, by1 + y1r, by2 + y1r
                    cname = names[cls]
                    votes = class_votes[tid]
                    votes[cname] += 1
                    major = votes.most_common(1)[0][0]
                    if tid in track_major:
                        if track_major[tid] != major:  # majority class flipped
                            counts[track_major[tid]] -= 1
                            counts[major] += 1
                            track_major[tid] = major
                    elif sum(votes.values()) >= args.min_frames:  # track just became countable
                        track_major[tid] = major
                        counts[major] += 1

                    # Speed: bottom-centre of the box = where the vehicle touches the road.
                    point = ((bx1 + bx2) / 2, by2)
                    zone = next((z for z in zones if z.contains(point)), None)
                    # A box cut off by the frame/ROI edge has a wrong bottom-centre: keep the last speed.
                    clipped = bx1 <= x1r + 1 or bx2 >= x2r - 2 or by2 >= y2r - 2
                    kph, xy = None, None
                    if zone:
                        if clipped:
                            kph = speeds.current(tid)
                        else:
                            xy = zone.to_metres(point)
                            kph = speeds.update(tid, frames, zone, xy)

                    # [web] speed-limit violation: over limit + margin for --sustain-sec AND the average speed
                    # through the zone over the limit too (one fast reading is not enough); reported once per vehicle.
                    present.add(tid)
                    # [web] plates: every vehicle's best crops are kept, anywhere in the picture (one coming toward
                    # the camera is closest after it has left the zone, one going away before it came in); only the
                    # plates of vehicles over the limit are read.
                    if plates is not None and tid in track_major and not clipped:
                        plates.observe(tid, clean, (bx1, by1, bx2, by2), frames / fps, major)
                    if zone is not None and tid in track_major:
                        limit = zone_limits.get(zone.name) or args.speed_limit
                        margin = args.limit_margin if args.limit_margin is not None else max(3.0, 0.05 * limit)
                        if xy is not None:
                            if kph is not None and kph > limit + margin:
                                over_since.setdefault(tid, frames)
                            else:
                                over_since.pop(tid, None)
                        total, n_kph, _ = speeds.stats.get(tid, (0.0, 0, 0.0))
                        avg = total / n_kph if n_kph else 0.0
                        if (tid not in speeding and tid in over_since and avg > limit
                                and (frames - over_since[tid]) / fps >= args.sustain_sec):
                            speeding.add(tid)
                            print(f"\n[speed] {major} #{tid}: {kph:.0f} km/h (average {avg:.0f}) in '{zone.name}', "
                                  f"limit {limit:g} km/h")
                            if hooks is not None:
                                key = hooks.violation(
                                    {"code": "V2", "title": "Over speed limit", "track_id": tid, "class": major,
                                     "kph": round(kph, 1), "avg_kph": round(avg, 1), "limit_kph": limit,
                                     "zone": zone.name, "video_time_s": round(frames / fps, 2),
                                     "details": {"flag_above_kph": round(limit + margin, 1)}},
                                    clean, (bx1, by1, bx2, by2))
                                if plates is not None and key:
                                    plates.request(tid, key, frames / fps)

                    show_speed = kph is not None and tid in track_major
                    col = speed_color(kph) if show_speed else NO_SPEED_COLOR
                    if tid in speeding:  # [web]
                        col = (0, 0, 255)
                    cv2.rectangle(frame, (bx1, by1), (bx2, by2), col, max(1, round(2 * ui)))
                    label = f"{major} #{tid}" + (f"  {kph:.0f} km/h" if show_speed else "")
                    if tid in speeding:  # [web]
                        label += "  OVER LIMIT"
                    draw_label(frame, label, (bx1, by1 - 6), col, 0.55 * ui)
                    if frames_writer:
                        frames_writer.writerow([
                            frames, f"{frames / fps:.2f}", tid, cname, major, f"{cf:.3f}", bx1, by1, bx2, by2,
                            zone.name if zone else "",
                            f"{xy[0]:.2f}" if xy is not None else "", f"{xy[1]:.2f}" if xy is not None else "",
                            f"{kph:.1f}" if kph is not None else "",
                        ])

            if plates is not None:  # [web] read plates of vehicles that left
                plates.tick(frames / fps, present)
            recent.append(time.time())
            fps_live = (len(recent) - 1) / (recent[-1] - recent[0]) if len(recent) > 1 else 0.0

            if args.roi:
                cv2.rectangle(frame, (x1r, y1r), (x2r, y2r), (0, 200, 255), 2)
            y = int(35 * ui)
            draw_label(frame, f"FPS: {fps_live:.1f}", (15, y), (0, 255, 0), 0.7 * ui)
            if speeding:  # [web]
                y += int(30 * ui)
                draw_label(frame, f"Over limit: {len(speeding)}", (15, y), (0, 0, 255), 0.7 * ui)
            for cname, n in sorted(counts.items()):
                if n > 0:
                    y += int(30 * ui)
                    draw_label(frame, f"{cname}: {n}", (15, y), (255, 255, 0), 0.7 * ui)
            for i, (text, kph) in enumerate([(f"< {SLOW_KPH} km/h", 0), (f"{SLOW_KPH}-{FAST_KPH} km/h", SLOW_KPH),
                                             (f"> {FAST_KPH} km/h", FAST_KPH)]):
                draw_label(frame, text, (15, h - int((20 + 30 * (2 - i)) * ui)), speed_color(kph), 0.6 * ui)

            if not args.no_show:
                cv2.imshow("Speed Tracking", frame)
                if cv2.waitKey(1) & 0xFF == ord("q"):
                    break
            if time.time() - last_print > 2:
                last_print = time.time()
                eta = (total_frames - frames) / fps_live if total_frames and fps_live > 0 else 0
                pct = f"{100 * frames / total_frames:5.1f}%" if total_frames else ""
                print(f"\rframe {frames}/{total_frames or '?'} {pct} | {fps_live:5.1f} FPS | "
                      f"ETA {int(eta // 60)}m{int(eta % 60):02d}s | Ctrl+C to stop early   ", end="", flush=True)
                if hooks is not None:  # [web]
                    hooks.progress(frames=frames, total=total_frames, fps=fps_live, vehicles=sum(counts.values()),
                                   violations=len(speeding))
    except KeyboardInterrupt:
        print("\nStopped with Ctrl+C - finishing the output files...")
    print()
    if plates is not None:  # [web] read the plates still waiting
        plates.flush()
    reader.stop()
    cap.release()
    if frames_file:
        frames_file.close()
    cv2.destroyAllWindows()
    Path(tracker_cfg).unlink(missing_ok=True)

    rows = []
    for tid in speeds.first:
        votes = class_votes[tid]
        if sum(votes.values()) < args.min_frames:
            continue
        s = speeds.summary(tid)
        if s["avg_kph"] is not None:
            rows.append({"track_id": tid, "class": votes.most_common(1)[0][0], "frames": sum(votes.values()), **s,
                         "over_limit": tid in speeding})

    print("\n===== VEHICLES (unique tracks) =====")
    for cname, n in sorted(counts.items()):
        if n > 0:
            print(f"{cname}: {n}")
    print(f"Frames processed: {frames} | avg FPS: {frames / max(1e-6, time.time() - t_start):.1f}")

    print(f"\n===== SPEED ({len(rows)} vehicles measured inside a zone) =====")
    print(f"{'class':<14}{'vehicles':>9}{'avg km/h':>10}{'max km/h':>10}")
    by_class = defaultdict(list)
    for r in rows:
        by_class[r["class"]].append(r)
    for cname, rs in sorted(by_class.items()):
        print(f"{cname:<14}{len(rs):>9}{sum(r['avg_kph'] for r in rs) / len(rs):>10.1f}{max(r['max_kph'] for r in rs):>10.1f}")
    by_dir = defaultdict(list)
    for r in rows:
        by_dir[(r["zone"], r["direction"])].append(r["avg_kph"])
    for (zname, direction), v in sorted(by_dir.items()):
        print(f"zone {zname}, {direction}: {len(v)} vehicles, avg {sum(v) / len(v):.1f} km/h")

    if args.csv:
        with open(args.csv, "w", newline="") as f:
            wr = csv.DictWriter(f, fieldnames=["track_id", "class", "frames", "zone", "first_s", "last_s", "direction",
                                               "avg_kph", "max_kph", "section_m", "section_s", "section_kph",
                                               "over_limit"])
            wr.writeheader()
            wr.writerows(rows)
        print(f"Per-vehicle speeds written to {args.csv}")


if __name__ == "__main__":
    main()
