"""Sizes of road zones nobody measured (other-violations box only; the speed box uses measured zones only).

The other rules need metres (how far a vehicle moved, kerb distances, queue gaps), but not the precision speed needs,
so a hand-drawn road zone may be saved without its width and length. Before the box starts, each such zone gets a
size estimated from a camera model (CSE499B autozone's pin-hole GroundModel: road direction from vehicle paths, lens
from vertical structures, camera height from vehicle sizes):
  1. the model saved with the camera's Auto zones (`zones.auto.camera`), else
  2. this vision service's cached calibration of the camera (`data/calibrations/<camera id>.json`), else
  3. a new calibration from about a minute of the run's own video, cached for the next runs.
Estimated zones are marked scale_source "auto" with the calibration's uncertainty, like Auto zones' own.
"""

import json
import math
import time
from pathlib import Path

import cv2
import numpy as np

from . import config

CALIBRATIONS = config.DATA / "calibrations"
ANALYSIS_FPS = 15         # tracks stay continuous at 15 FPS, twice as fast as full analysis
MAX_WIDTH = 1920          # zones are scaled to any resolution later; 4K adds nothing to the layout
# enough for a camera model (his propose() needs 60 moving vehicles for a whole layout; sizes need fewer)
CAL_MOVING, CAL_MIN_S, CAL_MAX_S_FILE, CAL_MAX_S_LIVE = 80, 30.0, 180.0, 600.0


def observe(src, live, stopped, on_progress, target_moving, min_seconds, max_file_s, max_live_s, status=None):
    """Watches `src` with the vehicle detector until `target_moving` moving road users AND `min_seconds` (or the
    time limit, or the video's end). Everything is recorded in the view of the first frame (the reference): when the
    camera sways, positions are mapped back to it, and frames it cannot be matched to are skipped.
    Returns (TrafficObserver, reference time, frames skipped); None if `stopped()` became true."""
    from surveillance.autozone import TrafficObserver
    from surveillance.camera_motion import CameraMotion
    from surveillance.detector import Detector
    from surveillance.sources import FileSource, LiveSource

    source = detector = None
    try:
        if live:
            source = LiveSource(src, MAX_WIDTH).open()
            limit = max_live_s
        else:
            source = FileSource(src, ANALYSIS_FPS, MAX_WIDTH, False).open()
            limit = min(max_file_s, source.duration or max_file_s)
        if status:
            status("Loading the detection model...")
        detector = Detector(str(config.VEHICLE_MODEL), 640 if live else 960, "pytorch", tracker="bytetrack",
                            fps=source.fps)
        obs = TrafficObserver((source.width, source.height))
        last_check, t0, ref_t = 0.0, None, None
        motion, boxes, skipped = None, [], 0
        while not stopped():
            got = source.read(timeout=1.0) if source.is_live else source.read()
            if got is None:
                if source.is_live:
                    continue
                break   # end of the video
            frame, t = got[0], got[1]
            t0 = t if t0 is None else t0
            if motion is None:
                ref_t, motion = t, CameraMotion(frame.copy())
            motion.update(frame, t, boxes)
            tracks = detector.track(frame)
            boxes = [b for b, _, _ in tracks]
            if not motion.enforce:
                skipped += 1
                continue
            if not motion.identity:
                tracks = [(tuple(motion.to_ref([b[:2], b[2:]]).ravel()), tid, c) for b, tid, c in tracks]
            obs.add(t, tracks)
            obs.add_frame(frame if motion.identity else
                          cv2.warpAffine(frame, motion.A, (frame.shape[1], frame.shape[0])), t)
            elapsed = t - t0
            if elapsed - last_check >= 3.0:
                last_check = elapsed
                moving = obs.moving_tracks()
                progress = min(1.0, 0.5 * min(1.0, moving / target_moving) + 0.5 * min(1.0, elapsed / min_seconds))
                if not live and limit:   # a short recording is watched to its end: show that instead
                    progress = max(progress, min(1.0, elapsed / limit))
                on_progress(elapsed, moving, progress)
                if (moving >= target_moving and elapsed >= min_seconds) or elapsed >= limit:
                    break
        return None if stopped() else (obs, ref_t, skipped)
    finally:
        for obj in (detector, source):
            if obj is not None:
                try:
                    obj.close()
                except Exception:
                    pass


def camera_model(obs, log=lambda m: None):
    """Steps 1-3 of his propose(): road vanishing point, lens, camera height. Returns a JSON-safe model dict, or
    raises ValueError with a readable reason."""
    from surveillance.autozone import (ROAD_USERS, Track, calibrate, lens_from_verticals, track_lines,
                                       vanishing_point, vertical_segments)

    W, H = obs.W, obs.H
    tracks = [Track(tid, rows, obs.votes[tid], W, H) for tid, rows in obs.tracks.items() if len(rows) >= 6]
    for tr in tracks:
        ok = ~tr.clipped
        if ok.sum() >= 4:
            du = tr.u[ok][-1] - tr.u[ok][0]
            dv = tr.v[ok][-1] - tr.v[ok][0]
            tr.moving = math.hypot(du, dv) >= 0.04 * H
    moving = [t for t in tracks if t.moving and t.cls in ROAD_USERS]
    vp, share, n_in = vanishing_point(track_lines(moving, H), W, H)
    if vp is None or n_in < 15:
        raise ValueError("the vehicle paths are not straight enough to find the road direction")
    if vp[1] > H * 0.45:
        raise ValueError("the camera looks too steeply down or across the road")
    lens = lens_from_verticals(vertical_segments(obs.frames, vp), W, H, vp) if obs.frames else None
    gm, cal = calibrate(tracks, W, H, vp, lens=lens, log=log)
    if gm is None:
        raise ValueError(cal["reason"])
    return {"f": float(gm.f), "hfov_deg": float(gm.hfov), "roll_deg": float(gm.roll),
            "vp": [float(gm.vp[0]), float(gm.vp[1])], "height_m": float(gm.scale), "frame_size": [W, H],
            "speed_uncertainty_pct": int(cal["speed_uncertainty_pct"]), "lens": cal["lens"],
            "moving_vehicles": len(moving)}


def _ground_model(model, frame_size):
    """The model's GroundModel in the pixels of `frame_size` (zones may be drawn on another resolution)."""
    from surveillance.autozone import GroundModel

    W = model.get("frame_size", [None])[0] or 2 * model["f"] * math.tan(math.radians(model["hfov_deg"]) / 2)
    s = frame_size[0] / W
    gm = GroundModel(frame_size[0], frame_size[1], model["f"] * s, [v * s for v in model["vp"]],
                     model.get("roll_deg", 0.0))
    gm.scale = float(model["height_m"])
    return gm


def has_size(zone):
    return _num(zone.get("width_m")) > 0 and _num(zone.get("length_m")) > 0


def unsized(zones):
    """Road zones without a width and length."""
    return [z for z in zones.get("zones", []) if z.get("type", "road") == "road" and not has_size(z)]


def _num(x):
    try:
        return float(x)
    except (TypeError, ValueError):
        return 0.0


def fill_sizes(zones, model):
    """Sets width_m / length_m of every unsized road zone from `model`; returns the names it could not size (a
    corner at or above the horizon, or an implausible size)."""
    gm = _ground_model(model, zones.get("frame_size") or model["frame_size"])
    unc = model.get("speed_uncertainty_pct")
    failed = []
    for z in unsized(zones):
        pts = np.float64(z["points"])   # far-left, far-right, near-right, near-left
        if not gm.below_horizon(pts[:, 0], pts[:, 1]).all():
            failed.append(z["name"])
            continue
        along, across = gm.road_coords(pts[:, 0], pts[:, 1])
        width = (abs(across[1] - across[0]) + abs(across[2] - across[3])) / 2
        length = (abs(along[0] - along[3]) + abs(along[1] - along[2])) / 2
        if not (np.isfinite([width, length]).all() and 1.0 <= width <= 80.0 and 2.0 <= length <= 600.0):
            failed.append(z["name"])
            continue
        z.update(width_m=round(float(width), 1), length_m=round(float(length), 1), scale_source="auto",
                 speed_uncertainty_pct=unc)
    return failed


def saved_model(zones, camera_id):
    """A camera model without watching traffic: Auto zones' (saved with the zones), else this service's cache."""
    auto = (zones.get("auto") or {}).get("camera")
    if auto and auto.get("f") and auto.get("vp") and auto.get("height_m"):
        cal = ((zones.get("auto") or {}).get("report") or {}).get("calibration") or {}
        return {**auto, "speed_uncertainty_pct": auto.get("speed_uncertainty_pct") or cal.get("speed_uncertainty_pct"),
                "from": "the camera's Auto zones"}
    path = _cache_path(camera_id)
    if path and path.exists():
        try:
            return {**json.loads(path.read_text()), "from": "this camera's earlier calibration"}
        except ValueError:
            pass
    return None


def remember(camera_id, model, source_label):
    path = _cache_path(camera_id)
    if path:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps({**model, "source": source_label, "at": time.strftime("%Y-%m-%d %H:%M:%S")},
                                   indent=2))


def _cache_path(camera_id):
    return CALIBRATIONS / f"{Path(str(camera_id)).name}.json" if camera_id else None
