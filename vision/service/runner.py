"""Run slots: each surveillance box in the portal ("speed", "violations") runs one pipeline script in a thread of this
process. Both read the plates of their violators (service/plates.py); the plate box that ran plate_reader.py on every
vehicle was merged into the speed box on 2026-10-28.

One process on purpose: one CUDA context and one copy of the plate models for both boxes (the laptop has 4 GB of VRAM
and 8 GB of RAM). A run is one start..stop: the script's main() is called with an argument list, exactly as on the
command line, and a `Hooks` object that receives what it finds.
"""

import ctypes
import gc
import importlib
import json
import re
import sys
import threading
import time
import traceback
import uuid
from collections import Counter, deque
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from urllib.parse import urlsplit, urlunsplit

import torch

from . import calibration, config, display
from .hooks import Hooks

SLOTS = {
    "speed": {"module": "speed_tracker", "title": "Speed, over-speed and plates"},
    "violations": {"module": "violation_tracker", "title": "Other violations"},
}
# V2 (speed) is the speed box's job; V6 (helmet) runs when the helmet model is installed (config.HELMET_MODEL).
DEFAULT_RULES = ["V1", "V3", "V4", "V5", "V6", "V7", "V8"]
LIVE_SCHEMES = ("rtsp://", "rtsps://", "rtmp://", "http://", "https://")


class SourceError(ValueError):
    pass


# A run needs this much more memory once it starts (decoded frames up to 4K, model work buffers, CUDA allocations).
MIN_FREE_MB = 2048
OUT_OF_MEMORY = ("Out of memory: close Chrome tabs or other programs, or stop another box, then start again "
                 "(8 GB laptop)")


class _MemoryStatus(ctypes.Structure):
    _fields_ = [("dwLength", ctypes.c_ulong), ("dwMemoryLoad", ctypes.c_ulong),
                ("ullTotalPhys", ctypes.c_ulonglong), ("ullAvailPhys", ctypes.c_ulonglong),
                ("ullTotalPageFile", ctypes.c_ulonglong), ("ullAvailPageFile", ctypes.c_ulonglong),
                ("ullTotalVirtual", ctypes.c_ulonglong), ("ullAvailVirtual", ctypes.c_ulonglong),
                ("ullAvailExtendedVirtual", ctypes.c_ulonglong)]


def free_memory_mb():
    """Memory a new allocation can still get, in MB. On Windows that is the commit headroom (RAM + page file): it runs
    out first on this laptop, and GPU allocations count against it too (a full commit shows up as a CUDA out-of-memory
    error with GPU memory free). Elsewhere: available RAM."""
    if sys.platform == "win32":
        status = _MemoryStatus()
        status.dwLength = ctypes.sizeof(status)
        if ctypes.windll.kernel32.GlobalMemoryStatusEx(ctypes.byref(status)):
            return status.ullAvailPageFile // 2**20
    import psutil
    return psutil.virtual_memory().available // 2**20


def resolve_source(kind, value):
    """(argument for the script, label safe to show/store, live?) for a portal source choice."""
    value = (value or "").strip()
    if kind == "ip":
        if not value.lower().startswith(LIVE_SCHEMES):
            raise SourceError("Camera address must start with rtsp://, http:// or https://")
        parts = urlsplit(value)
        label = urlunsplit(parts._replace(netloc=parts.hostname + (f":{parts.port}" if parts.port else ""))) \
            if parts.hostname else value
        return value, label, True
    if kind == "webcam":
        if not value.isdigit():
            raise SourceError("Webcam must be a device number, e.g. 0")
        return value, f"webcam {value}", True
    if kind == "upload":
        path = config.UPLOADS / Path(value).name
    elif kind == "file":
        path = Path(value)
    else:
        raise SourceError(f"Unknown source kind '{kind}'")
    path = path.resolve()
    if not any(path.is_relative_to(d.resolve()) for d in config.VIDEO_DIRS):
        raise SourceError("That file is not in one of the video folders")
    if path.suffix.lower() not in config.VIDEO_EXTS or not path.is_file():
        raise SourceError(f"Video not found: {path.name}")
    return str(path), path.name, False


def list_videos():
    out = []
    for d in config.VIDEO_DIRS:
        if not d.is_dir():
            continue
        for p in sorted(d.iterdir()):  # top level only: the folders may hold whole projects
            if p.is_file() and p.suffix.lower() in config.VIDEO_EXTS:
                st = p.stat()
                out.append({"name": p.name, "path": str(p), "folder": str(d), "sizeMb": round(st.st_size / 2**20, 1),
                            "modified": datetime.fromtimestamp(st.st_mtime).isoformat(timespec="seconds"),
                            "kind": "upload" if d == config.UPLOADS else "file"})
    return out


@dataclass
class Run:
    slot: str
    source_kind: str
    source_value: str      # what the script opens (may contain camera credentials: never returned)
    source_label: str
    live: bool
    camera: dict
    clock0: datetime | None
    dir: Path
    run_id: str = field(default_factory=lambda: uuid.uuid4().hex[:12])
    state: str = "starting"      # starting, running, finished, stopped, error
    error: str = ""
    started_at: float = field(default_factory=time.time)
    ended_at: float | None = None
    progress: dict = field(default_factory=dict)
    stats: Counter = field(default_factory=Counter)
    learning: dict | None = None     # violations box: observed traffic direction per road zone
    unsized: dict | None = None      # violations box: zones whose road zones are sized from the video first
    notes: list = field(default_factory=list)   # printed to the run's log when it starts

    def public(self):
        return {"runId": self.run_id, "slot": self.slot, "state": self.state, "error": self.error,
                "source": {"kind": self.source_kind, "label": self.source_label, "live": self.live},
                "camera": self.camera, "startedAt": self.started_at, "endedAt": self.ended_at,
                "progress": self.progress, "stats": dict(self.stats)}


def road_zones_only(zones):
    """speed_tracker reads measured road zones only: areas and lane lines are for the violation rules, a road zone
    sized by Auto zones (scale_source "auto", sizes from vehicle sizes) is too rough for speed, and one drawn for the
    other violations may have no size at all."""
    roads = [z for z in zones.get("zones", []) if z.get("type", "road") == "road"
             and z.get("scale_source", "measured") != "auto" and calibration.has_size(z)]
    return {"frame_size": zones.get("frame_size"), "zones": roads}


class Slot:
    def __init__(self, name, sender, plate_models, clips=None):
        self.name, self.sender, self.plate_models, self.clips = name, sender, plate_models, clips
        self.channel = display.Channel(name)
        self.run: Run | None = None
        self.history = deque(maxlen=10)
        self.thread: threading.Thread | None = None
        self.lock = threading.Lock()

    @property
    def busy(self):
        return self.thread is not None and self.thread.is_alive()

    def status(self):
        return {"slot": self.name, "title": SLOTS[self.name]["title"], "busy": self.busy,
                "run": self.run.public() if self.run else None, "status": self.channel.status,
                "log": self.channel.tail(40), "viewers": self.channel.viewers,
                "frameSize": self.channel.size, "history": [r.public() for r in self.history]}

    def start(self, source_kind, source_value, camera=None, zones=None, speed_limit=60.0, options=None):
        options = options or {}
        with self.lock:
            if self.busy:
                raise RuntimeError(f"The {self.name} box is already running: stop it first")
            free = free_memory_mb()
            if free < MIN_FREE_MB:  # it would fail a few frames in with an allocation error
                raise ValueError(f"Not enough free memory to start ({free / 1024:.1f} GB left, a run needs "
                                 f"{MIN_FREE_MB / 1024:.0f} GB). Close Chrome tabs or other programs, or stop another "
                                 "box, then start again.")
            src, label, live = resolve_source(source_kind, source_value)
            clock0 = None
            if options.get("startTime"):
                clock0 = datetime.fromisoformat(str(options["startTime"]).replace("Z", "")).replace(tzinfo=None)
            elif live:
                clock0 = datetime.now(config.LOCAL_TZ).replace(tzinfo=None)
            else:
                from plate_reader import video_start_time
                clock0 = video_start_time(src, None)
            run = Run(self.name, source_kind, src, label, live, dict(camera or {}), clock0, Path())
            run.dir = config.RUNS / self.name / f"{datetime.now():%Y%m%d_%H%M%S}_{run.run_id}"
            run.dir.mkdir(parents=True, exist_ok=True)
            argv = self._args(run, zones, float(speed_limit or 60), options)
            (run.dir / "args.json").write_text(json.dumps({"argv": [a if a != src else label for a in argv],
                                                           "camera": run.camera}, indent=2))
            self.channel.reset()
            if self.run is not None:
                self.history.appendleft(self.run)
            self.run = run
            self.thread = threading.Thread(target=self._main, args=(run, argv), daemon=True, name=f"run-{self.name}")
            self.thread.start()
            return run

    def stop(self):
        self.channel.stop_requested = True   # the script's next cv2.waitKey returns "q"

    def _args(self, run, zones, speed_limit, o):
        model = ["--model", str(config.VEHICLE_MODEL)]
        common = ["--source", run.source_value] + model
        if not zones or not any(z.get("type", "road") == "road" for z in zones.get("zones", [])):
            raise ValueError("This camera has no road zones: draw them in Admin > Cameras first")
        if self.name == "speed":
            roads = road_zones_only(zones)
            if not roads["zones"]:
                raise ValueError("This camera has no measured road zones: open Define zones and type each road "
                                 "zone's measured width and length (automatic zones are not used for speed)")
            path = run.dir / "speed_zones.json"
            path.write_text(json.dumps(roads, indent=2))
            argv = common + ["--zones", str(path), "--csv", str(run.dir / "speeds.csv"),
                             "--speed-limit", f"{speed_limit:g}", "--imgsz", str(int(o.get("imgsz") or 640)),
                             "--tracker", o.get("tracker") or "bytetrack"]
            if o.get("sustainSec"):
                argv += ["--sustain-sec", str(float(o["sustainSec"]))]
            return argv
        # violations
        path = run.dir / "camera_zones.json"
        if calibration.unsized(zones):   # road zones drawn without a size: estimate it (calibration.py)
            zones = json.loads(json.dumps(zones))   # sizes are for this run's file only
            model = calibration.saved_model(zones, run.camera.get("id"))
            if model:
                self._fill_sizes(run, zones, model)
            else:
                run.unsized = zones   # sized from the run's own video before the script starts (_main)
        path.write_text(json.dumps(zones, indent=2))
        rules = DEFAULT_RULES   # always every rule of this box; a rule without its zones switches itself off
        helmet = ["--helmet-model", str(config.HELMET_MODEL)] if config.HELMET_MODEL.exists() else ["--no-helmet"]
        argv = common + ["--zones", str(path), "--out", str(run.dir), "--only", *rules, *helmet,
                         "--backend", "pytorch"]
        if o.get("imgsz"):
            argv += ["--imgsz", str(int(o["imgsz"]))]
        if run.clock0 is not None and not run.live:
            argv += ["--start-time", run.clock0.isoformat(sep=" ", timespec="seconds")]
        return argv

    def _fill_sizes(self, run, zones, model):
        names = [z["name"] for z in calibration.unsized(zones)]
        failed = calibration.fill_sizes(zones, model)
        if failed:
            raise ValueError(f"Could not estimate the size of road zone {', '.join(failed)} (a corner at or above the "
                             "horizon, or not a rectangle on the road): type its width and length in Define zones")
        sized = {z["name"]: z for z in zones["zones"]}
        run.notes.append(f"Road zone sizes estimated from {model['from']} (about +-{model.get('speed_uncertainty_pct')}%): "
                         + ", ".join(f"{n} {sized[n]['width_m']:g} x {sized[n]['length_m']:g} m" for n in names))

    def _calibrate(self, run):
        """Other-violations box, road zones without a size and no camera model yet: calibrate the camera on about a
        minute of this video (as Auto zones does), remember the model for this camera, then size the zones."""
        zones = run.unsized
        names = ", ".join(z["name"] for z in calibration.unsized(zones))
        print(f"Road zones without a size: {names}. Estimating it from vehicle sizes: watching the traffic first...")

        def progress(elapsed, moving, share):
            print(f"\rCalibrating the camera: {moving} moving vehicles in {elapsed:.0f} s", end="", flush=True)

        got = calibration.observe(run.source_value, run.live, lambda: self.channel.stop_requested, progress,
                                  calibration.CAL_MOVING, calibration.CAL_MIN_S, calibration.CAL_MAX_S_FILE,
                                  calibration.CAL_MAX_S_LIVE)
        print()
        if got is None:
            raise SystemExit(0)   # stopped
        try:
            model = calibration.camera_model(got[0])
        except ValueError as e:
            raise SystemExit(f"Could not estimate the size of {names} from this video ({e}): type the width and "
                             "length in Define zones, or run Auto zones on this camera")
        calibration.remember(run.camera.get("id"), model, run.source_label)
        try:
            self._fill_sizes(run, zones, {**model, "from": "this video's traffic"})
        except ValueError as e:
            raise SystemExit(str(e))
        (run.dir / "camera_zones.json").write_text(json.dumps(zones, indent=2))

    def _run_event(self, run):
        self.sender.post({"type": "run", "slot": run.slot, "runId": run.run_id, "cameraId": run.camera.get("id"),
                          "cameraName": run.camera.get("name"), "state": run.state, "error": run.error,
                          "source": {"kind": run.source_kind, "value": run.source_label, "live": run.live},
                          "startedAt": run.started_at, "endedAt": run.ended_at, "stats": dict(run.stats),
                          "learning": run.learning,
                          "progress": {k: v for k, v in run.progress.items() if k != "updatedAt"}})

    def _main(self, run, argv):
        display.bind(self.channel)
        try:
            module = importlib.import_module(SLOTS[self.name]["module"])
            run.state = "running"
            self._run_event(run)
            print(f"{SLOTS[self.name]['title']}: {run.source_label}")
            if run.unsized is not None:
                self._calibrate(run)
            for note in run.notes:
                print(note)
            module.main(argv, Hooks(run, self.sender, self.plate_models, self.clips))
            run.state = "stopped" if self.channel.stop_requested else "finished"
        except SystemExit as e:
            if e.code in (None, 0):
                run.state = "stopped" if self.channel.stop_requested else "finished"
            else:
                run.state, run.error = "error", str(e.code)
                print(f"ERROR: {e.code}")
        except (MemoryError, torch.cuda.OutOfMemoryError) as e:
            run.state, run.error = "error", f"{OUT_OF_MEMORY}. ({e.__class__.__name__})"
            traceback.print_exc()
        except Exception as e:
            run.state, run.error = "error", f"{e.__class__.__name__}: {e}"
            traceback.print_exc()
        finally:
            run.ended_at = time.time()
            print(f"Run {run.state}" + (f": {run.error}" if run.error else ""))
            self._run_event(run)
            display.bind(None)
            gc.collect()
            if torch.cuda.is_available():
                torch.cuda.empty_cache()


_SAFE = re.compile(r"[^A-Za-z0-9._ -]+")


def upload_name(name):
    """A safe, unique file name for an upload, keeping the original name (it may carry the recording time)."""
    stem, suffix = Path(name or "video.mp4").stem, Path(name or "video.mp4").suffix.lower()
    if suffix not in config.VIDEO_EXTS:
        raise SourceError(f"Not a video file type: {suffix or '(none)'}")
    stem = _SAFE.sub("_", stem).strip(" .") or "video"
    return f"{stem[:80]}_{uuid.uuid4().hex[:6]}{suffix}"
