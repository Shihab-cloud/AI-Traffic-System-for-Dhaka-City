"""
Vehicle Detection & Tracking (v4)

Works with the stock COCO models (yolov8n.pt, ...) and with Bangladeshi-vehicle
models such as the BNVD YOLOv8m checkpoint or your own fine-tuned best.pt.

Usage:
    python vehicle_tracker.py --source road.mp4 --model bnvd_yolov8m.pt
    python vehicle_tracker.py --source road.mp4 --model best.pt --roi 0 300 1920 1080 --csv tracks.csv
    python vehicle_tracker.py --source road.mp4 --model best.pt --exclude Pedestrian Wheelbarrow
    python vehicle_tracker.py --source road.mp4 --model best.pt --tracker botsort --reid --line 0 700 1920 700

Class selection (case-insensitive):
    - COCO model  -> bicycle, car, motorcycle, bus, truck
    - custom model -> every class except person/pedestrian
    - override with --classes ... / --exclude ...
"""

import argparse
import csv
import queue
import tempfile
import threading
import time
from collections import Counter, defaultdict, deque
from pathlib import Path

import cv2
import torch
import yaml
from ultralytics import YOLO
from ultralytics.cfg import DEFAULT_CFG_DICT
from ultralytics.utils.checks import check_yaml

COCO_VEHICLES = {"bicycle", "car", "motorcycle", "bus", "truck"}
DEFAULT_EXCLUDE = ["person", "pedestrian"]


def parse_args():
    p = argparse.ArgumentParser(description="YOLO + ByteTrack vehicle detection and tracking")
    p.add_argument("--source", default="0", help="Video path or webcam index")
    p.add_argument("--model", default="yolov8n.pt", help="Ultralytics detection checkpoint")
    p.add_argument("--classes", nargs="+", default=None, help='Class names to keep, or "all"')
    p.add_argument("--exclude", nargs="*", default=None, help="Class names to drop (default: person/pedestrian)")
    p.add_argument("--conf", type=float, default=None,
                   help="Min confidence to start/confirm a track (default: the tracker's own tuned value)")
    p.add_argument("--imgsz", type=int, default=640, help="Inference size (multiple of 32)")
    p.add_argument("--roi", type=int, nargs=4, metavar=("X1", "Y1", "X2", "Y2"), default=None,
                   help="Only detect inside this pixel rectangle (faster, and small far-away objects get more pixels)")
    p.add_argument("--class-nms", action="store_true",
                   help="Per-class NMS (default is class-agnostic, which removes car+truck double boxes on one vehicle)")
    p.add_argument("--device", default=None, help='"0" for GPU, "cpu" for CPU (default: auto)')
    p.add_argument("--tracker", default="bytetrack",
                   choices=["bytetrack", "botsort", "ocsort", "deepocsort", "tracktrack", "fasttrack"])
    p.add_argument("--reid", action="store_true",
                   help="Use appearance (ReID) features: botsort/deepocsort/tracktrack only. Slower, fewer ID switches")
    p.add_argument("--line", type=int, nargs=4, metavar=("X1", "Y1", "X2", "Y2"), default=None,
                   help="Count vehicles when they cross this line (full-frame pixels)")
    p.add_argument("--track-buffer-sec", type=float, default=1.0, help="Seconds a lost track is kept alive")
    p.add_argument("--min-frames", type=int, default=5, help="Frames a track must exist to be counted")
    p.add_argument("--csv", default=None, help="Path to save per-frame track data (.csv)")
    p.add_argument("--no-show", action="store_true", help="Don't open a preview window")
    return p.parse_args()


def select_classes(names: dict, include, exclude):
    lower = {i: n.lower() for i, n in names.items()}
    if include and [c.lower() for c in include] != ["all"]:
        want = {c.lower() for c in include}
        ids = [i for i, n in lower.items() if n in want]
        missing = want - {lower[i] for i in ids}
        if missing:
            raise SystemExit(f"Classes not in model: {sorted(missing)}. Model has: {list(names.values())}")
    elif not include and len(names) == 80 and COCO_VEHICLES <= set(lower.values()):
        ids = [i for i, n in lower.items() if n in COCO_VEHICLES]  # stock COCO model
    else:
        ids = list(names)
    drop = {c.lower() for c in (DEFAULT_EXCLUDE if exclude is None else exclude)}
    return [i for i in ids if lower[i] not in drop]


def build_tracker_cfg(name: str, conf, fps: float, buffer_sec: float, reid: bool) -> str:
    """Copy Ultralytics' tracker YAML and adjust it for this video."""
    try:
        cfg = yaml.safe_load(Path(check_yaml(f"{name}.yaml")).read_text())
    except Exception:
        raise SystemExit(f"Tracker '{name}' not found in your Ultralytics version. Run: pip install -U ultralytics")
    if conf is not None:
        cfg["track_high_thresh"] = conf
        cfg["new_track_thresh"] = max(conf, cfg.get("new_track_thresh", conf))
    cfg["track_buffer"] = max(1, int(round(fps * buffer_sec)))
    if reid:
        if "with_reid" not in cfg:
            raise SystemExit(f"--reid is not supported by '{name}'. Use botsort, deepocsort or tracktrack.")
        cfg["with_reid"] = True
    tmp = tempfile.NamedTemporaryFile("w", suffix=".yaml", delete=False)
    yaml.safe_dump(cfg, tmp)
    tmp.close()
    return tmp.name


class LineCounter:
    """Counts each track once when its bottom-centre point crosses the line segment."""

    def __init__(self, x1, y1, x2, y2):
        self.a, self.b = (x1, y1), (x2, y2)
        self.horizontal = abs(x2 - x1) >= abs(y2 - y1)
        self.last = {}          # track_id -> last bottom-centre point
        self.done = set()       # track ids already counted
        self.counts = Counter()  # (class, direction) -> n
        self.events = []        # (frame, track_id, class, direction)

    @staticmethod
    def _orient(p, q, r):
        return (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0])

    def update(self, frame_idx, tid, point, cname):
        prev = self.last.get(tid)
        self.last[tid] = point
        if prev is None or tid in self.done:
            return
        s1, s2 = self._orient(self.a, self.b, prev), self._orient(self.a, self.b, point)
        if (s1 < 0) == (s2 < 0) or s1 == s2:
            return
        # the movement segment must pass between the line's end points
        if self._orient(prev, point, self.a) * self._orient(prev, point, self.b) > 0:
            return
        if self.horizontal:
            direction = "down" if point[1] > prev[1] else "up"
        else:
            direction = "right" if point[0] > prev[0] else "left"
        self.done.add(tid)
        self.counts[(cname, direction)] += 1
        self.events.append((frame_idx, tid, cname, direction))

    def totals(self):
        t = Counter()
        for (cname, _), n in self.counts.items():
            t[cname] += n
        return t


def color_for(track_id: int):
    return tuple(int(c) for c in ((track_id * 37) % 255, (track_id * 91) % 255, (track_id * 151) % 255))


class FrameReader(threading.Thread):
    """Decodes video frames in a background thread so decoding overlaps with GPU inference."""

    def __init__(self, cap, maxsize=8):
        super().__init__(daemon=True)
        self.cap, self.q, self.stopped = cap, queue.Queue(maxsize), False

    def run(self):
        while not self.stopped:
            ok, frame = self.cap.read()
            self.q.put(frame if ok else None)
            if not ok:
                break

    def read(self):
        return self.q.get()

    def stop(self):
        self.stopped = True
        while self.is_alive():  # unblock a pending put()
            try:
                self.q.get(timeout=0.1)
            except queue.Empty:
                pass


def is_live(source) -> bool:
    """[web] Camera index or network stream (as opposed to a video file)."""
    s = str(source).strip().lower()
    return s.isdigit() or s.startswith(("http://", "https://", "rtsp://", "rtmp://", "udp://", "tcp://"))


def open_capture(source):
    """[web] cv2.VideoCapture for a file, a camera index ("0") or a stream URL."""
    return cv2.VideoCapture(int(source)) if str(source).strip().isdigit() else cv2.VideoCapture(source)


class LiveFrameReader(threading.Thread):
    """[web] Live camera: always hands out the newest frame (older ones are dropped, so the view stays real time).
    After read(), `elapsed` is the capture time of that frame in seconds since the first frame, for code that
    measures time (speed) and must not count frames, because frames are dropped."""

    def __init__(self, cap):
        super().__init__(daemon=True)
        self.cap, self.stopped, self.cond = cap, False, threading.Condition()
        self.frame, self.seq, self.taken, self.t0, self.t = None, 0, 0, None, 0.0
        self.elapsed, self.ended = 0.0, False

    def run(self):
        while not self.stopped:
            ok, frame = self.cap.read()
            now = time.time()
            with self.cond:
                if not ok:
                    self.ended = True
                    self.cond.notify_all()
                    break
                if self.t0 is None:
                    self.t0 = now
                self.frame, self.t, self.seq = frame, now - self.t0, self.seq + 1
                self.cond.notify_all()

    def read(self):
        with self.cond:
            while self.seq == self.taken and not self.ended and not self.stopped:
                self.cond.wait(timeout=1.0)
            if self.seq == self.taken:
                return None
            self.taken, self.elapsed = self.seq, self.t
            return self.frame

    def stop(self):
        self.stopped = True
        with self.cond:
            self.cond.notify_all()


def main():
    args = parse_args()
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

    cap = cv2.VideoCapture(int(args.source)) if args.source.isdigit() else cv2.VideoCapture(args.source)
    if not cap.isOpened():
        raise SystemExit(f"Could not open source: {args.source}")
    fps = cap.get(cv2.CAP_PROP_FPS) or 30
    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
    w, h = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH)), int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))

    if args.roi:
        x1r, y1r, x2r, y2r = args.roi
        x1r, y1r, x2r, y2r = max(0, x1r), max(0, y1r), min(w, x2r), min(h, y2r)
        if x2r - x1r < 32 or y2r - y1r < 32:
            raise SystemExit(f"ROI {args.roi} is invalid for a {w}x{h} video")
    else:
        x1r, y1r, x2r, y2r = 0, 0, w, h

    tracker_cfg = build_tracker_cfg(args.tracker, args.conf, fps, args.track_buffer_sec, args.reid)
    print(f"Tracker: {args.tracker}{' + ReID' if args.reid else ''}")
    line = LineCounter(*args.line) if args.line else None
    csv_file = open(args.csv, "w", newline="") if args.csv else None
    csv_writer = csv.writer(csv_file) if csv_file else None
    if csv_writer:
        csv_writer.writerow(["frame", "track_id", "class", "conf", "x1", "y1", "x2", "y2"])
    if not args.no_show:
        cv2.namedWindow("Vehicle Tracking", cv2.WINDOW_NORMAL)  # resizable for 1080p/4K footage

    class_votes = defaultdict(Counter)  # track_id -> Counter(class_name)
    track_major = {}                    # counted track_id -> its current majority class
    counts = Counter()
    frames, t_start = 0, time.time()
    recent = deque(maxlen=30)  # timestamps for a rolling FPS
    WARMUP = 10  # first frames include CUDA/cuDNN warm-up; excluded from the timing breakdown
    prof = Counter()
    reader = FrameReader(cap)
    reader.start()

    last_print = time.time()
    try:
        while True:
            t0 = time.perf_counter()
            frame = reader.read()
            if frame is None:
                break
            frames += 1
            t1 = time.perf_counter()
            roi = frame[y1r:y2r, x1r:x2r]

            result = model.track(
                roi, persist=True, tracker=tracker_cfg, classes=class_ids, conf=0.1,
                imgsz=args.imgsz, device=device, agnostic_nms=not args.class_nms,
                verbose=False, **precision,
            )[0]
            t2 = time.perf_counter()

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
                    label = f"{major} #{tid}"
                    if line:
                        line.update(frames, tid, ((bx1 + bx2) // 2, by2), major)
                    col = color_for(tid)
                    cv2.rectangle(frame, (bx1, by1), (bx2, by2), col, 2)
                    cv2.putText(frame, label, (bx1, max(15, by1 - 6)), cv2.FONT_HERSHEY_SIMPLEX, 0.6, col, 2)
                    if csv_writer:
                        csv_writer.writerow([frames, tid, cname, f"{cf:.3f}", bx1, by1, bx2, by2])

            recent.append(time.time())
            fps_live = (len(recent) - 1) / (recent[-1] - recent[0]) if len(recent) > 1 else 0.0

            if args.roi:
                cv2.rectangle(frame, (x1r, y1r), (x2r, y2r), (0, 200, 255), 2)
            if line:
                cv2.line(frame, line.a, line.b, (0, 0, 255), 2)
            y = 30
            cv2.putText(frame, f"FPS: {fps_live:.1f}", (15, y), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 255, 0), 2)
            shown = line.totals() if line else counts
            if line:
                y += 28
                cv2.putText(frame, "Line crossings:", (15, y), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 0, 255), 2)
            for cname, n in sorted(shown.items()):
                if n <= 0:
                    continue
                y += 28
                cv2.putText(frame, f"{cname}: {n}", (15, y), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (255, 255, 0), 2)

            t3 = time.perf_counter()
            quit_key = False
            if not args.no_show:
                cv2.imshow("Vehicle Tracking", frame)
                quit_key = cv2.waitKey(1) & 0xFF == ord("q")
            t4 = time.perf_counter()

            if frames > WARMUP:
                sp = result.speed
                prof["frames"] += 1
                prof["wait for decoded frame"] += (t1 - t0) * 1e3
                prof["model preprocess (CPU)"] += sp["preprocess"]
                prof["model inference (GPU)"] += sp["inference"]
                prof["model postprocess/NMS"] += sp["postprocess"]
                prof["tracker + overhead"] += (t2 - t1) * 1e3 - sum(sp.values())
                prof["drawing + counting"] += (t3 - t2) * 1e3
                prof["display"] += (t4 - t3) * 1e3
            if time.time() - last_print > 2:
                last_print = time.time()
                eta = (total_frames - frames) / fps_live if total_frames and fps_live > 0 else 0
                pct = f"{100 * frames / total_frames:5.1f}%" if total_frames else ""
                print(f"\rframe {frames}/{total_frames or '?'} {pct} | {fps_live:5.1f} FPS | "
                      f"ETA {int(eta // 60)}m{int(eta % 60):02d}s | Ctrl+C to stop early   ", end="", flush=True)
            if quit_key:
                break
    except KeyboardInterrupt:
        print("\nStopped with Ctrl+C - finishing the output files...")
    print()
    reader.stop()
    cap.release()
    if csv_file:
        csv_file.close()
    cv2.destroyAllWindows()
    Path(tracker_cfg).unlink(missing_ok=True)

    print("\n===== SUMMARY =====")
    for cname, n in sorted(counts.items()):
        if n > 0:
            print(f"{cname}: {n} unique tracks (seen >= {args.min_frames} frames)")
    print(f"Frames processed: {frames} | avg FPS: {frames / max(1e-6, time.time() - t_start):.1f}")

    if line:
        print("\n===== LINE CROSSINGS =====")
        dirs = sorted({d for _, d in line.counts})
        print(f"{'class':<14}" + "".join(f"{d:>8}" for d in dirs) + f"{'total':>8}")
        for cname, tot in sorted(line.totals().items()):
            print(f"{cname:<14}" + "".join(f"{line.counts[(cname, d)]:>8}" for d in dirs) + f"{tot:>8}")
        print(f"{'ALL':<14}" + "".join(f"{sum(n for (c, d2), n in line.counts.items() if d2 == d):>8}" for d in dirs)
              + f"{sum(line.counts.values()):>8}")
        if args.csv:
            cpath = Path(args.csv).with_name(Path(args.csv).stem + "_crossings.csv")
            with open(cpath, "w", newline="") as f:
                wr = csv.writer(f)
                wr.writerow(["frame", "time_s", "track_id", "class", "direction"])
                for fr, tid, cname, d in line.events:
                    wr.writerow([fr, f"{fr / fps:.2f}", tid, cname, d])
            print(f"Crossings written to {cpath}")

    if prof["frames"]:
        n = prof.pop("frames")
        total = sum(prof.values()) / n
        print(f"\n===== TIME PER FRAME (ms, excluding first {WARMUP} frames) =====")
        for k, v in prof.items():
            print(f"{k:<24}{v / n:8.1f}  {100 * v / n / total:5.1f}%")
        print(f"{'total':<24}{total:8.1f}  -> {1000 / total:.1f} FPS")


if __name__ == "__main__":
    main()
