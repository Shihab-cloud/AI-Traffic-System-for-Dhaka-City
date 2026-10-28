"""Snapshot + close-up crop for each violation, and an optional violations.csv (command-line runs)."""

import csv
import json
from pathlib import Path

import cv2
import numpy as np

from .zones import draw_label

FIELDS = ["id", "code", "violation", "track_id", "class", "class_confidence", "video_time_s", "started_s",
          "wall_time", "zone", "areas", "kph", "details", "snapshot", "crop", "clip"]


def save_images(ev, frame, folder, stem, when_text, max_width=1920):
    """Writes <stem>.jpg (whole scene, violator boxed) and <stem>_crop.jpg (close-up at full resolution).
    `frame` must be the clean frame without overlays. Returns the two paths."""
    folder = Path(folder)
    folder.mkdir(parents=True, exist_ok=True)
    o = ev.obs
    x1, y1, x2, y2 = o.bbox
    h, w = frame.shape[:2]
    pad_x, pad_y = int(0.25 * (x2 - x1)) + 10, int(0.25 * (y2 - y1)) + 10
    crop = frame[max(0, y1 - pad_y):min(h, y2 + pad_y), max(0, x1 - pad_x):min(w, x2 + pad_x)]
    snap = frame.copy()
    ui = h / 1080
    if len(ev.path) >= 2:  # where it came from: older = thinner
        pts = np.int32(ev.path)
        for i in range(1, len(pts)):
            cv2.line(snap, tuple(pts[i - 1]), tuple(pts[i]), (0, 255, 255),
                     max(1, round((1 + 3 * i / len(pts)) * ui)), cv2.LINE_AA)
        cv2.circle(snap, tuple(pts[0]), max(3, round(5 * ui)), (0, 255, 255), -1, cv2.LINE_AA)
    cv2.rectangle(snap, (x1, y1), (x2, y2), (0, 0, 255), max(2, round(3 * ui)))
    draw_label(snap, f"{ev.code} {ev.title}: {o.cls} #{o.tid}", (x1, y1 - 8), (0, 0, 255), 0.7 * ui)
    draw_label(snap, when_text, (15, int(35 * ui)), (255, 255, 255), 0.7 * ui)
    if w > max_width:
        snap = cv2.resize(snap, (max_width, round(h * max_width / w)), interpolation=cv2.INTER_AREA)
    snap_path, crop_path = folder / f"{stem}.jpg", folder / f"{stem}_crop.jpg"
    cv2.imwrite(str(snap_path), snap, [cv2.IMWRITE_JPEG_QUALITY, 90])
    if crop.size:
        cv2.imwrite(str(crop_path), crop, [cv2.IMWRITE_JPEG_QUALITY, 95])
    return snap_path, crop_path if crop.size else None


def save_extra_frames(ev, folder, stem, label_time):
    """Writes the event's extra evidence photos (e.g. the moment a vehicle stopped). Returns
    [{"label", "time_s", "path"}]. `label_time(time_s)` formats the time printed on the photo."""
    out = []
    for label, t, data in ev.extra_frames:
        img = cv2.imdecode(np.frombuffer(data, np.uint8), cv2.IMREAD_COLOR)
        if img is None:
            continue
        ui = img.shape[0] / 1080
        draw_label(img, f"{label.upper()}: {label_time(t)}", (15, int(35 * ui)), (0, 200, 255), 0.7 * ui)
        path = Path(folder) / f"{stem}_{label}.jpg"
        cv2.imwrite(str(path), img, [cv2.IMWRITE_JPEG_QUALITY, 88])
        out.append({"label": label, "time_s": round(t, 2), "path": path})
    return out


def event_record(ev, wall_time=""):
    """Plain dict of an event, for CSV / database rows."""
    o = ev.obs
    return {"code": ev.code, "violation": ev.title, "track_id": o.tid, "class": o.cls,
            "class_confidence": round(o.purity, 2), "video_time_s": round(o.time_s, 2),
            "started_s": round(ev.started_s, 2) if ev.started_s is not None else None,
            "wall_time": wall_time, "zone": o.road.name if o.road else "", "areas": "|".join(sorted(o.areas)),
            "kph": round(o.kph, 1) if o.kph is not None else None, "details": ev.details}


class EvidenceWriter:
    """violations.csv + snapshots/ in one folder (used by the command-line tool)."""

    def __init__(self, out_dir):
        self.dir = Path(out_dir)
        (self.dir / "snapshots").mkdir(parents=True, exist_ok=True)
        self.file = open(self.dir / "violations.csv", "w", newline="")
        self.csv = csv.DictWriter(self.file, fieldnames=FIELDS)
        self.csv.writeheader()
        self.n = 0

    def write(self, ev, frame, wall_time="", clip_rel=""):
        self.n += 1
        stem = f"{self.n:05d}_{ev.code}_t{ev.obs.tid}_{ev.obs.time_s:.1f}s"
        when = wall_time or f"video {int(ev.obs.time_s // 60)}:{ev.obs.time_s % 60:05.2f}"
        snap, crop = save_images(ev, frame, self.dir / "snapshots", stem, when)
        save_extra_frames(ev, self.dir / "snapshots", stem, lambda t: f"video {int(t // 60)}:{t % 60:05.2f}")
        rec = event_record(ev, wall_time)
        rec.update(id=self.n, details=json.dumps(ev.details), snapshot=snap.relative_to(self.dir),
                   crop=crop.relative_to(self.dir) if crop else "", clip=clip_rel)
        self.csv.writerow(rec)
        self.file.flush()
        return stem

    def close(self):
        self.file.close()
