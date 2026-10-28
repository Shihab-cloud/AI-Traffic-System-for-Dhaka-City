"""Appearance vectors for multi-camera tracking: what a vehicle looks like, comparable between cameras.

Two parts per vehicle, each averaged over its largest views (the backend compares them, apps/backend/src/modules/
traffic/vehicle-matching.ts):
  - embedding: DINOv2-small (Apache-2.0, a general image model, no training on our cameras) - the [CLS] token and the
    mean of the patch tokens, each L2-normalised, joined and normalised again (768 numbers);
  - colour: an HSV histogram of the middle of the vehicle (less road and neighbours): 12 hues x 2 saturations x
    2 brightnesses for coloured pixels, 4 grey levels for the rest (52 numbers, L1-normalised). DINOv2 is trained to
    ignore colour, and colour is what tells most vehicles of one class apart.
A trained vehicle ReID model would separate lookalikes better (Multi Camera Tracking + REID.ipynb trains one on
CityFlow, US cars); DINOv2 also works for CNGs, rickshaws and buses. REID_MODEL overrides the model.
"""

import threading

import cv2
import numpy as np
import torch

from . import config

MODEL = config.env("REID_MODEL", "facebook/dinov2-small")
SIZE = 224
MEAN = np.array([0.485, 0.456, 0.406], np.float32)
STD = np.array([0.229, 0.224, 0.225], np.float32)
HUES, GREYS = 12, 4


def colour_histogram(bgr):
    """52-bin colour histogram of the middle of a vehicle crop (L1-normalised), or None for an empty crop."""
    h, w = bgr.shape[:2]
    core = bgr[int(h * 0.15):int(h * 0.85), int(w * 0.2):int(w * 0.8)]
    if core.size == 0:
        return None
    hsv = cv2.cvtColor(core, cv2.COLOR_BGR2HSV).reshape(-1, 3).astype(np.int32)
    hue, sat, val = hsv[:, 0], hsv[:, 1], hsv[:, 2]
    coloured = (sat >= 50) & (val >= 40)
    hist = np.zeros(HUES * 4 + GREYS, np.float32)
    idx = (hue[coloured] * HUES // 180) * 4 + (sat[coloured] >= 140) * 2 + (val[coloured] >= 150)
    np.add.at(hist, idx, 1)
    grey = np.minimum(val[~coloured] * GREYS // 256, GREYS - 1)
    np.add.at(hist, HUES * 4 + grey, 1)
    total = hist.sum()
    return hist / total if total else None


class AppearanceEncoder:
    """DINOv2 on the GPU (half precision) or CPU, loaded on first use; one batch at a time."""

    def __init__(self, model=MODEL):
        self.name = model
        self.lock = threading.Lock()
        self._model = None
        self._failed = None
        self.device = "cuda" if torch.cuda.is_available() else "cpu"

    def _load(self):
        if self._model is None and self._failed is None:
            try:
                from transformers import AutoModel
                m = AutoModel.from_pretrained(self.name)
                m = m.to(self.device).eval()
                self._model = m.half() if self.device == "cuda" else m
                print(f"[reid] {self.name} loaded on {self.device}")
            except Exception as e:  # no download, no memory: vehicles are matched by plate and place only
                self._failed = f"{type(e).__name__}: {e}"
                print(f"[reid] appearance vectors off: {self._failed}")
        return self._model

    def features(self, crops):
        """BGR crops of one vehicle -> (embedding or None, colour histogram or None), both float32 lists."""
        crops = [c for c in crops if c is not None and c.size and min(c.shape[:2]) >= 8]
        if not crops:
            return None, None
        hists = [h for h in (colour_histogram(c) for c in crops) if h is not None]
        colour = (np.mean(hists, axis=0) / max(np.mean(hists, axis=0).sum(), 1e-9)).astype(np.float32) if hists else None
        with self.lock:
            model = self._load()
            if model is None:
                return None, colour
            batch = np.stack([
                (cv2.cvtColor(cv2.resize(c, (SIZE, SIZE), interpolation=cv2.INTER_AREA), cv2.COLOR_BGR2RGB)
                 .astype(np.float32) / 255 - MEAN) / STD for c in crops])
            x = torch.from_numpy(batch.transpose(0, 3, 1, 2)).to(self.device)
            if self.device == "cuda":
                x = x.half()
            with torch.inference_mode():
                hidden = model(pixel_values=x).last_hidden_state.float()
        cls = torch.nn.functional.normalize(hidden[:, 0], dim=1)
        patches = torch.nn.functional.normalize(hidden[:, 1:].mean(dim=1), dim=1)
        vec = torch.nn.functional.normalize(torch.cat([cls, patches], dim=1).mean(dim=0), dim=0)
        return vec.cpu().numpy().astype(np.float32), colour


_encoder = None


def encoder():
    """The service's one encoder (shared by every run)."""
    global _encoder
    if _encoder is None:
        _encoder = AppearanceEncoder()
    return _encoder
