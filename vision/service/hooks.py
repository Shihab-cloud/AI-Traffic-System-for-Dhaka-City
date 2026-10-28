"""What the pipeline scripts hand to the web system: violations, plate reads, the passed-vehicle list, and
progress. Images go to S3, records to the backend (POST /api/vision/events), both from background threads (Sender)
so the video loop never waits for the network. Records the backend did not accept are kept in data/outbox.jsonl and sent
again later; an image upload is retried a few times, then dropped (the record still arrives, without that image).
"""

import base64
import json
import queue
import threading
import time
import uuid
from concurrent.futures import ThreadPoolExecutor, wait
from datetime import datetime, timedelta

import boto3
import cv2
import numpy as np
import requests
from botocore.config import Config

from . import config, reid
from .plates import WebPlateCollector
from violations.zones import FONT, draw_label  # noqa: E402


def jpeg(img, quality=90):
    ok, buf = cv2.imencode(".jpg", img, [cv2.IMWRITE_JPEG_QUALITY, quality])
    return buf.tobytes() if ok else None


def iso(dt):
    """ISO 8601 with the local (Dhaka) offset; naive times are camera-local."""
    if dt is None:
        return None
    return (dt if dt.tzinfo else dt.replace(tzinfo=config.LOCAL_TZ)).isoformat(timespec="seconds")


class Sender(threading.Thread):
    """Background delivery: S3 uploads and backend posts. Uploads run UPLOAD_THREADS at a time (on a long link, e.g.
    a Modal GPU in the US and the server in Asia, one at a time was ~0.5 s each); posts go one by one in the order
    they were queued, each after every upload queued before it (a record never arrives before its images)."""

    UPLOAD_THREADS = 8

    def __init__(self):
        super().__init__(daemon=True, name="sender")
        self.q = queue.Queue()
        self.s3 = boto3.client(
            "s3", endpoint_url=config.S3_ENDPOINT, region_name=config.S3_REGION,
            aws_access_key_id=config.S3_ACCESS_KEY, aws_secret_access_key=config.S3_SECRET_KEY,
            config=Config(s3={"addressing_style": "path"}, retries={"max_attempts": 3},
                          max_pool_connections=self.UPLOAD_THREADS))
        self.uploads = ThreadPoolExecutor(self.UPLOAD_THREADS, thread_name_prefix="upload")
        self.inflight = set()          # uploads not finished yet
        self.inflight_lock = threading.Lock()
        self.http = requests.Session()
        self.http.headers["x-vision-key"] = config.VISION_KEY
        self.outbox_lock = threading.Lock()
        self.sent = self.failed = 0
        self.last_error = ""

    def put(self, key, data, content_type="image/jpeg"):
        if data:
            with self.inflight_lock:
                fut = self.uploads.submit(self._upload, key, data, content_type)
                self.inflight.add(fut)
            fut.add_done_callback(self._uploaded)

    def _uploaded(self, fut):
        with self.inflight_lock:
            self.inflight.discard(fut)

    def post(self, payload):
        with self.inflight_lock:
            before = list(self.inflight)
        self.q.put(("post", payload, before))

    def busy(self):
        """Records or uploads only in memory (lost if the process stops); the outbox file is kept."""
        with self.inflight_lock:
            return bool(self.inflight) or self.q.unfinished_tasks > 0

    def pending(self):
        with self.inflight_lock:
            n = self.q.unfinished_tasks + len(self.inflight)  # queued records + the one being posted
        if config.OUTBOX.exists():
            with self.outbox_lock:
                n += sum(1 for line in config.OUTBOX.read_text(encoding="utf-8").splitlines() if line.strip())
        return n

    def run(self):
        last_retry = time.monotonic()
        while True:
            try:
                job = self.q.get(timeout=5)
            except queue.Empty:
                job = None
            if job is not None:
                wait(job[2])
                if not self._post(job[1]):
                    self._keep(job[1])
                self.q.task_done()
            if time.monotonic() - last_retry > 30 and self.q.empty():
                last_retry = time.monotonic()
                self._retry_outbox()

    def _upload(self, key, data, content_type):
        for attempt in range(3):
            try:
                self.s3.put_object(Bucket=config.S3_BUCKET, Key=key, Body=data, ContentType=content_type)
                return True
            except Exception as e:
                self.last_error = f"S3 upload {key}: {e}"
                time.sleep(1 + 2 * attempt)
        print(f"[sender] {self.last_error} (image dropped)")
        return False

    def _post(self, payload):
        try:
            r = self.http.post(f"{config.BACKEND_URL}/api/vision/events", json=payload, timeout=15)
            if r.status_code < 300:
                self.sent += 1
                return True
            self.last_error = f"backend {r.status_code}: {r.text[:200]}"
            # 404: backend without the events route (older build) - keep, like when it is down
            if 400 <= r.status_code < 500 and r.status_code not in (401, 403, 404, 408, 429):
                print(f"[sender] rejected {payload.get('type')} {payload.get('eventId', '')}: {self.last_error}")
                self.failed += 1
                return True  # a malformed record will never be accepted: do not retry it forever
        except requests.RequestException as e:
            self.last_error = f"backend unreachable: {e.__class__.__name__}"
        return False

    def _keep(self, payload):
        with self.outbox_lock:
            config.OUTBOX.parent.mkdir(parents=True, exist_ok=True)
            with open(config.OUTBOX, "a", encoding="utf-8") as f:
                f.write(json.dumps(payload, ensure_ascii=False) + "\n")

    def _retry_outbox(self):
        with self.outbox_lock:
            if not config.OUTBOX.exists():
                return
            lines = [ln for ln in config.OUTBOX.read_text(encoding="utf-8").splitlines() if ln.strip()]
            config.OUTBOX.unlink()
        left = []
        for i, line in enumerate(lines):
            if not self._post(json.loads(line)):
                left = lines[i:]  # backend still down: keep the rest in order
                break
        if left:
            with self.outbox_lock:
                with open(config.OUTBOX, "a", encoding="utf-8") as f:
                    f.write("\n".join(left) + "\n")


def violation_label(code, title, cls, track_id, kph=None):
    """The text drawn above the vehicle in the scene image (vlm.py recomputes it to hide it from the model).
    The speed only on over-speed (V2) cases: for the other rules it is not evidence."""
    return f"{code} {title}: {cls} #{track_id}" + (f" {kph:.0f} km/h" if kph is not None and code == "V2" else "")


def label_rect(text, org, scale):
    """Box that zones.draw_label fills for `text` at `org` (x1, y1, x2, y2)."""
    thickness = max(1, round(scale * 3))
    (tw, th), base = cv2.getTextSize(text, FONT, scale, thickness)
    x, y = int(org[0]), max(th + 4, int(org[1]))
    return x - 3, y - th - 4, x + tw + 3, y + base


def scene_label_org(bbox, frame_h):
    """Where scene_image puts the violation label, and its scale."""
    ui = frame_h / 1080
    return (int(bbox[0]), max(20, int(bbox[1]) - 8)), 0.7 * ui


def scene_image(frame, bbox, label, when_text, path=None, max_width=1920):
    """Whole scene with the vehicle boxed in red, its recent path in yellow (as violations.evidence.save_images)."""
    snap = frame.copy()
    h, w = snap.shape[:2]
    ui = h / 1080
    x1, y1, x2, y2 = (int(v) for v in bbox)
    if path and len(path) >= 2:
        pts = np.int32(path)
        for i in range(1, len(pts)):
            cv2.line(snap, tuple(pts[i - 1]), tuple(pts[i]), (0, 255, 255),
                     max(1, round((1 + 3 * i / len(pts)) * ui)), cv2.LINE_AA)
    cv2.rectangle(snap, (x1, y1), (x2, y2), (0, 0, 255), max(2, round(3 * ui)))
    org, scale = scene_label_org(bbox, h)
    draw_label(snap, label, org, (0, 0, 255), scale)
    if when_text:
        draw_label(snap, when_text, (15, int(35 * ui)), (255, 255, 255), 0.7 * ui)
    if w > max_width:
        snap = cv2.resize(snap, (max_width, round(h * max_width / w)), interpolation=cv2.INTER_AREA)
    return snap


def closeup(frame, bbox, pad=0.25):
    h, w = frame.shape[:2]
    x1, y1, x2, y2 = (int(v) for v in bbox)
    px, py = int(pad * (x2 - x1)) + 10, int(pad * (y2 - y1)) + 10
    crop = frame[max(0, y1 - py):min(h, y2 + py), max(0, x1 - px):min(w, x2 + px)]
    return crop if crop.size else None


def plate_fields(r):
    """PlateVotes.result() (+ extras) -> the backend's plate object."""
    return {"registration": r.get("registration", ""), "number": r.get("number", ""), "area": r.get("area", ""),
            "metro": bool(r.get("metro")), "letter": r.get("letter", ""), "status": r.get("status", "unreadable"),
            "confidence": round(float(r.get("conf") or 0), 3), "agreeingReads": int(r.get("agree") or 0),
            "plateWidthPx": int(r.get("plate_px") or 0)}


class Hooks:
    """Passed as `hooks` to speed_tracker.main / violation_tracker.main for one run."""

    def __init__(self, run, sender, plate_models, clips=None):
        self.run, self.sender, self.plate_models, self.clips = run, sender, plate_models, clips
        self.prefix = {}   # violation event id -> S3 folder

    # --- times
    def when(self, video_time_s, wall_text=""):
        if wall_text:
            try:
                return datetime.strptime(wall_text, "%Y-%m-%d %H:%M:%S")
            except ValueError:
                pass
        if self.run.clock0 is not None and video_time_s is not None:
            return self.run.clock0 + timedelta(seconds=float(video_time_s))
        return datetime.now(config.LOCAL_TZ)

    def _base(self, kind):
        r = self.run
        return {"type": kind, "slot": r.slot, "runId": r.run_id, "cameraId": r.camera.get("id"),
                "cameraName": r.camera.get("name"), "source": {"kind": r.source_kind, "value": r.source_label}}

    # --- violations (speed_tracker, violation_tracker)
    def violation(self, record, frame, bbox, path=None, extra_frames=None):
        """Store one violation; returns its event id (the key the plate result will refer to)."""
        event_id = uuid.uuid4().hex
        t_video = record.get("video_time_s")
        at = self.when(t_video, record.get("wall_time", ""))
        prefix = f"violations/{at:%Y/%m/%d}/{event_id}"
        self.prefix[event_id] = prefix
        when_text = at.strftime("%Y-%m-%d %H:%M:%S")
        label = violation_label(record["code"], record["title"], record["class"], record["track_id"], record.get("kph"))
        images = []

        def add(kind, img, quality=90, caption=""):
            data = jpeg(img, quality) if img is not None else None
            if data:
                key = f"{prefix}/{kind}.jpg"
                self.sender.put(key, data)
                images.append({"kind": kind, "key": key, "caption": caption})

        add("scene", scene_image(frame, bbox, label, when_text, path), 88, "Violation moment")
        add("closeup", closeup(frame, bbox), 95, "Close-up")
        for name, t, data in extra_frames or []:  # e.g. the moment a parked vehicle stopped
            img = cv2.imdecode(np.frombuffer(data, np.uint8), cv2.IMREAD_COLOR)
            if img is not None:
                ui = img.shape[0] / 1080
                draw_label(img, f"{name.upper()}: {self.when(t):%Y-%m-%d %H:%M:%S}", (15, int(35 * ui)),
                           (0, 200, 255), 0.7 * ui)
                add(name, img, 85, name.replace("_", " ").capitalize())
        details = record.get("details") or {}
        if isinstance(details, str):
            try:
                details = json.loads(details)
            except ValueError:
                details = {"text": details}
        speed = record["code"] == "V2"  # speeds belong to over-speed cases only
        # a clip of the violation (service/clips.py), from recorded videos: a live camera's past frames are gone
        clip = self.clips is not None and not self.run.live and t_video is not None
        self.sender.post({
            **self._base("violation"), "eventId": event_id, "code": record["code"], "title": record["title"],
            "trackId": record["track_id"], "vehicleClass": record["class"],
            "classConfidence": record.get("class_confidence"), "kph": record.get("kph") if speed else None,
            "avgKph": record.get("avg_kph") if speed else None,
            "limitKph": (record.get("limit_kph") or details.get("limit_kph")) if speed else None,
            "zone": record.get("zone", ""), "areas": [a for a in str(record.get("areas") or "").split("|") if a],
            "videoTimeS": t_video, "occurredAt": iso(at), "details": details, "images": images,
            "frameSize": [int(frame.shape[1]), int(frame.shape[0])], "bbox": [int(v) for v in bbox],
            "clip": "pending" if clip else None,
        })
        if clip:
            local = at.astimezone(config.LOCAL_TZ).replace(tzinfo=None) if at.tzinfo else at
            self.clips.request({"eventId": event_id, "path": self.run.source_value, "atS": float(t_video),
                                "bbox": [int(v) for v in bbox], "frameSize": [int(frame.shape[1]), int(frame.shape[0])],
                                "label": label, "clock0": local - timedelta(seconds=float(t_video)), "prefix": prefix})
        self.run.stats["violations"] += 1
        return event_id

    def plate_collector(self, list_vehicles=True, read_listed=True):
        """Reads the violators' plates and lists every vehicle that passes (a sighting: the passed-vehicle list and
        its Vehicle ID across cameras), with its plate read when read_listed (violation_tracker; the speed box reads
        only its violators' plates)."""
        return WebPlateCollector(self.plate_models, self._plate_result,
                                 self._vehicle if list_vehicles else None, live=self.run.live,
                                 read_listed=read_listed, encoder=reid.encoder() if list_vehicles else None)

    def _plate_result(self, event_id, result, plate_img, evidence_img=None):
        images = []
        prefix = self.prefix.get(event_id, f"violations/unknown/{event_id}")
        for kind, img, caption in (("plate", plate_img, "Number plate"),
                                   ("plate_vehicle", evidence_img, "Vehicle and plate")):
            data = jpeg(img, 95) if img is not None and img.size else None
            if data:
                self.sender.put(f"{prefix}/{kind}.jpg", data)
                images.append({"kind": kind, "key": f"{prefix}/{kind}.jpg", "caption": caption})
        self.sender.post({**self._base("plate"), "eventId": event_id, "plate": plate_fields(result),
                          "images": images})
        self.run.stats["plates"] += 1

    # --- passed-vehicle list (violation_tracker's plate collector)
    def _vehicle(self, vehicle, result, plate_img, evidence_img):
        """A vehicle has left the picture: one row of the passed-vehicle list (a plate sighting in the backend, which
        has the vision service describe its look from the vehicle image)."""
        sighting_id = uuid.uuid4().hex
        first, last = self.when(vehicle["first_s"]), self.when(vehicle["last_s"])
        prefix = f"sightings/{first:%Y/%m/%d}/{sighting_id}"
        view = None
        if vehicle.get("thumb"):
            view = cv2.imdecode(np.frombuffer(vehicle["thumb"], np.uint8), cv2.IMREAD_COLOR)
            if view is not None and view.shape[1] > 480:
                view = cv2.resize(view, (480, round(view.shape[0] * 480 / view.shape[1])), interpolation=cv2.INTER_AREA)
        images = []
        for kind, img, quality, caption in (("vehicle", view, 85, "Vehicle"), ("plate", plate_img, 95, "Number plate"),
                                            ("evidence", evidence_img, 92, "Vehicle and plate")):
            data = jpeg(img, quality) if img is not None and img.size else None
            if data:
                self.sender.put(f"{prefix}/{kind}.jpg", data)
                images.append({"kind": kind, "key": f"{prefix}/{kind}.jpg", "caption": caption})
        vec = lambda a: base64.b64encode(np.asarray(a, np.float32).tobytes()).decode() if a is not None else None  # noqa: E731
        self.sender.post({
            **self._base("sighting"), "sightingId": sighting_id, "trackId": vehicle["track_id"],
            "vehicleClass": vehicle["class"], "plate": plate_fields(result), "completeReads": result.get("complete", 0),
            "firstSeen": iso(first), "lastSeen": iso(last), "videoTimeS": round(vehicle["first_s"], 2),
            "images": images,
            # multi-camera tracking (backend VehicleIdentityService): where it came in / went out, what it looks like
            "entry": vehicle.get("entry"), "exit": vehicle.get("exit"), "frameSize": vehicle.get("frame"),
            "embedding": vec(vehicle.get("embedding")), "colour": vec(vehicle.get("colour")),
            "reidModel": reid.MODEL if vehicle.get("embedding") is not None else None,
        })
        self.run.stats["sightings"] += 1

    # --- traffic direction learned during the run (violation_tracker); sent with the run's final record
    def learning(self, suggestions):
        self.run.learning = {name: {k: d[k] for k in ("toward", "away", "suggestion")} for name, d in suggestions.items()}

    # --- progress
    def progress(self, **kw):
        self.run.progress.update(kw)
        self.run.progress["updatedAt"] = time.time()
