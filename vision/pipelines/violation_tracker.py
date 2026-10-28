"""
Traffic Violation Detection for Dhaka roads - command-line runner

The dashboard (python app.py) is the main way to use the system. This tool runs the same pipeline without it:
handy for batch-processing recordings on the command line.

    V1     Bus stopped outside a bus stop that is just after an intersection
    V2     Over the speed limit: 60 km/h city, 80 km/h highway / expressway
    V3     Waiting / parked at a no-parking kerb strip (peak hours or heavy traffic)
    V7     Any other vehicle standing in a running lane while traffic goes round it
    V4     Wrong-side driving on a one-way carriageway
    V5     Crossing a solid lane line
    V6     Motorbike rider without helmet (needs --helmet-model)
    V8     Vehicle class banned on this road (rickshaw on a VIP road, CNG on a flyover, ...)

Usage
    Zones: draw them in the dashboard's zone editor and use "Export JSON", or click them here with OpenCV:
        python violation_tracker.py --source video.mp4 --calibrate violation_zones.json --at 60 \
            --import-speed-zones speed_zones.json
       Keys: r = road zone, k = no-parking kerb, i = intersection, b = bus stop, g = signal queue area,
             p = legal parking, t = U-turn opening
             (click points, Enter to close), l = solid lane line, u = undo, s = save, q = quit.
    Recorded video (every frame analysed):
        python violation_tracker.py --source video.mp4 --zones violation_zones.json --start-time "2026-09-22 17:38:17"
    Live phone / IP camera (newest frame, real time; Ctrl+C to stop):
        python violation_tracker.py --source http://192.168.0.105:8080/video --zones violation_zones.json

Output: <out>/violations.csv and snapshots/ (scene + close-up) of each violation; no video is written.
"""

import argparse
import csv
import threading
import time
from collections import Counter
from datetime import datetime, timedelta
from pathlib import Path

import cv2
import numpy as np

from speed_tracker import CORNERS, ask_float, show_top_down, warn_if_short
from surveillance.anpr import PlateCollector, PlateReader, find_models
from surveillance.detector import MODELS_DIR, Detector, HelmetDetector, find_helmet_model
from surveillance.pipeline import Pipeline
from surveillance.sources import FileSource, LiveSource, detect_start_time, is_live_source
from violations import (MOTORISED, NON_MOTORISED, AreaZone, CameraConfig, EvidenceWriter, LaneLine, RoadZone,
                        load_camera_config)
from violations.evidence import event_record
from violations.zones import AREA_COLORS, DIRECTIONS, ROAD_CATEGORIES, draw_label

AREA_KEYS = {ord("b"): "bus_stop", ord("g"): "signal", ord("p"): "parking", ord("t"): "uturn", ord("k"): "no_parking",
             ord("i"): "intersection"}
AREA_MODES = set(AREA_KEYS.values())
# Typical Dhaka office/school rush; edit per location in the zone file (null = enforce all day).
DEFAULT_PEAK_HOURS = [["07:00", "10:30"], ["16:00", "20:30"]]


def parse_args(argv=None):
    p = argparse.ArgumentParser(description="Traffic violation detection (command line)")
    p.add_argument("--source", required=True, help="Video path, or camera index / http:// / rtsp:// for live")
    p.add_argument("--model", default="bd_vehicles_best.pt", help="Detection checkpoint (.pt or .mlpackage)")
    p.add_argument("--zones", default="violation_zones.json", help="Camera zone file")
    p.add_argument("--calibrate", metavar="JSON", default=None,
                   help="Mark zones on a frame of --source with OpenCV, save them to this file, then exit")
    p.add_argument("--import-speed-zones", metavar="JSON", default=None,
                   help="With --calibrate: start from the road zones of a speed_zones.json")
    p.add_argument("--at", type=float, default=0.0, help="With --calibrate: video time (s) of the frame to click on")
    p.add_argument("--start-time", default=None,
                   help='Recording start "YYYY-MM-DD HH:MM:SS" (default: from the file name / metadata)')
    p.add_argument("--out", default="violations_out", help="Folder for violations.csv and snapshots")
    p.add_argument("--only", nargs="+", default=None, metavar="V", help="Run only these rules, e.g. --only V1 V2")
    p.add_argument("--bus-dwell-sec", type=float, default=None, help="V1: seconds a bus must stand (default 15)")
    p.add_argument("--park-dwell-sec", type=float, default=None, help="V3: seconds a vehicle must stand (default 60)")
    p.add_argument("--helmet-model", default=None, help="V6: helmet model (default: models/helmet.*)")
    p.add_argument("--no-helmet", action="store_true", help="Don't check helmets (V6)")
    p.add_argument("--no-anpr", action="store_true", help="Don't read number plates")
    p.add_argument("--imgsz", type=int, default=None, help="Detector input size (default 960 for files, 640 live)")
    p.add_argument("--backend", default="auto", choices=["auto", "coreml", "pytorch"])
    p.add_argument("--tracker", default="bytetrack", choices=["bytetrack", "botsort"])
    p.add_argument("--analysis-fps", type=float, default=30, help="Files: frames analysed per second")
    p.add_argument("--max-width", type=int, default=0,
                   help="Downscale frames to this width before analysis (0 = full resolution, best for helmets/plates)")
    p.add_argument("--realtime", action="store_true", help="Files: play at real speed like a live camera")
    p.add_argument("--no-roi", action="store_true", help="Detect on the whole frame, not just around the zones")
    p.add_argument("--no-stabilize", action="store_true",  # [web] the dashboard's per-camera "stabilize" setting
                   help="Don't follow camera movement (surveillance/camera_motion.py): for a camera known to be fixed")
    p.add_argument("--no-show", action="store_true", help="Don't open a preview window")
    return p.parse_args(argv)


# ---------------------------------------------------------------- calibration

def ask_choice(prompt, options, default):
    opts = "/".join(f"[{o}]" if o == default else o for o in options)
    while True:
        value = input(f"{prompt} ({opts}): ").strip().lower() or default
        match = [o for o in options if o.startswith(value)]
        if len(match) == 1:
            return match[0]
        print(f"Type one of: {', '.join(options)}")


def ask_optional_float(prompt):
    while True:
        value = input(prompt).strip()
        if not value:
            return None
        try:
            if float(value) > 0:
                return float(value)
        except ValueError:
            pass
        print("Type a positive number, or press Enter for none")


def ask_classes(prompt):
    known = {c.lower(): c for c in MOTORISED | NON_MOTORISED}
    while True:
        names = [n.strip() for n in input(prompt).replace(",", " ").split() if n.strip()]
        bad = [n for n in names if n.lower() not in known]
        if not bad:
            return [known[n.lower()] for n in names]
        print(f"Unknown: {bad}. Classes: {', '.join(sorted(known.values()))}")


def ask_road_rules(name):
    print(f"\nRules for road zone '{name}' (Enter = default in brackets):")
    category = ask_choice("  Road category", list(ROAD_CATEGORIES), "city")
    print("  Allowed direction: Bangladesh drives on the LEFT, so on a two-way road seen from behind the traffic,\n"
          "  the left carriageway goes away from the camera and the right one comes toward it.\n"
          "  Use 'both' for two-way zones (wrong-side check off).")
    direction = ask_choice("  Allowed direction", list(DIRECTIONS), "both")
    cap = ask_optional_float("  Lower local speed limit in km/h, e.g. 20 near a school [none]: ")
    banned = ask_classes("  Classes banned here, e.g. 'Rickshaw Easybike CNG' [none]: ")
    stopping = ask_choice("  Is stopping/parking allowed in this whole zone (service lane)", ["no", "yes"], "no")
    return dict(road_category=category, allowed_direction=direction, speed_limit_kph=cap, banned_classes=banned,
                stopping_allowed=stopping == "yes")


def calibrate(args):
    cap = cv2.VideoCapture(args.source)
    cap.set(cv2.CAP_PROP_POS_MSEC, args.at * 1000)
    ok, frame = cap.read()
    cap.release()
    if not ok:
        raise SystemExit(f"Could not read a frame at {args.at}s from {args.source}")
    h, w = frame.shape[:2]
    ui = h / 1080
    camera = CameraConfig([], peak_hours=DEFAULT_PEAK_HOURS, frame_size=[w, h])
    history = []  # "road" / "area" / "line", for undo
    if Path(args.calibrate).exists():
        camera = load_camera_config(args.calibrate, w, h)
        history = ["road"] * len(camera.roads) + ["area"] * len(camera.areas) + ["line"] * len(camera.lines)
        print(f"Loaded {args.calibrate}: {len(camera.roads)} road zones, {len(camera.areas)} areas, "
              f"{len(camera.lines)} lane lines")
    elif args.import_speed_zones:
        imported = load_camera_config(args.import_speed_zones, w, h)
        for z in imported.roads:
            camera.roads.append(RoadZone(z.name, z.poly, z.width_m, z.length_m, **ask_road_rules(z.name)))
            history.append("road")

    mode, clicks = "road", []

    def on_mouse(event, x, y, *_):
        if event == cv2.EVENT_LBUTTONDOWN and not (mode == "road" and len(clicks) >= 4) \
                and not (mode == "line" and len(clicks) >= 2):
            clicks.append((x, y))

    win = "Violation zones | r road  b bus stop  g signal  p parking  t U-turn  l solid line | Enter close  u  s  q"
    cv2.namedWindow(win, cv2.WINDOW_NORMAL)
    cv2.setMouseCallback(win, on_mouse)
    print(__doc__.split("Usage")[1])
    print("Road zone corners, in order: " + ", ".join(CORNERS) + " (a real rectangle you can measure).\n")

    while True:
        img = frame.copy()
        camera.draw(img, ui)
        n = len(clicks)
        col = AREA_COLORS.get(mode, (0, 0, 255))
        for i, pt in enumerate(clicks):
            cv2.circle(img, pt, max(3, int(6 * ui)), col, -1)
            if mode == "road":
                draw_label(img, f"{i + 1} {CORNERS[i]}", (pt[0] + 10, pt[1] - 10), col, 0.6 * ui)
        if n > 1:
            cv2.polylines(img, [np.int32(clicks)], mode == "road" and n == 4, col, max(1, round(2 * ui)), cv2.LINE_AA)
        hint = {"road": f"ROAD zone: click {CORNERS[n]}" if n < 4 else "ROAD zone: answer in the terminal",
                "line": f"SOLID LANE LINE: click end point {n + 1}" if n < 2 else "",
                }.get(mode, f"{mode.upper()} area: click points, Enter to close ({n} so far)")
        draw_label(img, hint, (20, int(50 * ui)), (255, 255, 255), 0.9 * ui)
        cv2.imshow(win, img)
        key = cv2.waitKey(30) & 0xFF
        if cv2.getWindowProperty(win, cv2.WND_PROP_VISIBLE) < 1:
            break

        if mode == "road" and n == 4:
            if not cv2.isContourConvex(np.int32(clicks)):
                print("Those points cross over each other. Click them in order: " + ", ".join(CORNERS))
                clicks.clear()
                continue
            name = input(f"Road zone name [road{len(camera.roads) + 1}]: ").strip() or f"road{len(camera.roads) + 1}"
            width = ask_float("Real width in metres (left edge to right edge): ")
            length = ask_float("Real length in metres (far edge to near edge): ")
            camera.roads.append(RoadZone(name, clicks, width, length, **ask_road_rules(name)))
            warn_if_short(camera.roads[-1])
            history.append("road")
            clicks.clear()
            show_top_down(frame, camera.roads[-1])
            print("Check the top-down window: lane lines should be straight and parallel.\n")
        elif mode == "line" and n == 2:
            name = input(f"Solid line name [line{len(camera.lines) + 1}]: ").strip() or f"line{len(camera.lines) + 1}"
            try:
                camera.lines.append(LaneLine(name, clicks, camera.roads))
                history.append("line")
            except ValueError as e:
                print(f"Not added: {e}")
            clicks.clear()
        elif key in (13, 10) and mode in AREA_MODES:
            if n < 3:
                print("An area needs at least 3 points.")
                continue
            name = input(f"{mode} name [{mode}{len(camera.areas) + 1}]: ").strip() or f"{mode}{len(camera.areas) + 1}"
            camera.areas.append(AreaZone(mode, name, clicks))
            history.append("area")
            clicks.clear()
        elif key in AREA_KEYS or key in (ord("r"), ord("l")):
            mode = AREA_KEYS.get(key) or ("road" if key == ord("r") else "line")
            clicks.clear()
            print(f"Mode: {mode}")
        elif key == ord("u"):
            if clicks:
                clicks.pop()
            elif history:
                kind = history.pop()
                removed = {"road": camera.roads, "area": camera.areas, "line": camera.lines}[kind].pop()
                print(f"Removed {kind} {removed.name}")
        elif key == ord("s"):
            if not camera.roads:
                print("Mark at least one road zone first.")
                continue
            camera.frame_size = [w, h]
            camera.save(args.calibrate)
            print(f"Saved {len(camera.roads)} road zones, {len(camera.areas)} areas, {len(camera.lines)} lane lines "
                  f"to {args.calibrate}. Edit peak_hours / rules in the file if needed.")
            break
        elif key in (ord("q"), 27):
            print("Quit without saving.")
            break
    cv2.destroyAllWindows()


# ---------------------------------------------------------------- detection run

def main(args=None, hooks=None):
    """`args`: argument list or parsed Namespace (default: the command line). `hooks` [web]: receives each violation
    (`violation`), reads plates with its own collector (`plate_collector`) and gets progress (`progress`)."""
    args = args if isinstance(args, argparse.Namespace) else parse_args(args)
    if args.calibrate:
        calibrate(args)
        return
    if not Path(args.zones).exists():
        raise SystemExit(f"Zone file '{args.zones}' not found. Draw zones in the dashboard (python app.py) and use "
                         f"Export JSON, or run with --calibrate {args.zones}")
    live = is_live_source(args.source)
    imgsz = args.imgsz or (640 if live else 960)
    if live:
        source = LiveSource(args.source, args.max_width).open()
        start_time = None
    else:
        source = FileSource(args.source, args.analysis_fps, args.max_width, args.realtime).open()
        if args.start_time:
            start_time, how = datetime.fromisoformat(args.start_time), "--start-time"
        else:
            start_time, how = detect_start_time(args.source)
        print(f"Recording start: {start_time or 'unknown'}" + (f" (from {how}; check it against the video clock)"
                                                                 if start_time else " - use --start-time"))
    camera = load_camera_config(args.zones, source.width, source.height)
    overrides = {}
    if args.bus_dwell_sec:
        overrides["bus_blocking"] = {"dwell_sec": args.bus_dwell_sec}
    if args.park_dwell_sec:
        overrides["illegal_parking"] = {"dwell_sec": args.park_dwell_sec}
    detector = Detector(args.model, imgsz, args.backend, tracker=args.tracker, fps=source.fps)
    helmet_path = args.helmet_model or (None if args.no_helmet else find_helmet_model())
    helmet = HelmetDetector(helmet_path) if helmet_path else None
    plate_model, char_model = find_models(MODELS_DIR)
    plates, plates_csv, lock = None, None, threading.Lock()
    Path(args.out).mkdir(parents=True, exist_ok=True)
    if hooks is not None:  # [web] the web service reads plates with its own models and stores the results, and
        # lists every vehicle that passes with its plate (the passed-vehicle list)
        plates = None if args.no_anpr else hooks.plate_collector(list_vehicles=True)
    elif not args.no_anpr and plate_model and char_model:
        plates_file = open(Path(args.out) / "plates.csv", "w", newline="", encoding="utf-8-sig")
        plates_csv = csv.writer(plates_file)
        plates_csv.writerow(["id", "status", "plate", "plate_en", "confidence", "readings", "agreeing", "plate_px",
                             "image"])

        def on_plate(key, r):
            img = ""
            if r.image is not None and r.image.size:
                img = f"snapshots/{key}_plate.jpg"
                cv2.imwrite(str(Path(args.out) / img), r.image, [cv2.IMWRITE_JPEG_QUALITY, 95])
            with lock:
                plates_csv.writerow([key, r.status, r.text_bn, r.text_en, r.confidence, r.readings, r.agreeing,
                                     r.plate_px, img])
                plates_file.flush()
            print(f"\n[plate] case {key}: " + (f"{r.text_bn} ({r.text_en}), confidence {r.confidence}"
                                               if r.status in ("read", "partial") else r.status))
        plates = PlateCollector(PlateReader(plate_model, char_model), on_plate)
    print(f"Helmet check (V6): {'on' if helmet else 'off'} | Number plates: {'on' if plates else 'off'}")
    pipe = Pipeline(detector, camera, (source.width, source.height), start_time, live, helmet, overrides, args.only,
                    auto_roi=not args.no_roi, plates=plates, stabilize=not args.no_stabilize)
    print("Road zones:\n  " + "\n  ".join(z.describe() for z in camera.roads))
    print("Rules: " + ", ".join(f"{r.code} {r.title}" for r in pipe.engine.rules))
    for code, why in sorted(pipe.engine.inactive.items()):
        print(f"  {code} off: {why}")

    evidence = EvidenceWriter(args.out)
    if not args.no_show:
        cv2.namedWindow("Violation Detection", cv2.WINDOW_NORMAL)
    frames, t_start, last_print, t = 0, time.time(), 0.0, 0.0
    try:
        while True:
            got = source.read()
            if got is None:
                break
            if live:
                frame, t, wall = got
            else:
                frame, t = got
                wall = start_time + timedelta(seconds=t) if start_time else None
            res = pipe.process(frame, t, wall)
            frames += 1
            for ev in res.events:
                ev_frame, ev_wall = frame, wall
                if ev.frame is not None:  # decided after the vehicle left: its evidence is an earlier frame
                    ev_frame = cv2.imdecode(np.frombuffer(ev.frame, np.uint8), cv2.IMREAD_COLOR)
                    ev_wall = start_time + timedelta(seconds=ev.obs.time_s) if start_time else None
                wall_text = ev_wall.strftime("%Y-%m-%d %H:%M:%S") if ev_wall else ""
                evidence.write(ev, ev_frame, wall_text)
                key = None
                if hooks is not None:  # [web]
                    key = hooks.violation({**event_record(ev, wall_text), "title": ev.title}, ev_frame, ev.obs.bbox,
                                          path=ev.path, extra_frames=ev.extra_frames)
                if plates:
                    plates.request(ev.obs.tid, key or evidence.n, t)
                print(f"\n[{ev.code}] {ev.title}: {ev.obs.cls} #{ev.obs.tid} at {wall_text or f'{t:.1f}s'} "
                      f"in '{ev.obs.road.name if ev.obs.road else '-'}' {ev.details}")
            if not args.no_show:
                cv2.imshow("Violation Detection", res.display)
                if cv2.waitKey(1) & 0xFF == ord("q"):
                    break
            if time.time() - last_print > 2:
                last_print = time.time()
                prog = source.progress()
                print(f"\r{frames} frames | {frames / (time.time() - t_start):5.1f} FPS | "
                      f"{f'{100 * prog:5.1f}% | ' if prog is not None else ''}{len(pipe.engine.events)} violations | "
                      f"Ctrl+C to stop   ", end="", flush=True)
                if hooks is not None:  # [web]
                    hooks.progress(frames=frames, total=source.total or 0,
                                   fps=frames / max(1e-6, time.time() - t_start),
                                   violations=len(pipe.engine.events))
    except KeyboardInterrupt:
        print("\nStopped - finishing the output files...")
    print()
    if plates:
        print("Reading the last number plates...")
        plates.flush()
    evidence.close()
    pipe.close()  # [web] its camera-movement thread (the web service runs many analyses in one process)
    source.close()
    detector.close()
    cv2.destroyAllWindows()

    print(f"\nFrames processed: {frames} | avg {frames / max(1e-6, time.time() - t_start):.1f} FPS")
    print(f"===== VIOLATIONS ({len(pipe.engine.events)}) =====")
    by_rule = Counter((ev.code, ev.title) for ev in pipe.engine.events)
    for rule in pipe.engine.rules:
        print(f"{rule.code:<4}{rule.title:<34}{by_rule[(rule.code, rule.title)]:>5}")
    print(f"Evidence: {Path(args.out) / 'violations.csv'}")
    print("\n===== TRAFFIC DIRECTION PER ZONE (check allowed_direction) =====")
    if hooks is not None:  # [web] observed directions -> the zone editor suggests allowed_direction
        hooks.learning(pipe.direction_suggestions(min_vehicles=10))
    for name, d in pipe.direction_suggestions(min_vehicles=10).items():
        z = next(r for r in camera.roads if r.name == name)
        hint = f"  <-- suggested: {d['suggestion']}" if d["suggestion"] and d["suggestion"] != z.allowed_direction else ""
        print(f"{name}: {d['toward']} toward camera, {d['away']} away (allowed: {z.allowed_direction}){hint}")


if __name__ == "__main__":
    main()
