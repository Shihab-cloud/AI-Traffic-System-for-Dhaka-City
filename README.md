# Dhaka Traffic Enforcement

Web system around the CSE-499 vision pipeline: cameras detect and track vehicles, measure speed, find violations and
read number plates; traffic personnel check each violation and send a ticket; the vehicle owner sees the evidence,
applies for a review or pays the fine online and gets the invoice by email.

Three portals, one sign-in (the role decides where you land):

| Role | Lands on | What they do |
|---|---|---|
| **Admin** | `/admin/dashboard` | Overview (charts), cameras and their zones (drawn on a camera frame), vehicle registry, fines, payments, audit log, users and roles. Admins also see every officer page. |
| **Traffic personnel** (`TRAFFIC_OFFICER`) | `/officer/dashboard` | Live violation table (Vehicle ID, plate, type, time, **Check**). The Check pop-up shows the evidence images, the details, an explanation from a vision-language model, and **Send ticket** / Dismiss. Surveillance (2 live boxes: camera, video, Start / Stop; zones, rule list, log and run history are admin-only), Passed Vehicles, Track (by plate, by appearance), Tickets, Review requests. |
| **Vehicle user** (default `USER` role, self-registration) | `/my-cases` | One page per case: violation images, video slot, all details, **Apply for Review**, **Pay the fine** (payment pop-up; invoice PDF emailed). |

## How it fits together

```
Browser (Next.js + MUI, :3000) ── REST ──► NestJS backend (:5001) ── MongoDB (replica set), Redis
      │  live view (MJPEG) and video upload,           │  evidence images + invoices ──► S3 (SeaweedFS locally)
      │  with short-lived signed tokens                │  email ──► SMTP (Mailpit locally)
      └──────────────────────────────► Python vision service (:8601, FastAPI) ◄── start / stop, frames
                                          runs the project scripts unchanged in threads:
                                          speed_tracker.py · violation_tracker.py (V1-V8), and reads the
                                          violators' plates and lists every vehicle that passes, with its plate
                                          (plate_reader.py's method); POSTs violations, plate reads and the
                                          list to the backend; describes listed vehicles (/describe, local VLM)
```

* **The scripts are reused, not rewritten.** `vision/pipelines/` holds copies of `vehicle_tracker.py`,
  `speed_tracker.py`, `plate_reader.py` (this project) and `violation_tracker.py` + `violations/` + `surveillance/`
  (CSE499B-Implementation, scripts only). The service calls each script's `main()`; `cv2.imshow` is redirected to
  the browser, so a surveillance box shows exactly the window that `--no-show` would hide, and Stop makes
  `cv2.waitKey` return `q`. Changes to the copies are marked `[web]`: argument lists / hooks, live-camera reading,
  and over-speed events in `speed_tracker.py` (limit + margin for 1 s and average over the limit).
  The CSE499B copies were brought up to the team's version of 2026-10-27: zones follow the picture when the camera
  moves (`surveillance/camera_motion.py`; enforcement pauses if the view is lost), a box whose bottom is hidden behind
  a nearer vehicle no longer gets a wrong position, speeds come from a least-squares fit over the last second,
  standing-vehicle rules use far-end positions to decide who passed / who heads a queue and keep a stand across a
  tracker ID change, and automatically calibrated zones get a wider speed margin. His tests (`tests/`, 107) pass on
  the copies except the 2 for his own dashboard database, which the portal does not use.
* **Evidence**: each violation uploads the scene (vehicle boxed, path drawn), a close-up and, when a plate was found,
  the plate crop and a "Vehicle and plate" image (the vehicle with its plate boxed, the plate enlarged, the read).
  **Video clip** (2026-10-28): 15 s of the source video (12 s before, 3 s after), the vehicle boxed in red, a clock
  and "violation in 3.0 s" overlay; made by the vision service (`vision/service/clips.py`, ~30 s each, H.264 through
  `.tools/ffmpeg/ffmpeg.exe`) for violations from recorded videos, and for older violations the first time their case
  is opened. The officer's Check pop-up and the owner's case page play it. The AI explanation also looks at five
  frames of the clip (a speed is never judged from them).
* **Plates of violators** (2026-10-28: the plate box, which read every vehicle's plate at ~1.6
  FPS, was merged into the speed box). Both boxes show every vehicle to `vision/service/plates.py`, which keeps its 30
  largest crops (at least 0.1 s apart, vehicles at least 100 px wide, not pedal vehicles), anywhere in the picture:
  a vehicle coming toward the camera is closest after it has left the speed zone, one going away before it came in.
  When a vehicle breaks a rule its plate is read once it has left (or after 20 s), as plate_reader.py reads: our
  models (BLPD plate detector + `bd_plate_ocr_v2_best.pt`), the plate must be on the vehicle's own box, the camera's
  clock overlay is ignored, plates under 24 px are not read, reads are voted per vehicle. Only a *confirmed* read
  fills the ticket's registration, and here "confirmed" also needs the agreeing reads to come from a plate at least
  50 px wide: on the test clip the character model "confirmed" 12-0412 from a blurred 25 px plate, and 11-9911 and
  11-0599 from motion-streaked 41 and 44 px plates nobody can read. Otherwise the
  officer types the plate from the images. On the Dhaka footage plates are 25-45 px and motion-streaked, so most
  reads are "uncertain" and many vehicles show no plate at all: expect to type plates by hand.
  Test clip, speed box with a test limit of 25 km/h (104 vehicles over it; the old violator reader in the same run in
  brackets): a plate found on 33 (25): cars 25 of 38 (18), buses 4 of 4 (2), motorbikes 1 of 46 (3, all 10-21 px);
  uncertain 15 (10), partial 6 (4), unreadable 12 (11), confirmed 0 (0; without the width rule 1, the false
  12-0412). The speed box keeps its ~20 FPS.
* **Passed Vehicles** (officer sidebar, 2026-10-28): the other-violations box also reads the plate of every vehicle
  that passes and lists it: vehicle ID (the tracker's, per run), class, registration number and read status, first
  and last seen (camera clock), a two-word look ("grey SUV", "green CNG") and a photo. Pick the camera point and the
  run (newest by default), search by plate, class, look or ID, download the list as CSV. Each vehicle's plate is read
  from its 10 largest views (8 if none shows a plate) after the violators' plates, in batches of 8 (the box ran at
  9 FPS instead of ~10 on the test clip; a recorded video waits for the reader rather than skip vehicles). The look
  comes from the local Qwen3.5-2B: asked only the colour (with the detector's class, which knows Bangladeshi
  vehicles better than the model) and, for cars, car or SUV. The model and a running box do not fit in the GPU
  together, so the backend has the vehicles described after the run, about one per second (the page says how many
  are still waiting). Test clip: 915 vehicles in 147 s (a vehicle the tracker loses and finds again counts twice),
  plates 743 none found, 114 uncertain, 37 partial, 19 unreadable; ~28 of 34 looks checked right, motorbikes worst
  (the rider's clothes).
* **VLM explanation** (no internet, no API): the vision service runs **Qwen3.5-2B** (Apache-2.0) in 4-bit on the GPU
  (`vision/service/vlm.py`, ~2 GB GPU, 10-25 s per violation, loaded on the first request and unloaded after 10 min
  idle). It gets the scene image (with the red label painted out: it read "#20 2 km/h" as a speed) and the close-up,
  plus the recorded data, and says what the images show, whether they support the violation and what to check. For
  V6 it is first asked only what is on the driver's head (helmet / hair / cap / unclear), and that answer sets the
  verdict. For V2 a photo cannot contradict a speed: only "box not on a vehicle" counts against it, and a wrong vehicle
  type is a concern. Speeds are left out for non-speed rules. Tested on one violation of each type: 7 of 8 verdicts right, the 8th "unclear". It can be
  wrong, and the Check pop-up says so. Alternatives in `apps/backend/.env`: `VLM_PROVIDER=anthropic` (Claude, needs
  `ANTHROPIC_API_KEY`) or `rules` (a summary built from the measurements, labelled as such). The weights must be in
  the local Hugging Face cache (download command at the top of `vlm.py`).
* **Payments**: online through **SSLCommerz**, Bangladesh's gateway (card, bKash, Nagad, Rocket, internet banking on
  its own page), sandbox by default (`apps/backend/.env`: `SSLCOMMERZ_STORE_ID` / `SSLCOMMERZ_STORE_PASSWORD` of a
  free sandbox store from https://developer.sslcommerz.com/registration/; `SSLCOMMERZ_LIVE=true` for real money). The payer returns to the case page; the backend counts a payment only after
  SSLCommerz's validation API confirms it. The built-in test gateway stays as the pop-up's "Test payment" tab (card,
  bKash, Nagad, Rocket test flows; no money moves). Card numbers are never stored.
* **Multi-camera tracking: one Vehicle ID across the network** (2026-10-29, after Liu et al., "City-Scale
  Multi-Camera Vehicle Tracking Guided by Crossroad Zones", AI City 2021 winner). Both boxes list every vehicle that
  leaves the picture (the speed box without reading its plate), with where it came in and went out and an
  appearance vector (DINOv2-small, a general image model, + a colour histogram; `vision/service/reid.py`). The
  backend (`vehicle-identity.service.ts`, `vehicle-matching.ts`) gives it a **Vehicle ID** (`DV-000123`) and keeps
  that ID when the vehicle turns up again:
  1. its confirmed plate was seen before -> that vehicle;
  2. same camera: the tracker lost it and numbered it anew (ended 0.5-6 s before, where this one starts, looks the
     same: score >= 0.80), or another box listed the same vehicle;
  3. other cameras: only the vehicles that left a **linked** camera through the linked **gate** inside the link's
     travel-time window are compared (the paper's crossroad zones and direction-based temporal mask), best
     appearance score >= 0.72 and 0.04 ahead of the next; when none is accepted, the gates **two links** up (a
     camera in between missed the vehicle: windows added + up to 60 s inside the missed camera's view, score
     >= 0.76); else a new ID.
  Records may arrive **out of order** (camera B's video processed before camera A's, a delayed event): a record
  whose next camera already gave the vehicle a new ID asks that sighting again, with this record and the records
  still waiting for their IDs among its candidates; if it picks this record, the two join and keep the ID of the
  vehicle's **first** camera (the other ID stays searchable: `mergedVids`). On an open vehicle, **Look-alikes
  elsewhere** lists the vehicles anywhere in the network that look most like it (after it was last seen, or any
  time) from an in-memory **HNSW** index of every vehicle's mean appearance vector (`appearance-index.ts`):
  suggestions to check by photo, never joined automatically. The open vehicle refreshes every 15 s.
  Admins draw a camera's gates (where vehicles enter / leave its view) and its links ("leaving through N-out, a
  vehicle reaches camera B's S-in after 30-150 s") in **Admin > Cameras > Network**. Officers search on **Track >
  Find a vehicle**: by Vehicle ID (first: `DV-000123`, `dv123` or `123`), plate, or look (colour, type, class, last
  camera); each result shows where it was **last seen** in the whole network, and opening it shows its route
  across cameras, every record (with how its ID was kept), its violations and tickets. The ID is on violations,
  tickets, the Check pop-up and the passed-vehicle list (a link to the vehicle). **Efficiency**: a new sighting
  costs a few index lookups plus k candidates (the vehicles on that one road link in that time window), never a
  comparison with every vehicle; searches are index lookups on `tracked_vehicles` (one row per vehicle, its last
  camera on it). Synthetic 2,000-camera network (benchmark with the backend's own scoring code): 3-5 us per
  new sighting from 100,000 to 1,000,000 stored, flat; comparing with every earlier sighting took 292 us at 2,500
  and 4,169 us at 20,000 (O(n^2) overall). In the real backend a sighting takes ~25 ms, mostly database writes.
  Two-link routes are precomputed when a network changes (k^2 lookups per sighting at most); the look-alike index
  answers in ~0.6-1.1 ms from 10,000 to 200,000 vehicles (comparing with every one: 1.7 -> 34 ms), recall@10 100%
  against the exact answer on the real vehicles. Admins can **rebuild** every ID from the stored sightings
  (`POST /api/track/vehicles/rebuild`) after changing links or `MTMC_*` settings (`MTMC_ACCEPT`, `MTMC_MARGIN`,
  `MTMC_SAME_CAMERA_ACCEPT`, `MTMC_SKIP_ACCEPT`, `MTMC_SKIP_DWELL_S` in `apps/backend/.env`).
  Compared on 2026-10-29 with a design note ("Real-time vehicle tracking across millions of cameras": edge
  events, Kafka by vehicle ID, Redis hash, HNSW, road graph with 1- and 2-hop windows). Its road
  graph and edge events were already the method here; taken from it: the 2-hop fallback, out-of-order handling and
  the HNSW index. Not taken: Kafka partitioned by vehicle ID (for appearance matching the ID is the result, so a
  stream would be partitioned by road region), a Redis hash in place of MongoDB's indexes (O(1) vs O(log n), ~30
  comparisons at a billion rows, not worth a second copy), the global vector search as an automatic last step
  (lookalikes: it would join different vehicles), WebSockets (the portal polls, like its other pages).
  The plate-records tab lists every plate read and typed, record by record.

## Run it

Everything runs locally on Windows without Docker (developed on Windows 11, an NVIDIA RTX 2050 with 4 GB and 8 GB
RAM). The local services listen on 127.0.0.1 only; their data lives in `.data/`.

### What to install (not in the repository)

Portable copies in `.tools/`, where `infra/start-infra.ps1` and `start-all.ps1` look for them:

| Folder | What | Version used |
|---|---|---|
| `.tools/node/` | Node.js Windows zip (`node.exe` at the top of the folder) | 24 |
| (anywhere on PATH) | pnpm (`npm install -g pnpm@10`) | 10 |
| `.tools/mongodb/` | MongoDB Community Server zip (`mongod.exe` anywhere below) | 8.0 |
| `.tools/redis/` | Redis for Windows (`redis-server.exe` anywhere below) | 8 |
| `.tools/seaweedfs/weed.exe` | SeaweedFS (the S3-compatible file store) | 3.x |
| `.tools/mailpit/mailpit.exe` | Mailpit (catches every email the system sends) | 1.x |
| `.tools/ffmpeg/ffmpeg.exe` | ffmpeg, for the violation video clips (optional) | any |

The vision service needs Python 3.11 and an NVIDIA GPU (CUDA PyTorch), in a venv in this folder:

```powershell
py -3.11 -m venv .venv
.venv\Scripts\python.exe -m pip install torch torchvision --index-url https://download.pytorch.org/whl/cu126
.venv\Scripts\python.exe -m pip install -r vision\requirements.txt
```

Models: `vision/models/` has our vehicle detector (`bd_vehicles_best.pt`), the helmet classifier (`helmet_cls.pt`)
and our plate character model (`plate_models/bd_plate_ocr_v2_best.pt`). The plate detector is the BLPD project's
`LPD_Model.pt` (https://github.com/prosensarker4/BLPD, not redistributed here): put it in
`vision/models/plate_models/` to read plates. The appearance model (DINOv2-small) and the explanation model
(Qwen3.5-2B, see the top of `vision/service/vlm.py`) come from Hugging Face.

### Start and stop

```powershell
powershell -ExecutionPolicy Bypass -File start-all.ps1     # infra + backend + vision + frontend, one window each
```

| URL | |
|---|---|
| http://localhost:3000 | the portal |
| http://127.0.0.1:8025 | Mailpit: every email the system sends (tickets, invoices, review decisions) |
| http://localhost:5001/swagger | API reference |
| http://127.0.0.1:8601/docs | vision service API |

Stop: close the windows, then `powershell -ExecutionPolicy Bypass -File infra\stop-infra.ps1`.
With 8 GB RAM, close browser tabs you do not need while the vision service runs.

### First time

1. `pnpm install` from this folder.
2. Copy the settings templates: `apps/backend/.env.example` to `apps/backend/.env`, `apps/frontend/.env.example` to
   `apps/frontend/.env`, `vision/.env.example` to `vision/.env`. In `apps/backend/.env` replace every
   `replace-with-...` secret with a random string of at least 32 characters of your own (the file shows a command;
   `MFA_KEK_B64` must be 32 random bytes in base64); the backend refuses to start while a placeholder is left in.
   `VISION_KEY` must be the same in `apps/backend/.env` and `vision/.env`. In `vision/.env` set `VIDEO_DIRS` to
   the folder with your videos. Never commit the `.env` files (`.gitignore` keeps them out).
3. Start everything (above), then create the admin once: `POST http://localhost:5001/api/user-management/admin`
   with header `x-admin-secret: <ADMIN_SETUP_TOKEN from apps/backend/.env>`; it returns a one-time password for
   `admin@localhost.com`.
4. In the portal: **Admin > User Management** create officers and give them the `TRAFFIC_OFFICER` role. Vehicle
   owners register themselves (sign-up) with the email that is in the vehicle registry.
5. **Zones**: the demo camera *Kakoli overpass (KAK-01)* has the road zones of `speed_zones.json` (speed) and the
   CSE499B team's areas for this view (`CSE499B-Implimentation/violation_zones.json`: both no-parking kerbs, the
   side-road junction and the bus stop after it, one-way directions). For a new camera, or to change zones, under the
   speed and other-violations boxes (admins only, as are the boxes' Log and Recent runs: see below):
   * **Auto zones** (automatic, other-violations box only): the CSE499B auto-zone code (`vision/pipelines/surveillance/autozone.py`) watches the
     selected video for 1.5-7 minutes (a short clip to its end) and proposes the zones: each carriageway with its
     size and direction of travel, no-parking kerbs, junctions, bus stops just after a junction, signal queues and
     U-turn openings. Sizes are estimated by calibrating the camera on vehicle sizes (the report states how
     loosely), so these zones are for the other violations only: the speed box skips a road zone found this way
     until its measured width and length are typed in. The proposal opens in the zone
     editor as a draft, with a report of what was found: check it, fix it, then **Save zones**. Nothing is saved
     before that. Banned classes (V8), solid lane lines (V5), legal parking and approved bus bays cannot be seen in a
     video: add them by hand.
   * **Define zones** (manual), also in **Admin > Cameras & zones**: the web version of the scripts' `--calibrate`
     window. Opened from the other-violations box the dialog also has **Detect zones automatically** and hides the
     speed settings (road type, lower limit); opened from the speed box it is manual only. Load a frame, click a road zone's 4 corners
   (far-left, far-right, near-right, near-left) and type its measured width and length (speed box: required; other
   violations: optional, see "Road zones without a size" below); then select it to set its
   allowed direction, banned classes and **+ Left edge / + Right edge** no-parking kerbs (3 m strips computed from the
   zone, as in the CSE499B editor); add intersections, bus stops and solid lane lines. **Import zone file** reads a
   zone JSON (e.g. the team's `violation_zones.json`). After an other-violations run, each road zone shows the traffic
   direction seen in the video with an **Apply** button (the CSE499B pipeline's direction learning).
   * Editing (automatic or drawn zones): select a shape, drag its white corners or the shape itself, **Undo** reverts.
     Typing a real width or length on an automatic road zone makes it a measured zone (the speed box then uses it).
     A drag updates the editor at most once per screen frame and reaches the dialog on release (moving every
     update through the whole dialog made React stop with "Maximum update depth exceeded" on a fast mouse).
   * Road zones without a size (other violations only): the rules need metres, but not speed precision, so the size
     may be left empty. When the box starts, each such zone is sized from a camera model
     (`vision/service/calibration.py`, CSE499B's autozone calibration): the one saved with the camera's Auto zones,
     else the vision service's cached calibration of that camera (`vision/data/calibrations/<camera id>.json`), else
     the box first watches ~30 s of the run's video (~1 min of processing) and calibrates, then caches the model.
     The log shows the estimated sizes. Test clip: Right side 10.0 x 92.1 m (measured 10.5 x 90), left side
     13.2 x 102.7 m (measured 14 x 90), +-9%. The speed box ignores such zones and still needs measured ones. If the
     camera is moved, delete its cached calibration file.
   * The other-violations box always runs every rule (V1, V3-V8; no ticking). A rule whose zones are missing switches
     itself off; the box shows which ones are off and why. It has nothing to do with speed: its video, evidence
     labels and cases show no speeds (the rules still use speeds internally to tell stopped from moving vehicles).
     Speed and over-speed (V2) are only in the speed box.
   * **No-parking kerbs (V3), 2026-10-28.** A no-parking strip, bus stop or parking bay drawn beside a road zone,
     outside its edge, belongs to that road zone: a vehicle standing in it is measured in the zone's coordinates
     (`violations/zones.py`, `KERB_AREAS`). Before, a vehicle outside every road zone was never checked, and KAK-01's
     kerb strips lie just outside its road zones (Auto zones' road edges end where moving traffic ends), so the CNGs
     waiting at its right kerb were never reported. A row of CNGs at a stand moves up each time the front one leaves:
     a V3 stand now continues while the vehicle stays within 10 m of where it first stopped (`creep_m`; before, every
     move of more than 2 m restarted the 20 s timer). A vehicle already reported is not reported again under a new
     track ID at the same spot (a parked motorbike and the man sitting on it boxed separately, or a bike hidden by a
     crowd for up to 30 s; V1, V3, V7). Full Part-2 on KAK-01: V3 0 -> 32, 31 of them at the right kerb by the market,
     which works as a CNG and ride-share motorbike stand (23 motorbikes, 8 CNGs, 1 car; the ones checked by eye were
     standing there). One is doubtful: a motorbike that crept 7 m in slow traffic in KAK-01's left "kerb" strip, which
     lies in the leftmost running lane. For fewer reports, raise the dwell in the camera's rules
     (`{"illegal_parking": {"dwell_sec": 40}}`).
6. **Admin > Fines**: the amounts are placeholders. Check them against the Road Transport Act 2018 and fill in the
   legal reference before real use.

### Test clip: every violation in one short video

The project's test clip `kakoli__TEST_violations_20260922_174605.mp4` (147 s, Part-2 from 590 s; the clock in the
name matches the video overlay; videos and the KAK-TEST camera are not part of this repository) in a `VIDEO_DIRS`
folder appears in the Video file list. Officer > **Surveillance** > **Other violations** box >
camera **Kakoli overpass - TEST zones (KAK-TEST)** (its default source is this clip) > **Start**. Every rule fires
once or more in about 7 minutes (RTX 2050, ~10 FPS with the camera-movement correction; run of 2026-10-27, 12 cases):

| Clip time | Rule | Vehicle | Real or test setting |
|---|---|---|---|
| 19.1 s | V1 bus outside a bus stop | Bus #1 at the East kerb, 10 s, 6 vehicles passed | real |
| 28.5 s | V6 no helmet | Motorbike #773 | real (the AI explanation says the front rider wears a helmet: check it) |
| 28.5-132.8 s | V5 solid lane line | Motorbikes #729, #5201, CNG #953 | **test lane line** (not painted on the road) |
| 29.9-143.2 s | V8 banned class | Bicycles #837, #1117, #5514, #5690 | **test ban** (Rickshaw / Bicycle / Van) |
| 61.7 s | V7 lane blocking | CNG #2077, 9 s mid-lane | **test threshold** (9 s, nobody needs to pass it; real: 20 s and 4 vehicles passing) |
| 136.6 s | V3 no-parking kerb | Motorbike #5211 waiting at the West kerb | **test threshold** (7 s, nobody needs to pass it; real: 20 s) |
| 141.1 s | V4 wrong side | Bicycle #5514 against the traffic on the right side | real |

Changes from the run before the 2026-10-27 update: CNG #341 (V7) is no longer reported: it stood in a queue, which the
team's updated queue check now sees. Motorbike #2020 (V6) is no longer reported (its riders wear helmets). The kerb
motorbike really waits ~20 s, but the tracker loses it for ~7 s at the bottom edge of the picture and gives it a new
ID, so the test threshold is 7 s (was 10 s). The footbridge camera sways 8-15 px (measured on the buildings): the
camera-movement correction keeps the zones on the road, at half the frame rate (`--no-stabilize` on the command
line turns it off).

The box shows the changed thresholds in orange under the rule list. Why test settings: the clip is short, and the
road has no solid lane line or banned class. With the real settings, the whole 15-min Part-2 on KAK-01's current
(auto-detected) zones gives V1 3, V3 32, V4 1, V6 about 6, V7 2 (2026-10-28; before the kerb and helmet changes
below: V3 0, V6 11). Do not use KAK-TEST for real tickets; KAK-01 (created with the real settings on first start)
is the camera for that.

### Demo flow

1. Officer: **Surveillance** > speed box > camera *Kakoli overpass* > video file Part-2 > **Start**.
   Violations appear on **Violations** as they happen (the table refreshes every 5 s).
2. **Check** a violation, type the plate if the reader is not sure, **Send ticket** (the owner must be in the vehicle
   registry, or type their email). The ticket email arrives in Mailpit.
3. Owner: sign in, **My cases** > **Pay the fine** > **Pay with SSLCommerz** (sandbox test card `4111 1111 1111
   1111`, `12/26`, CVC `111`, then the OTP page) or the **Test payment** tab (test card `4242 4242 4242 4242`, any
   future expiry and CVC; `4000 0000 0000 0002` is declined; wallets: any `01XXXXXXXXX` with a 4-5 digit PIN), or
   **Apply for Review**.
4. Officer: **Review requests** > accept (ticket cancelled) or reject (fine due again, at least 7 days).

## Code map

| Path | |
|---|---|
| `apps/backend/src/modules/traffic/` | traffic module: vision events ingest, violations, tickets (cases), reviews, payments + invoice PDF, mail, VLM, cameras / registry / fines, surveillance control, tracking, reports, audit, seed data |
| `apps/backend/src/schemas/traffic/` | MongoDB collections: cameras, violations, vehicles, fines, cases, reviews, payments, plate_sightings, surveillance_runs, tracked_vehicles (one row per Vehicle ID), audit_logs |
| `apps/backend/src/modules/traffic/vehicle-*.ts` | multi-camera tracking: matching rules and road-graph routes (`vehicle-matching.ts`, unit tests in `.spec.ts`), ID assignment, 2-hop and late records (`vehicle-identity.service.ts`), search and look-alikes (`vehicle-search.service.ts`) |
| `apps/backend/src/modules/traffic/appearance-index*.ts` | HNSW index of the vehicles' appearance vectors (pure TypeScript, tests in `.spec.ts`) and its service (built at start-up, kept up to date) |
| `apps/frontend/src/app/(protected)/(officer)/`, `(owner)/`, `(admin)/admin/` | the three portals |
| `apps/frontend/src/components/traffic/` | Check pop-up, surveillance box, zone editor, payment pop-up, vehicle finder, charts |
| `vision/server.py`, `vision/service/` | vision service: slots/runner, display redirection (MJPEG + logs), hooks (S3 + backend, retry outbox), plate collector, appearance vectors (`reid.py`) |
| `vision/pipelines/` | the detection scripts (copies, `[web]` changes) |
| `vision/models/` | `bd_vehicles_best.pt`, `helmet_cls.pt` (V6, from CSE499B), `plate_models/` (add BLPD's `LPD_Model.pt`, see "Run it") |
| `infra/` | start/stop of the local services, the local S3 key pair (development only), replica-set + bucket init |

Roles and permissions: `TRAFFIC_OFFICER` (rank 10) is seeded with `TRAFFIC:OFFICER, READ:VIOLATION, ISSUE:TICKET,
OPERATE:SURVEILLANCE, TRACK:VEHICLE, DECIDE:REVIEW, READ:REPORT`; admins get every permission, including
`MANAGE:CAMERA / VEHICLE / FINE` and `READ:AUDIT`.

## Known limits

* Multi-camera tracking has been tested on **one real camera view only**: there is no second Dhaka camera on the
  same road yet. The demo uses camera **KAK-SIM**, a copy of the TEST clip with another look (brightness, colour,
  noise) and a clock 90 s later (`kakoliN-SIM__TEST_violations_20260922_174735.mp4`), linked from KAK-TEST's
  far northbound gate. Measured against that known truth (each SIM vehicle is the TEST vehicle 90 s earlier):
  **93.9% of the IDs kept across the cameras went to the right vehicle, 78.6% of the vehicles that drove through
  kept their ID** (158 of 201); the misses mostly get a new ID, which is safer than a wrong one. A real second
  camera sees the vehicle from another angle and in other light, so expect lower numbers there; the same check
  should be repeated on real footage, and a vehicle ReID model trained on Dhaka vehicles would help (DINOv2 is a
  general model). Same camera: of 16 renumbered tracks checked by eye before the 0.80 bar, 2 were a neighbour
  in a queue (both scored under 0.80). A learned travel time per link (the paper's camera-link model) was tried:
  recall up to 85%, precision down to 89-91%; not used. Same test after the spec comparison (2026-10-29): in time
  order 93.8% / 78.1% (one link fewer: stricter one-to-one check); **KAK-SIM's records first, KAK-TEST's late**:
  94.9% / 82.1% (before: 0%, no ID carried over); through a camera that **missed every vehicle** (KAK-MID, test
  only, removed): 94.4% / 78.6% over two links (before: 0%). Look-alike search on the 42 vehicles whose ID did not
  carry over: the right vehicle first for 19, in the top 10 for 22. The look-alike index lives in the backend's
  memory and is built at start-up (~1.3 ms per vehicle: ~20 min for a million; at that size a native index such as
  Faiss / hnswlib or a vector database would replace it).
* Plate reads on the Dhaka footage are rarely "confirmed" (small, motion-blurred plates; confirmed needs a 50 px
  plate): officers type plates. The speed box reads only its violators' plates; the passed-vehicle list (and with it
  tracking by plate) covers the cameras the other-violations box has run on.
* The web system saves no whole annotated video: the script copies in `vision/pipelines/` have no `--save`, and their
  command-line `violation_tracker.py` writes no clip per violation (2026-10-28). The 15 s violation clips are made by
  the vision service instead, from recorded videos only (a live camera's past frames are gone). The boxes' live view
  is a stream, not a file. The project's original scripts (not in this repository) still have `--save`.
* Automatic zones are a starting point, not a measurement: on the Kakoli test clip they found both carriageways
  with the right directions and the kerbs (no junction or bus stop: the clip has none in view), but the camera's lens
  could only be estimated loosely (sizes about +-59%), so the speed box does not use automatic zones at all:
  measure a road zone's width and length for speed. With the learned zones and the
  real thresholds the test clip gives V1 1, V3 5 (the learned kerb strips reach where vehicles really stand), V4 1,
  V6 2; V5 and V8 need lane lines and banned classes added by hand. Each other-violation rule runs
  only where its zones exist (the box shows which are off).
  A camera's zone config may carry `rules` settings that replace the engine defaults (e.g.
  `{"road_blocking": {"dwell_sec": 30}}`); the box lists them.
* V6 (helmet) uses the CSE499B helmet classifier `vision/models/helmet_cls.pt` (copied from its `models/`; one crop
  per motorbike -> P(someone on it is bare-headed)). On this camera it is the weak link: it gives P 0.9-1.0 to many
  riders in plainly visible helmets. Checked 2026-10-28 on every motorbike of Part-1 and three Part-2 stretches
  (reported tracks labelled by eye): with the original settings Part-1 (18 min) gave 85 cases, 48 of them clearly
  helmeted and 1 clearly bare-headed. Changes in `violations/helmet.py`: only motorbikes coming toward the camera
  are judged (from behind the driver is hidden by the pillion and a black helmet looks like hair: no away-from-camera
  case was a confirmed bare head), only inside a road zone (not in a kerb strip among pavement crowds), and 4
  sightings with 3/4 of them bare instead of 3 with half. Part-1: 85 -> 16 cases (helmeted 48 -> 7); full Part-2:
  11 -> about 6 (both real bare-headed pillions kept, 3-4 helmeted riders still flagged, at P 1.0). Bare-headed
  riders going away from the camera are no longer caught (setting `directions`). Tried and rejected: fine-tuning the
  classifier with this camera's crops (it learned "this camera = helmet" and caught nothing), the local VLM as a
  second check (it answered "helmet" for every crop, bare heads included), a tighter crop. The real fix is a
  classifier trained on labelled crops of this camera with many bare-headed riders (in Part-1 only one rider was
  clearly bare-headed at this resolution, too few to train on); keep checking each V6 photo before ticketing.
* Speeds are not yet validated against ground truth, and the Part-2 zone sizes were not recorded as measured.
* 8 GB RAM: a long violation scan next to the dev servers can run out of memory (OpenCV "Insufficient memory");
  MongoDB was killed once that way. Re-run `infra\start-infra.ps1` (it starts only what is down).
