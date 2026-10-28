"""Video sources.

FileSource  - a recorded video. Every frame (at the analysis rate) is processed, nothing is dropped, so the result
              is complete. Decoded by ffmpeg with Apple VideoToolbox hardware decoding and downscaled in ffmpeg.
              Optionally paced to real time to behave exactly like a live camera (for demos).
LiveSource  - a phone / IP / USB camera. A background thread keeps only the newest frame, so processing never
              falls behind the camera; frames are dropped instead and the rules (which work on timestamps) are
              unaffected. Reconnects automatically when the stream drops.

Phone cameras:
    iPhone   Continuity Camera shows up as a camera device on the Mac: source "0", "1", ...
    Android  "IP Webcam" app:  http://PHONE_IP:8080/video      "DroidCam": http://PHONE_IP:4747/video
    Any RTSP app / CCTV:       rtsp://user:pass@IP:554/...
"""

import re
import subprocess
import sys
import threading
import time
from datetime import datetime, timezone
from pathlib import Path

import cv2
import numpy as np

try:
    import imageio_ffmpeg
    FFMPEG = imageio_ffmpeg.get_ffmpeg_exe()
except Exception:  # pragma: no cover - ffmpeg is optional; OpenCV decoding is the fallback
    FFMPEG = None


def is_live_source(source):
    s = str(source).strip()
    return s.isdigit() or "://" in s


def even(n):
    return int(n) // 2 * 2


def output_size(w, h, max_width):
    """Frame size after downscaling to at most `max_width` (0 = native), kept even for video encoders."""
    if max_width and w > max_width:
        return even(max_width), even(round(h * max_width / w))
    return even(w), even(h)


# ---------------------------------------------------------------- recording start time

_NAME_PATTERNS = [
    # VID_20260922_173600, PXL_20260922_173600123, ch01_20260922173600, 2026-09-22 17.36.00, 2026_09_22-17_36_00
    re.compile(r"(20\d{2})[-_.]?([01]\d)[-_.]?([0-3]\d)[ _T-]?([0-2]\d)[-_.:]?([0-5]\d)[-_.:]?([0-5]\d)"),
]


def probe_video(path):
    """Metadata from ffmpeg: {"creation": datetime | None, "creation_source": str, "duration": s}."""
    info = {"creation": None, "creation_source": "", "duration": None}
    if not FFMPEG:
        return info
    try:
        out = subprocess.run([FFMPEG, "-hide_banner", "-i", str(path)], capture_output=True, text=True,
                             timeout=20).stderr
    except Exception:
        return info
    m = re.search(r"Duration:\s*(\d+):(\d+):([\d.]+)", out)
    if m:
        info["duration"] = int(m[1]) * 3600 + int(m[2]) * 60 + float(m[3])
    m = re.search(r"com\.apple\.quicktime\.creationdate\s*:\s*(\S+)", out)  # iPhone: local time with offset
    if m:
        try:
            info["creation"] = datetime.fromisoformat(m[1]).astimezone().replace(tzinfo=None)
            info["creation_source"] = "iPhone recording date"
            return info
        except ValueError:
            pass
    m = re.search(r"creation_time\s*:\s*(\S+)", out)  # UTC
    if m:
        try:
            utc = datetime.fromisoformat(m[1].replace("Z", "+00:00"))
            if utc.tzinfo is None:
                utc = utc.replace(tzinfo=timezone.utc)
            info["creation"] = utc.astimezone().replace(tzinfo=None)
            info["creation_source"] = "file metadata (changes when a file is trimmed or copied)"
        except ValueError:
            pass
    return info


def detect_start_time(path):
    """Best guess of when a recording started: (datetime | None, how it was found)."""
    for pat in _NAME_PATTERNS:
        m = pat.search(Path(path).stem)
        if m:
            try:
                return datetime(*map(int, m.groups())), "file name"
            except ValueError:
                pass
    info = probe_video(path)
    return info["creation"], info["creation_source"]


# ---------------------------------------------------------------- sources

class FileSource:
    is_live = False

    def __init__(self, path, analysis_fps=30.0, max_width=1920, realtime=False, start_sec=0.0):
        self.path = str(path)
        cap = cv2.VideoCapture(self.path)
        if not cap.isOpened():
            raise IOError(f"Could not open video: {path}")
        self.native_fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
        n = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
        ok, first = cap.read()  # OpenCV applies the rotation flag, so this is the displayed size
        cap.release()
        if not ok:
            raise IOError(f"Could not read a frame from: {path}")
        h0, w0 = first.shape[:2]
        self.duration = n / self.native_fps if n > 0 else (probe_video(path)["duration"] or 0)
        self.fps = min(analysis_fps or self.native_fps, self.native_fps)
        self.width, self.height = output_size(w0, h0, max_width)
        self.realtime, self.start_sec = realtime, start_sec
        self.total = int(max(0, self.duration - start_sec) * self.fps) or None
        self.index = 0
        self.proc = None
        self.cap = None
        self.t_wall0 = None

    def open(self):
        if FFMPEG:
            cmd = [FFMPEG, "-hide_banner", "-loglevel", "error"]
            if sys.platform == "darwin":  # [web] VideoToolbox exists only on macOS
                cmd += ["-hwaccel", "videotoolbox"]
            if self.start_sec:
                cmd += ["-ss", str(self.start_sec)]
            cmd += ["-i", self.path, "-an", "-vf", f"fps={self.fps},scale={self.width}:{self.height}",
                    "-f", "rawvideo", "-pix_fmt", "bgr24", "-"]
            self.proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
                                         bufsize=self.width * self.height * 3 * 4)
        else:
            self.cap = cv2.VideoCapture(self.path)
            self.cap.set(cv2.CAP_PROP_POS_MSEC, self.start_sec * 1000)
            self.stride = max(1, round(self.native_fps / self.fps))
            self.fps = self.native_fps / self.stride
        return self

    def read(self):
        """(frame, t_seconds) or None at the end."""
        if self.proc:
            size = self.width * self.height * 3
            buf = self.proc.stdout.read(size)
            if len(buf) < size:
                return None
            frame = np.frombuffer(buf, np.uint8).reshape(self.height, self.width, 3)
        else:
            for _ in range(self.stride - 1):
                if not self.cap.grab():
                    return None
            ok, frame = self.cap.read()
            if not ok:
                return None
            if frame.shape[1] != self.width:
                frame = cv2.resize(frame, (self.width, self.height), interpolation=cv2.INTER_AREA)
        t = self.start_sec + self.index / self.fps
        self.index += 1
        if self.realtime:  # behave like a live camera: never run ahead of the clock
            if self.t_wall0 is None:
                self.t_wall0 = time.monotonic() - (t - self.start_sec)
            delay = self.t_wall0 + (t - self.start_sec) - time.monotonic()
            if delay > 0:
                time.sleep(delay)
        return frame, t

    def progress(self):
        return min(1.0, self.index / self.total) if self.total else None

    def lag(self):
        if not self.realtime or self.t_wall0 is None:
            return 0.0
        return max(0.0, time.monotonic() - self.t_wall0 - self.index / self.fps)

    def close(self):
        if self.proc:
            self.proc.kill()
            self.proc.wait()
            self.proc = None
        if self.cap:
            self.cap.release()
            self.cap = None


class LiveSource:
    is_live = True

    def __init__(self, source, max_width=1920, reconnect_sec=2.0):
        self.source = str(source).strip()
        self.max_width, self.reconnect_sec = max_width, reconnect_sec
        self.fps = 30.0  # updated from the camera once connected
        self.width = self.height = None
        self.total, self.duration = None, None
        self.state = "connecting"   # connecting / online / offline
        self.error = ""
        self.frames_received = 0
        self.reconnects = 0
        self._latest = None         # (frame, t, wall datetime)
        self._seq = 0
        self._read_seq = 0
        self._cond = threading.Condition()
        self._stop = threading.Event()
        self._thread = None
        self.t0 = None

    def _open_capture(self):
        if self.source.isdigit():
            cap = cv2.VideoCapture(int(self.source), cv2.CAP_AVFOUNDATION)
        else:
            # Fail fast on a dead phone / network stream (the default is to hang for 30 s) so we reconnect quickly.
            cap = cv2.VideoCapture(self.source, cv2.CAP_FFMPEG, [cv2.CAP_PROP_OPEN_TIMEOUT_MSEC, 5000,
                                                                 cv2.CAP_PROP_READ_TIMEOUT_MSEC, 5000])
        cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)
        return cap

    def _run(self):
        while not self._stop.is_set():
            cap = self._open_capture()
            if not cap.isOpened():
                self.state, self.error = "offline", f"cannot open {self.source}"
                cap.release()
                self._stop.wait(self.reconnect_sec)
                self.reconnects += 1
                continue
            fps = cap.get(cv2.CAP_PROP_FPS)
            if fps and 1 <= fps <= 120:
                self.fps = fps
            failures = 0
            while not self._stop.is_set():
                ok, frame = cap.read()
                if not ok or frame is None:
                    failures += 1
                    if failures > 30:
                        break
                    time.sleep(0.02)
                    continue
                failures = 0
                now = time.monotonic()
                if self.t0 is None:
                    self.t0 = now
                h, w = frame.shape[:2]
                ow, oh = output_size(w, h, self.max_width)
                if (ow, oh) != (w, h):
                    frame = cv2.resize(frame, (ow, oh), interpolation=cv2.INTER_AREA)
                with self._cond:
                    self.width, self.height = ow, oh
                    self._latest = (frame, now - self.t0, datetime.now())
                    self._seq += 1
                    self.frames_received += 1
                    self.state, self.error = "online", ""
                    self._cond.notify_all()
            cap.release()
            if not self._stop.is_set():
                self.state, self.error = "offline", "stream interrupted - reconnecting"
                self.reconnects += 1
                self._stop.wait(self.reconnect_sec)

    def open(self, timeout=15.0):
        self._thread = threading.Thread(target=self._run, daemon=True, name=f"live:{self.source}")
        self._thread.start()
        with self._cond:
            self._cond.wait_for(lambda: self._latest is not None or self._stop.is_set(), timeout)
        if self._latest is None:
            self.close()
            raise IOError(f"No frames from {self.source} within {timeout:.0f}s ({self.error or 'no signal'})")
        return self

    def read(self, timeout=None):
        """Newest frame not yet returned: (frame, t_seconds, wall datetime). Waits for the camera while it
        reconnects; returns None only when closed."""
        with self._cond:
            while not self._stop.is_set():
                if self._seq != self._read_seq and self._latest is not None:
                    self._read_seq = self._seq
                    return self._latest
                self._cond.wait(timeout or 0.5)
                if timeout:
                    return None
        return None

    def lag(self):
        """Seconds between the newest captured frame and now (grows when the camera stalls)."""
        if self._latest is None or self.t0 is None:
            return 0.0
        return max(0.0, time.monotonic() - self.t0 - self._latest[1])

    def progress(self):
        return None

    def close(self):
        self._stop.set()
        with self._cond:
            self._cond.notify_all()
        if self._thread:
            self._thread.join(timeout=5)


def grab_frame(source, at_sec=0.0, max_width=1920):
    """One frame for the zone editor / connection test (BGR, downscaled like the pipeline does)."""
    if is_live_source(source):
        src = LiveSource(source, max_width).open(timeout=10)
        try:
            frame = src.read()[0]
            return frame.copy()
        finally:
            src.close()
    cap = cv2.VideoCapture(str(source))
    if not cap.isOpened():
        raise IOError(f"Could not open {source}")
    cap.set(cv2.CAP_PROP_POS_MSEC, at_sec * 1000)
    ok, frame = cap.read()
    cap.release()
    if not ok:
        raise IOError(f"Could not read a frame at {at_sec}s from {source}")
    w, h = output_size(frame.shape[1], frame.shape[0], max_width)
    return cv2.resize(frame, (w, h), interpolation=cv2.INTER_AREA) if w != frame.shape[1] else frame


def probe_mac_cameras(max_index=4):
    """Camera devices the Mac can open (built-in, iPhone Continuity Camera, USB)."""
    found = []
    for i in range(max_index):
        cap = cv2.VideoCapture(i, cv2.CAP_AVFOUNDATION)
        if cap.isOpened():
            ok, frame = cap.read()
            if ok:
                found.append({"index": i, "width": frame.shape[1], "height": frame.shape[0]})
        cap.release()
    return found
