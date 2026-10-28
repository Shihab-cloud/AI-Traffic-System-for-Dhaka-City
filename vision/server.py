"""Vision service: runs the detection pipelines for the web portal.

    python server.py            (from vision/, with the project's .venv active)

Only the backend talks to the control endpoints (header x-vision-key). Browsers reach two endpoints directly with a
short-lived token the backend signs: the live view of a box (MJPEG) and video upload, so large videos and video
streams do not pass through the backend.
"""

import asyncio
import base64
import hashlib
import hmac
import json
import time
from datetime import datetime, timedelta
from pathlib import Path

import cv2
import numpy as np
import torch
import uvicorn
from fastapi import Depends, FastAPI, Header, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response, StreamingResponse
from pydantic import BaseModel, Field

from service import config, display
from service.hooks import Sender
from service.plates import PlateModels
from service.runner import SLOTS, Slot, SourceError, list_videos, resolve_source, upload_name
from service.autozone import AutoZoneJob
from service.clips import ClipMaker, find_video
from service.vlm import LocalVlm, VlmError

if not config.VISION_KEY or len(config.VISION_KEY) < 32:
    raise SystemExit("VISION_KEY is missing or shorter than 32 characters: copy it from apps/backend/.env "
                     "into vision/.env")

display.install()
for d in (config.UPLOADS, config.RUNS):
    d.mkdir(parents=True, exist_ok=True)
sender = Sender()
sender.start()
plate_models = PlateModels()
clips = ClipMaker(sender)
slots = {name: Slot(name, sender, plate_models, clips) for name in SLOTS}
vlm = LocalVlm()

app = FastAPI(title="Dhaka traffic vision service", docs_url="/docs")
app.add_middleware(CORSMiddleware, allow_origins=config.ALLOWED_ORIGINS, allow_methods=["GET", "POST"],
                   allow_headers=["*"], expose_headers=["x-frame-width", "x-frame-height"])


# ---------------------------------------------------------------- auth

def require_key(x_vision_key: str = Header(default="")):
    if not hmac.compare_digest(x_vision_key.encode(), config.VISION_KEY.encode()):
        raise HTTPException(401, "Bad or missing x-vision-key")


def _b64(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def check_token(token: str, purpose: str, slot: str | None = None):
    """Token = b64url(JSON {p, slot?, exp}) + "." + b64url(HMAC-SHA256(VISION_KEY, first part)), made by the backend."""
    try:
        body, sig = token.split(".", 1)
        good = _b64(hmac.new(config.VISION_KEY.encode(), body.encode(), hashlib.sha256).digest())
        if not hmac.compare_digest(sig, good):
            raise ValueError("signature")
        claims = json.loads(base64.urlsafe_b64decode(body + "=" * (-len(body) % 4)))
    except Exception:
        raise HTTPException(401, "Invalid token")
    if claims.get("p") != purpose or claims.get("exp", 0) < time.time() or (slot and claims.get("slot") != slot):
        raise HTTPException(401, "Token expired or not for this")
    return claims


def get_slot(slot: str) -> Slot:
    if slot not in slots:
        raise HTTPException(404, f"No box '{slot}'. Boxes: {', '.join(slots)}")
    return slots[slot]


# ---------------------------------------------------------------- status

@app.get("/health")
def health():
    return {"ok": True, "gpu": torch.cuda.get_device_name(0) if torch.cuda.is_available() else None,
            "slots": {n: (s.run.state if s.run else "idle") for n, s in slots.items()}}


@app.get("/slots", dependencies=[Depends(require_key)])
def all_slots():
    return {"slots": [s.status() for s in slots.values()],
            "delivery": {"sent": sender.sent, "rejected": sender.failed, "pending": sender.pending(),
                         "lastError": sender.last_error}}


@app.get("/slots/{slot}", dependencies=[Depends(require_key)])
def one_slot(slot: str):
    return get_slot(slot).status()


class SourceSpec(BaseModel):
    kind: str = Field(description="file | upload | ip | webcam")
    value: str


class StartRequest(BaseModel):
    source: SourceSpec
    camera: dict = {}
    zones: dict | None = None
    speedLimitKph: float = 60
    options: dict = {}


@app.post("/slots/{slot}/start", dependencies=[Depends(require_key)])
def start(slot: str, req: StartRequest):
    s = get_slot(slot)
    try:
        run = s.start(req.source.kind, req.source.value, req.camera, req.zones, req.speedLimitKph, req.options)
    except RuntimeError as e:
        raise HTTPException(409, str(e))
    except (SourceError, ValueError) as e:
        raise HTTPException(400, str(e))
    return run.public()


@app.post("/slots/{slot}/stop", dependencies=[Depends(require_key)])
def stop(slot: str):
    s = get_slot(slot)
    s.stop()
    return s.status()


# ---------------------------------------------------------------- live view (browser, token)

@app.get("/slots/{slot}/stream")
async def stream(slot: str, request: Request, token: str = Query(...)):
    check_token(token, "stream", slot)
    ch = get_slot(slot).channel

    async def frames():
        ch.viewers += 1
        seq = -1
        try:
            while not await request.is_disconnected():
                seq, jpg = await asyncio.to_thread(ch.wait_frame, seq, 2.0)
                if jpg:
                    yield (b"--frame\r\nContent-Type: image/jpeg\r\nContent-Length: " + str(len(jpg)).encode() +
                           b"\r\n\r\n" + jpg + b"\r\n")
        finally:
            ch.viewers -= 1

    return StreamingResponse(frames(), media_type="multipart/x-mixed-replace; boundary=frame",
                             headers={"Cache-Control": "no-store"})


@app.get("/slots/{slot}/snapshot")
def snapshot(slot: str, token: str = Query(...)):
    check_token(token, "stream", slot)
    jpg = get_slot(slot).channel.jpeg
    if not jpg:
        return Response(status_code=204)
    return Response(jpg, media_type="image/jpeg", headers={"Cache-Control": "no-store"})


# ---------------------------------------------------------------- videos

@app.get("/videos", dependencies=[Depends(require_key)])
def videos():
    return {"videos": list_videos(), "folders": [str(d) for d in config.VIDEO_DIRS]}


@app.post("/uploads")
async def upload(request: Request, token: str = Query(...), name: str = Query("video.mp4")):
    """Raw request body = the video file (fetch(url, {method: "POST", body: file}))."""
    check_token(token, "upload")
    try:
        stored = upload_name(name)
    except SourceError as e:
        raise HTTPException(400, str(e))
    limit = config.MAX_UPLOAD_GB * 2**30
    path, size = config.UPLOADS / stored, 0
    part = path.with_suffix(path.suffix + ".part")
    try:
        with open(part, "wb") as f:
            async for chunk in request.stream():
                size += len(chunk)
                if size > limit:
                    raise HTTPException(413, f"Video larger than {config.MAX_UPLOAD_GB:g} GB")
                f.write(chunk)
        if size == 0:
            raise HTTPException(400, "Empty upload")
        part.rename(path)
    finally:
        part.unlink(missing_ok=True)
    return {"kind": "upload", "value": stored, "sizeMb": round(size / 2**20, 1)}


class FrameRequest(BaseModel):
    source: SourceSpec
    atSec: float = 0.0


@app.post("/frame", dependencies=[Depends(require_key)])
def frame(req: FrameRequest):
    """One frame of a source (for drawing a camera's zones in the portal). For a video file, `atSec` past its end
    wraps around to the start; the headers give the time of the frame returned and the video's length."""
    try:
        src, _, live = resolve_source(req.source.kind, req.source.value)
    except SourceError as e:
        raise HTTPException(400, str(e))
    cap = cv2.VideoCapture(int(src)) if src.isdigit() else cv2.VideoCapture(src)
    at, duration = 0.0, 0.0
    try:
        if not cap.isOpened():
            raise HTTPException(400, "Could not open the source")
        if not live:
            fps, frames = cap.get(cv2.CAP_PROP_FPS), cap.get(cv2.CAP_PROP_FRAME_COUNT)
            duration = frames / fps if fps > 0 and frames > 0 else 0.0
            at = req.atSec % duration if duration else req.atSec
            if at > 0:
                cap.set(cv2.CAP_PROP_POS_MSEC, at * 1000)
        ok, img = cap.read()
        if not ok and at > 0:  # the last frames of a file are not always seekable: take the first one
            at = 0.0
            cap.set(cv2.CAP_PROP_POS_MSEC, 0)
            ok, img = cap.read()
        if not ok:
            raise HTTPException(400, "Could not read a frame")
    finally:
        cap.release()
    h, w = img.shape[:2]
    jpg = cv2.imencode(".jpg", img, [cv2.IMWRITE_JPEG_QUALITY, 90])[1].tobytes()
    headers = {"x-frame-width": str(w), "x-frame-height": str(h), "x-frame-at": f"{at:.2f}"}
    if duration:
        headers["x-video-duration"] = f"{duration:.2f}"
    return Response(jpg, media_type="image/jpeg", headers=headers)


class AutoZoneRequest(BaseModel):
    source: SourceSpec
    cameraId: str | None = None


autozone_job: AutoZoneJob | None = None


@app.post("/autozone", dependencies=[Depends(require_key)])
def autozone_start(req: AutoZoneRequest):
    """Learn a camera's zones from its traffic (service/autozone.py): a few minutes of video, in the background."""
    global autozone_job
    if autozone_job is not None and autozone_job.running:
        raise HTTPException(409, "Automatic zones are already being learned for "
                                 f"{autozone_job.status['source']['label']}: wait or cancel it")
    try:
        job = AutoZoneJob(req.source.kind, req.source.value, req.cameraId)
    except SourceError as e:
        raise HTTPException(400, str(e))
    job.start()
    autozone_job = job
    return job.status


@app.get("/autozone", dependencies=[Depends(require_key)])
def autozone_status():
    return autozone_job.status if autozone_job is not None else {"state": "idle"}


@app.delete("/autozone", dependencies=[Depends(require_key)])
def autozone_cancel():
    if autozone_job is not None:
        autozone_job.stop()
    return autozone_status()


class ExplainImage(BaseModel):
    kind: str
    caption: str = ""
    data: str   # base64 JPEG


class ExplainRequest(BaseModel):
    code: str
    title: str
    vehicleClass: str
    trackId: int | None = None
    kph: float | None = None
    bbox: list[float] | None = None
    frameSize: list[int] | None = None
    facts: str
    images: list[ExplainImage]
    clip: dict | None = None   # key, atS, fromS of the violation clip in S3: frames of it go to the model too


@app.get("/explain", dependencies=[Depends(require_key)])
def explain_status():
    return vlm.status()


@app.post("/explain", dependencies=[Depends(require_key)])
def explain(req: ExplainRequest):
    """A violation explained by the local vision-language model (service/vlm.py). Slow (10-25 s, plus ~15 s to
    load the model first); requests wait for each other."""
    try:
        return vlm.explain(req.model_dump())
    except VlmError as e:
        raise HTTPException(503, str(e))
    except ValueError as e:
        raise HTTPException(400, str(e))


class ClipRequest(BaseModel):
    eventId: str
    source: str           # the video file: full path, or the name stored with older violations
    atS: float            # video time of the violation
    bbox: list[float]
    frameSize: list[int] | None = None
    label: str = ""
    occurredAt: str | None = None   # camera clock at the violation (ISO), for the time shown in the clip
    prefix: str           # S3 folder of the violation's images


@app.post("/clips", dependencies=[Depends(require_key)], status_code=202)
def make_clip(req: ClipRequest):
    """Queue the clip of a stored violation (service/clips.py); the result arrives as a `clip` event."""
    path = find_video(req.source)
    if path is None:
        raise HTTPException(404, f"Video {Path(req.source).name} is not in the video folders any more")
    clock0 = None
    if req.occurredAt:
        at = datetime.fromisoformat(req.occurredAt.replace("Z", "+00:00"))
        at = at.astimezone(config.LOCAL_TZ).replace(tzinfo=None) if at.tzinfo else at
        clock0 = at - timedelta(seconds=req.atS)
    queued = clips.request({"eventId": req.eventId, "path": str(path), "atS": req.atS, "bbox": req.bbox,
                            "frameSize": req.frameSize, "label": req.label, "clock0": clock0, "prefix": req.prefix})
    return {"queued": queued}


class DescribeVehicle(BaseModel):
    vehicleClass: str = ""
    data: str   # base64 JPEG of the vehicle


class DescribeRequest(BaseModel):
    vehicles: list[DescribeVehicle] = Field(max_length=32)


@app.post("/describe", dependencies=[Depends(require_key)])
def describe(req: DescribeRequest):
    """Two-word looks ("grey SUV") for the passed-vehicle list, by the local vision-language model, ~0.5-1 s per
    vehicle. 409 while a box runs: the model and a running box together do not fit in the GPU's 4 GB; the backend
    tries again later."""
    if any(s.busy for s in slots.values()):
        raise HTTPException(409, "A surveillance box is running: vehicle descriptions wait until it has finished")
    try:
        images = [(cv2.imdecode(np.frombuffer(base64.b64decode(v.data), np.uint8), cv2.IMREAD_COLOR), v.vehicleClass)
                  for v in req.vehicles]
        if any(img is None for img, _ in images):
            raise HTTPException(400, "A vehicle image could not be read")
        return {"descriptions": vlm.describe(images), "model": vlm.status()["model"]}
    except VlmError as e:
        raise HTTPException(503, str(e))


@app.exception_handler(Exception)
async def unhandled(_, exc: Exception):
    return JSONResponse({"detail": f"{exc.__class__.__name__}: {exc}"}, status_code=500)


if __name__ == "__main__":
    print(f"Vision service on http://{config.HOST}:{config.PORT} | backend {config.BACKEND_URL} | "
          f"GPU: {torch.cuda.get_device_name(0) if torch.cuda.is_available() else 'none (CPU)'}")
    print(f"Video folders: {', '.join(str(d) for d in config.VIDEO_DIRS)}")
    uvicorn.run(app, host=config.HOST, port=config.PORT, log_level="warning")
