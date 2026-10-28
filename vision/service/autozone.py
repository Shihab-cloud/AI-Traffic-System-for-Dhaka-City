"""Automatic zones for the portal: watch a video or camera for a few minutes and propose its zones with CSE499B's
pipelines/surveillance/autozone.py (vanishing point from vehicle paths, camera calibrated from vehicle sizes,
carriageways / directions / kerbs / junctions / bus stops / signal queues / U-turns from behaviour).

Adapted from CSE499B's surveillance/autozone_job.py (his dashboard saves the proposal itself; here it is only
returned, and the portal's zone editor loads it as a draft that a person checks, edits and saves). One job at a time.
"""

import json
import threading
import time
import traceback

import torch

from .calibration import observe
from .runner import MIN_FREE_MB, OUT_OF_MEMORY, free_memory_mb, resolve_source

TARGET_MOVING = 300       # moving road users: enough for a stable layout and calibration
MIN_SECONDS = 90.0        # observe at least this long (signals, buses at stops, side-road traffic)
MAX_SECONDS_FILE = 420.0  # recorded video: at most this much of it
MAX_SECONDS_LIVE = 900.0  # live camera: give up after 15 minutes of too little traffic


def _plain(x):
    """numpy numbers -> JSON-safe Python values."""
    return json.loads(json.dumps(x, default=float))


class AutoZoneJob(threading.Thread):
    def __init__(self, source_kind, source_value, camera_id=None):
        super().__init__(daemon=True, name="autozone")
        src, label, live = resolve_source(source_kind, source_value)   # raises SourceError for a bad choice
        self.src, self.live, self.camera_id = src, live, camera_id
        self.stop_event = threading.Event()
        self.status = {"state": "starting", "cameraId": camera_id, "source": {"kind": source_kind, "label": label},
                       "message": "Opening the video...", "progress": 0.0, "seconds": 0.0, "movingVehicles": 0,
                       "startedAt": time.time(), "result": None}

    def stop(self):
        self.stop_event.set()

    @property
    def running(self):
        return self.status["state"] in ("starting", "observing", "analysing")

    def _set(self, **kw):
        self.status.update(kw)

    def run(self):
        from surveillance.autozone import propose

        try:
            free = free_memory_mb()
            if free < MIN_FREE_MB:
                raise ValueError(f"Not enough free memory ({free / 1024:.1f} GB left, it needs "
                                 f"{MIN_FREE_MB / 1024:.0f} GB). Close Chrome tabs or stop a box, then try again.")

            def progress(elapsed, moving, share):
                self._set(state="observing", seconds=round(elapsed), movingVehicles=moving, progress=round(share, 3),
                          message=f"Watching traffic: {moving} moving vehicles in {elapsed:.0f} s")

            self._set(state="observing", message="Watching traffic to learn the road layout...")
            got = observe(self.src, self.live, self.stop_event.is_set, progress, TARGET_MOVING, MIN_SECONDS,
                          MAX_SECONDS_FILE, MAX_SECONDS_LIVE, status=lambda m: self._set(message=m))
            if got is None:
                self._set(state="cancelled", message="Cancelled")
                return
            obs, ref_t, skipped = got
            self._set(state="analysing", progress=1.0, message="Calibrating the camera and working out the zones...")
            cfg, report = propose(obs, log=lambda m: self._set(message=m))
            if skipped:
                report["notes"].append(f"The camera view changed too much to use {skipped} frame(s)")
            cfg["auto"]["reference_t"] = None if self.live else round(ref_t, 2)   # the editor shows this frame
            # the model's pixels: road zones drawn later without a size are measured with it (calibration.py)
            cfg["auto"]["camera"]["frame_size"] = [obs.W, obs.H]
            self._set(state="done", message="Zones proposed: check them, fix anything wrong, then save",
                      result=_plain({"config": cfg, "report": report}))
        except (MemoryError, torch.cuda.OutOfMemoryError):
            self._set(state="error", message=OUT_OF_MEMORY)
        except Exception as e:
            if not isinstance(e, ValueError):
                traceback.print_exc()
            self._set(state="error", message=str(e) or f"Automatic zones failed ({type(e).__name__})")
        finally:
            self._set(endedAt=time.time())
