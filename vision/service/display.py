"""The scripts' preview window, as a browser stream, and each run's console output.

The pipeline scripts show their annotated frames with cv2.imshow and quit when cv2.waitKey returns "q". Both are
replaced here by versions that look up the `Channel` of the thread calling them: imshow publishes the frame (JPEG)
to the browsers watching that slot, and waitKey returns "q" once the run has been asked to stop. So the portal shows
exactly what `--no-show` would hide, and the scripts run unchanged. Threads without a channel get the real OpenCV
functions.

print() output of a run thread goes to its channel's log (shown in the portal) and, line by line, to the console.
"""

import io
import sys
import threading
import time
from collections import deque

import cv2

_local = threading.local()
_REAL = {name: getattr(cv2, name) for name in
         ("imshow", "waitKey", "namedWindow", "destroyAllWindows", "destroyWindow", "resizeWindow")}


class Channel:
    """Latest frame and console output of one slot."""

    def __init__(self, name, max_width=1280, quality=75, max_fps=12.0):
        self.name = name
        self.cond = threading.Condition()
        self.jpeg, self.seq, self.size = None, 0, None
        self.viewers = 0
        self.stop_requested = False
        self.log = deque(maxlen=300)
        self.status = ""                 # current "\r" progress line
        self._partial = ""
        self.max_width, self.quality, self.min_dt = max_width, quality, 1.0 / max_fps
        self._last = 0.0

    def reset(self):
        with self.cond:
            self.jpeg, self.size, self.stop_requested = None, None, False
            self.log.clear()
            self.status, self._partial = "", ""
            self.seq += 1
            self.cond.notify_all()

    def publish(self, frame):
        now = time.monotonic()
        # JPEG encoding costs a few ms: without viewers keep only a snapshot a second (for the thumbnail).
        if now - self._last < (self.min_dt if self.viewers else 1.0):
            return
        self._last = now
        h, w = frame.shape[:2]
        if w > self.max_width:
            frame = cv2.resize(frame, (self.max_width, round(h * self.max_width / w)), interpolation=cv2.INTER_AREA)
        ok, buf = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, self.quality])
        if ok:
            with self.cond:
                self.jpeg, self.size = buf.tobytes(), (w, h)
                self.seq += 1
                self.cond.notify_all()

    def wait_frame(self, last_seq, timeout=2.0):
        """(seq, jpeg) of the next frame after `last_seq` (same frame again on timeout, so streams stay alive)."""
        with self.cond:
            self.cond.wait_for(lambda: self.seq != last_seq, timeout)
            return self.seq, self.jpeg

    def write(self, text):
        """Console text; returns the completed lines. A "\\r" line (progress) replaces the previous status."""
        done = []
        lines = (self._partial + text).split("\n")
        for line in lines[:-1]:
            line = line.rsplit("\r", 1)[-1].rstrip()
            if line:
                done.append(line)
                self.log.append(line)
        last = lines[-1]
        if "\r" in last:
            self.status = last.rsplit("\r", 1)[-1].strip()
            self._partial = ""
        else:
            self._partial = last
        return done

    def tail(self, n=80):
        return list(self.log)[-n:]


def current():
    return getattr(_local, "channel", None)


def bind(channel):
    _local.channel = channel


def _imshow(win, frame):
    ch = current()
    if ch is None:
        return _REAL["imshow"](win, frame)
    ch.publish(frame)


def _wait_key(delay=0):
    ch = current()
    if ch is None:
        return _REAL["waitKey"](delay)
    return ord("q") if ch.stop_requested else -1


def _window_call(name):
    real = _REAL[name]

    def call(*a, **k):
        if current() is None:
            return real(*a, **k)
    return call


class _Router(io.TextIOBase):
    """sys.stdout / sys.stderr: run threads write to their channel (and full lines, tagged, to the console)."""

    def __init__(self, real):
        self.real = real

    def write(self, s):
        ch = current()
        if ch is None:
            self._out(s)
        else:
            for line in ch.write(s):
                self._out(f"[{ch.name}] {line}\n")
        return len(s)

    def _out(self, s):
        try:
            self.real.write(s)
        except UnicodeEncodeError:  # Bangla / Chinese text on a cp1252 console
            enc = getattr(self.real, "encoding", None) or "ascii"
            self.real.write(s.encode(enc, "replace").decode(enc))

    def flush(self):
        self.real.flush()

    @property
    def encoding(self):
        return getattr(self.real, "encoding", "utf-8")

    def isatty(self):
        return False


def install():
    """Replace the OpenCV window functions and the console streams (once, at start-up)."""
    cv2.imshow, cv2.waitKey = _imshow, _wait_key
    for name in ("namedWindow", "destroyAllWindows", "destroyWindow", "resizeWindow"):
        setattr(cv2, name, _window_call(name))
    if not isinstance(sys.stdout, _Router):
        sys.stdout, sys.stderr = _Router(sys.stdout), _Router(sys.stderr)
