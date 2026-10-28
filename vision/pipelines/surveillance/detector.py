"""YOLO detection + multi-object tracking, using the fastest backend this Mac has.

On Apple Silicon the PyTorch checkpoint is exported once to CoreML (runs on the Neural Engine): on an M5 that is
~90 FPS at 640 px versus ~66 FPS on the GPU (MPS), with the same detections (99.6% of boxes match at IoU 0.7).
The export is cached in models/. If it fails, the GPU (MPS) is used, then the CPU.
"""

import platform
import sys
from pathlib import Path

from ultralytics import YOLO
from ultralytics.cfg import DEFAULT_CFG_DICT

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from vehicle_tracker import build_tracker_cfg, select_classes  # noqa: E402

MODELS_DIR = ROOT / "models"


def pick_device(requested=None):
    import torch
    if requested:
        return requested
    if torch.cuda.is_available():
        return "0"
    if hasattr(torch.backends, "mps") and torch.backends.mps.is_available():
        return "mps"
    return "cpu"


def coreml_model(pt_path, imgsz, log=print):
    """Path of a CoreML export of `pt_path` at `imgsz` (exported on first use), or None if not possible."""
    if platform.system() != "Darwin" or platform.machine() != "arm64":
        return None
    MODELS_DIR.mkdir(exist_ok=True)
    out = MODELS_DIR / f"{Path(pt_path).stem}_{imgsz}.mlpackage"
    if out.exists():
        return out
    try:
        log(f"Exporting {Path(pt_path).name} to CoreML at {imgsz}px (one time, ~15 s)...")
        exported = Path(YOLO(str(pt_path)).export(format="coreml", imgsz=imgsz, nms=False, half=True,
                                                  verbose=False))
        exported.rename(out)
        return out
    except Exception as e:  # coremltools missing or unsupported layer
        log(f"CoreML export failed ({e}); using PyTorch instead.")
        return None


class Detector:
    def __init__(self, model_path="bd_vehicles_best.pt", imgsz=640, backend="auto", device=None,
                 tracker="bytetrack", conf=None, track_buffer_sec=2.0, fps=30.0, reid=False,
                 classes=None, exclude=None, log=print):
        model_path = Path(model_path)
        if not model_path.is_absolute():
            model_path = ROOT / model_path
        self.imgsz = imgsz
        self.kw = {}
        weights = model_path
        self.backend = "pytorch"
        if backend in ("auto", "coreml") and model_path.suffix == ".pt":
            ml = coreml_model(model_path, imgsz, log)
            if ml is not None:
                weights, self.backend = ml, "coreml"
        if model_path.suffix == ".mlpackage":
            self.backend = "coreml"
        if self.backend == "pytorch":
            self.device = pick_device(device)
            self.kw["device"] = self.device
            if self.device not in ("cpu", "mps"):  # [web] Ultralytics 8.4 renamed `half` to `quantize`
                self.kw.update({"quantize": 16} if "quantize" in DEFAULT_CFG_DICT else {"half": True})
        else:
            self.device = "ane"
        self.model = YOLO(str(weights), task="detect")
        self.names = self.model.names
        self.class_ids = select_classes(self.names, classes, exclude)
        self.tracker_cfg = build_tracker_cfg(tracker, conf, fps, track_buffer_sec, reid)
        log(f"Detector: {Path(weights).name} on {self.backend.upper()} ({self.device}), {imgsz}px, "
            f"tracker {tracker}")

    def track(self, image):
        """[(x1, y1, x2, y2), track_id, class_name] for every tracked box in `image`. Box edges keep the model's
        sub-pixel precision: far away one pixel is half a metre of road."""
        r = self.model.track(image, persist=True, tracker=self.tracker_cfg, classes=self.class_ids, conf=0.1,
                             imgsz=self.imgsz, agnostic_nms=True, verbose=False, **self.kw)[0]
        b = r.boxes
        if b.id is None:
            return []
        return [(tuple(round(v, 2) for v in xyxy), tid, self.names[c]) for xyxy, tid, c in
                zip(b.xyxy.tolist(), b.id.int().tolist(), b.cls.int().tolist())]

    def close(self):
        Path(self.tracker_cfg).unlink(missing_ok=True)


class HelmetDetector:
    """Callable for the V6 rule: motorbike crop -> probability that someone on it has no helmet."""

    def __init__(self, model_path, imgsz=224):
        model_path = Path(model_path)
        self.model = YOLO(str(model_path), task="classify")
        self.imgsz = imgsz
        self.bare = next(i for i, n in self.model.names.items() if "no" in n.lower())
        self.kw = {} if model_path.suffix == ".mlpackage" else {"device": pick_device()}

    def __call__(self, crop):
        r = self.model.predict(crop, imgsz=self.imgsz, verbose=False, **self.kw)[0]
        return float(r.probs.data[self.bare])


def find_helmet_model():
    """The installed helmet classifier (CoreML export preferred), or None."""
    for name in ("helmet_cls.mlpackage", "helmet_cls.pt"):
        if (MODELS_DIR / name).exists():
            return MODELS_DIR / name
    return None
