"""Settings of the vision service: vision/.env (KEY=value lines), overridden by real environment variables. With
VISION_ENV=<name>, vision/.env.<name> is read first and wins over .env."""

import os
import sys
from datetime import timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]   # vision/
PIPELINES = ROOT / "pipelines"
MODELS = ROOT / "models"


def _load_env(path):
    if not path.exists():
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


if os.environ.get("VISION_ENV"):
    _load_env(ROOT / f".env.{os.environ['VISION_ENV']}")
_load_env(ROOT / ".env")


def env(name, default=""):
    return os.environ.get(name, default)


HOST = env("VISION_HOST", "127.0.0.1")
PORT = int(env("VISION_PORT", "8601"))
# Shared with the backend: it signs the requests it sends here and the stream/upload tokens it hands to browsers.
VISION_KEY = env("VISION_KEY")
BACKEND_URL = env("BACKEND_URL", "http://127.0.0.1:5001").rstrip("/")
ALLOWED_ORIGINS = [o.strip() for o in env("ALLOWED_ORIGINS", "http://localhost:3000").split(",") if o.strip()]

S3_ENDPOINT = env("AWS_S3_ENDPOINT") or None
S3_REGION = env("AWS_S3_BUCKET_REGION", "us-east-1")
S3_BUCKET = env("AWS_S3_BUCKET_NAME", "traffic-evidence")
S3_ACCESS_KEY = env("AWS_S3_ACCESS_KEY") or None
S3_SECRET_KEY = env("AWS_S3_SECRET_ACCESS_KEY") or None

DATA = Path(env("VISION_DATA_DIR", str(ROOT / "data")))
UPLOADS = DATA / "uploads"
RUNS = DATA / "runs"
OUTBOX = DATA / "outbox.jsonl"
# Folders whose videos can be picked in the portal ("select video file"); ';'-separated. Uploads are always included.
VIDEO_DIRS = [Path(p.strip()) for p in env("VIDEO_DIRS", "").split(";") if p.strip()] + [UPLOADS]
VIDEO_EXTS = {".mp4", ".avi", ".mkv", ".mov", ".m4v", ".ts"}
MAX_UPLOAD_GB = float(env("MAX_UPLOAD_GB", "8"))

VEHICLE_MODEL = Path(env("VEHICLE_MODEL", str(MODELS / "bd_vehicles_best.pt")))
PLATE_MODEL = Path(env("PLATE_MODEL", str(MODELS / "plate_models" / "LPD_Model.pt")))
OCR_MODEL = Path(env("OCR_MODEL", str(MODELS / "plate_models" / "bd_plate_ocr_v2_best.pt")))
OCR_IMGSZ = int(env("OCR_IMGSZ", "320"))   # our plate character models (v1/v2) were trained at 320
# V6: helmet / no-helmet classifier (from CSE499B-Implimentation/models); V6 is off when the file is missing.
HELMET_MODEL = Path(env("HELMET_MODEL", str(MODELS / "helmet_cls.pt")))

# Camera clocks and file-name time stamps are local time: Dhaka, UTC+6 (no daylight saving).
LOCAL_TZ = timezone(timedelta(hours=float(env("LOCAL_UTC_OFFSET_HOURS", "6"))))

if str(PIPELINES) not in sys.path:
    sys.path.insert(0, str(PIPELINES))
