"""Violation clips: 15 s of the source video around a violation (12 s before, 3 s after), the flagged vehicle boxed in
red, as an H.264 MP4 that browsers play, uploaded next to the violation's images (S3 `<folder>/clip.mp4`).

The vehicle is found again in the clip instead of being handed over by the running script: the clip's frames are
tracked with the same detector and tracker (ByteTrack, 640 px), and the track whose box overlaps the violation's
recorded box at the violation moment is the vehicle, followed across a tracker id change by box overlap. So the same
job makes clips for violations stored before clips existed (the backend asks for those when a case is opened).
Recorded videos only: a live camera's past frames are gone. One clip at a time, in a background thread (~30-40 s
each for 2560x1440 on the RTX 2050: the frames are decoded twice, to track and to draw, so no clip is held in memory).
"""

import gc
import os
import queue
import shutil
import subprocess
import tempfile
import threading
import traceback
from datetime import timedelta
from pathlib import Path

import boto3
import cv2
import torch
from botocore.config import Config
from ultralytics.cfg import DEFAULT_CFG_DICT

from . import config
from vehicle_tracker import build_tracker_cfg, select_classes  # noqa: E402
from violations.zones import draw_label  # noqa: E402

BEFORE_S, AFTER_S = 12.0, 3.0
MAX_WIDTH = 1280          # clip width (the 2560 px source is halved: ~2-4 MB per clip)
MATCH_IOU = 0.3           # a track is the flagged vehicle if its box overlaps the recorded one this much
FOLLOW_IOU = 0.4          # ... and a new id takes over where it was lost
MAX_GAP_S = 0.5           # gaps up to this are bridged (box interpolated)


def ffmpeg_path():
    """vision/.env FFMPEG, else the copy in .tools/ffmpeg (the web folder runs on its own), else ffmpeg on PATH."""
    local = config.ROOT.parent / ".tools" / "ffmpeg" / "ffmpeg.exe"
    return config.env("FFMPEG") or (str(local) if local.exists() else shutil.which("ffmpeg"))


def find_video(value):
    """The video file of a violation: the full path (runs since clips exist) or just its name (older violations
    store the label), looked up in the video folders."""
    p = Path(value or "")
    if p.is_absolute() and p.is_file():
        return p
    for d in config.VIDEO_DIRS:
        if (d / p.name).is_file():
            return d / p.name
    return None


def s3_client():
    return boto3.client("s3", endpoint_url=config.S3_ENDPOINT, region_name=config.S3_REGION,
                        aws_access_key_id=config.S3_ACCESS_KEY, aws_secret_access_key=config.S3_SECRET_KEY,
                        config=Config(s3={"addressing_style": "path"}, retries={"max_attempts": 3}))


def iou(a, b):
    ix = max(0.0, min(a[2], b[2]) - max(a[0], b[0]))
    iy = max(0.0, min(a[3], b[3]) - max(a[1], b[1]))
    inter = ix * iy
    union = (a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - inter
    return inter / union if union > 0 else 0.0


def follow(per_frame, start, tid, frames, max_gap):
    """{frame: box} of one vehicle from `start` along `frames` (forward or backward), switching to a new track id
    whose box overlaps the last one when the tracker loses it, and stopping after a gap longer than max_gap frames."""
    boxes, last, gap, seen = {}, None, 0, {tid}
    for f in frames:
        tracks = per_frame.get(f, {})
        if tid not in tracks and last is not None:
            take = max(((t, iou(b, last)) for t, b in tracks.items() if t not in seen), key=lambda x: x[1], default=None)
            if take and take[1] > FOLLOW_IOU:
                tid = take[0]
                seen.add(tid)
        if tid in tracks:
            boxes[f], last, gap = tracks[tid], tracks[tid], 0
        elif f != start:
            gap += 1
            if gap > max_gap:
                break
    return boxes


def fill_gaps(boxes, max_gap):
    """Linear boxes for the frames missing between two known ones (short tracker gaps)."""
    known = sorted(boxes)
    for a, b in zip(known, known[1:]):
        if 1 < b - a <= max_gap + 1:
            for f in range(a + 1, b):
                w = (f - a) / (b - a)
                boxes[f] = tuple(p + w * (q - p) for p, q in zip(boxes[a], boxes[b]))
    return boxes


class ClipMaker:
    """Makes violation clips one at a time; results go to the backend as `clip` events (through the Sender)."""

    def __init__(self, sender):
        self.sender = sender
        self.jobs = queue.Queue()
        self.queued = set()   # event ids waiting or being made
        self.lock = threading.Lock()
        threading.Thread(target=self._run, daemon=True, name="clips").start()

    def request(self, job):
        """job: eventId, path (video file), atS (video time of the violation), bbox and frameSize (as recorded),
        label (text above the box), clock0 (camera clock at video time 0, naive local time, or None), prefix (S3
        folder). False if that clip is already on its way."""
        with self.lock:
            if job["eventId"] in self.queued:
                return False
            self.queued.add(job["eventId"])
        self.jobs.put(job)
        return True

    def _run(self):
        while True:
            job = self.jobs.get()
            try:
                result = self._make(job)
            except Exception as e:
                traceback.print_exc()
                result = {"status": "failed", "error": f"{e.__class__.__name__}: {e}"[:300]}
            finally:
                with self.lock:
                    self.queued.discard(job["eventId"])
                gc.collect()
                if torch.cuda.is_available():
                    torch.cuda.empty_cache()
            print(f"[clips] {job['eventId'][:8]} {job.get('label', '')}: {result['status']}"
                  + (f" ({result.get('error')})" if result["status"] != "done" else
                     f", {result['toS'] - result['fromS']:.0f} s, vehicle {'boxed' if result['marked'] else 'not found'}"),
                  flush=True)
            self.sender.post({"type": "clip", "eventId": job["eventId"], **result})

    def _make(self, job):
        ffmpeg = ffmpeg_path()
        if not ffmpeg:
            raise RuntimeError("ffmpeg not found: put ffmpeg.exe in .tools/ffmpeg/ or set FFMPEG in vision/.env")
        cap = cv2.VideoCapture(str(job["path"]))
        if not cap.isOpened():
            raise RuntimeError(f"Could not open {Path(job['path']).name}")
        try:
            fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
            total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
            W, H = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH)), int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
            f_at = round(float(job["atS"]) * fps)
            f0 = max(0, f_at - round(BEFORE_S * fps))
            f1 = f_at + round(AFTER_S * fps) + 1
            if total:
                f1 = min(f1, total)
            if f1 - f0 < fps:
                raise RuntimeError("The violation is at the very end of the video: no clip")
            fw, fh = job.get("frameSize") or (W, H)
            sx, sy = W / fw, H / fh
            target = tuple(v * s for v, s in zip(job["bbox"], (sx, sy, sx, sy)))
            boxes = self._track(cap, f0, f1, f_at, target, fps)
            data = self._render(cap, f0, f1, f_at, fps, boxes, job, ffmpeg, (W, H))
        finally:
            cap.release()
        key = f"{job['prefix']}/clip.mp4"
        self.sender.put(key, data, "video/mp4")
        return {"status": "done", "key": key, "fromS": round(f0 / fps, 2), "toS": round(f1 / fps, 2),
                "atS": round(float(job["atS"]), 2), "marked": bool(boxes), "sizeKb": len(data) // 1024}

    def _track(self, cap, f0, f1, f_at, target, fps):
        """{frame: box} of the flagged vehicle in the clip ({} if it is not found)."""
        from ultralytics import YOLO
        model = YOLO(str(config.VEHICLE_MODEL))   # a fresh tracker for each clip
        if torch.cuda.is_available():
            common = {"device": "0", **({"quantize": 16} if "quantize" in DEFAULT_CFG_DICT else {"half": True})}
        else:
            common = {"device": "cpu"}
        classes = select_classes(model.names, None, None)
        cfg = build_tracker_cfg("bytetrack", None, fps, 2.0, False)
        per_frame = {}   # frame -> {track id: box}
        cap.set(cv2.CAP_PROP_POS_FRAMES, f0)
        try:
            for f in range(f0, f1):
                ok, frame = cap.read()
                if not ok:
                    break
                r = model.track(frame, persist=True, tracker=cfg, classes=classes, conf=0.1, imgsz=640,
                                agnostic_nms=True, verbose=False, **common)[0]
                if r.boxes.id is not None:
                    per_frame[f] = {int(i): tuple(b) for i, b in zip(r.boxes.id.int().tolist(), r.boxes.xyxy.tolist())}
        finally:
            Path(cfg).unlink(missing_ok=True)
            del model
        best = None   # (track id, overlap, frame) at the violation moment, or the nearest frames to it
        for df in sorted(range(-round(fps / 2), round(fps / 2) + 1), key=abs):
            for tid, b in per_frame.get(f_at + df, {}).items():
                o = iou(b, target)
                if o > MATCH_IOU and (best is None or o > best[1]):
                    best = (tid, o, f_at + df)
            if best:
                break
        if best is None:
            return {}
        gap = round(MAX_GAP_S * fps)
        tid, _, f_best = best
        boxes = follow(per_frame, f_best, tid, range(f_best, f1), gap)
        boxes.update(follow(per_frame, f_best, tid, range(f_best, f0 - 1, -1), gap))
        return fill_gaps(boxes, gap)

    @staticmethod
    def _render(cap, f0, f1, f_at, fps, boxes, job, ffmpeg, size):
        W, H = size
        scale = min(1.0, MAX_WIDTH / W)
        w2, h2 = round(W * scale / 2) * 2, round(H * scale / 2) * 2   # even sizes for yuv420p
        ui = H / 1080
        fd, name = tempfile.mkstemp(suffix=".mp4")
        os.close(fd)   # ffmpeg writes it (Windows: an open handle locks the file)
        tmp = Path(name)
        proc = subprocess.Popen(
            [ffmpeg, "-y", "-loglevel", "error", "-f", "rawvideo", "-pix_fmt", "bgr24", "-s", f"{w2}x{h2}",
             "-r", f"{fps:.3f}", "-i", "-", "-c:v", "libx264", "-preset", "veryfast", "-crf", "28",
             "-pix_fmt", "yuv420p", "-movflags", "+faststart", str(tmp)],
            stdin=subprocess.PIPE, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        try:
            cap.set(cv2.CAP_PROP_POS_FRAMES, f0)
            for f in range(f0, f1):
                ok, frame = cap.read()
                if not ok:
                    break
                box = boxes.get(f)
                if box is not None:
                    x1, y1, x2, y2 = (int(v) for v in box)
                    cv2.rectangle(frame, (x1, y1), (x2, y2), (0, 0, 255), max(2, round(3 * ui)))
                    draw_label(frame, job.get("label", ""), (x1, max(20, y1 - 8)), (0, 0, 255), 0.7 * ui)
                dt = (f - f_at) / fps
                when = (f"violation in {-dt:.1f} s" if dt < -0.25 else "VIOLATION" if dt <= 0.25
                        else f"{dt:.1f} s after the violation")
                if job.get("clock0") is not None:
                    when = f"{job['clock0'] + timedelta(seconds=f / fps):%Y-%m-%d %H:%M:%S}  |  {when}"
                draw_label(frame, when, (15, int(40 * ui)), (0, 0, 255) if abs(dt) <= 0.25 else (255, 255, 255),
                           0.8 * ui)
                small = cv2.resize(frame, (w2, h2), interpolation=cv2.INTER_AREA)
                proc.stdin.write(small.tobytes())
            proc.stdin.close()
            if proc.wait() != 0:
                raise RuntimeError(f"ffmpeg could not encode the clip (exit {proc.returncode})")
            return tmp.read_bytes()
        finally:
            if proc.poll() is None:
                proc.kill()
            tmp.unlink(missing_ok=True)
