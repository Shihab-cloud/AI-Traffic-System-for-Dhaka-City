"""Violation explanations by a vision-language model running on this computer (no internet, no API): Qwen3.5-2B
(Apache-2.0) in 4-bit on the GPU, ~2 GB GPU memory, 10-25 s per explanation on the RTX 2050.

Loaded on the first request (~15 s) and unloaded after VLM_IDLE_MIN minutes without one, so the surveillance boxes get
the memory back. One explanation at a time. The prompt is the backend's Claude prompt plus what each rule means and
what the images can show (tested on one violation of each type, 2026-10-24: 8/8 valid answers, 6/8 judgements right;
both wrong ones argued with the speed printed on the evidence image, which is now hidden from the model).
"""

import base64
import gc
import json
import os
import re
import tempfile
import threading
import time
from pathlib import Path

import cv2
import numpy as np
import torch
from PIL import Image

from . import config
from .hooks import label_rect, scene_label_org, violation_label
from .runner import free_memory_mb

MODEL = config.env("VLM_MODEL", "Qwen/Qwen3.5-2B")
IDLE_MIN = float(config.env("VLM_IDLE_MIN", "10"))
# Weights come from the local Hugging Face cache only; download once with
#   python -c "from huggingface_hub import snapshot_download; snapshot_download('Qwen/Qwen3.5-2B')"
LOCAL_ONLY = config.env("VLM_LOCAL_FILES_ONLY", "1") != "0"
LOAD_FREE_MB = 3072   # commit headroom needed to load (weights pass through RAM while they are quantized)

SYSTEM = """You help traffic officers in Dhaka, Bangladesh review violations that an automatic camera system detected. You get the evidence photos (in the scene photo, the vehicle the system flagged is boxed in red and its recent path drawn in yellow), when there is one frames of the violation video (the same vehicle boxed in red over time), and the measurements the system recorded. The officer reads your answer before deciding whether to send a ticket to the vehicle owner.

Fill in:
- explanation: 2 to 4 plain sentences on what the images show and how that relates to the recorded violation. Speeds come from a calibrated road zone and cannot be judged from a still image: use the recorded numbers as given, and say what the images can and cannot confirm.
- supports_violation: "yes" if the images are consistent with the recorded violation, "no" if they contradict it (for example the red box is not on a vehicle, or the vehicle is clearly of another type), "unclear" if they cannot tell.
- vehicle_description: type, colour and visible markings of the flagged vehicle.
- concerns: what the officer should check before ticketing (blur, occlusion, box on the wrong vehicle, plate not legible, vehicle type mismatch). An empty list if nothing.

Do not read out plate characters that are not clearly legible in the images; the plate reader's own result and its confidence are given with the data."""

# What each rule means and what a still image can confirm.
GUIDE = {
    "V1": "A bus standing (10 s or more) outside an approved bus stop while other traffic passes it. The images can show whether it is a bus standing at the roadside with people around it; the standing time and passing traffic come from the recorded data.",
    "V2": "Over the speed limit, measured over a calibrated road zone. A still image can neither confirm nor contradict a speed, so judge only the red box: supports_violation is \"yes\" if it is on a motor vehicle, \"no\" only if it is not on a vehicle. If the vehicle type differs from the recorded class, say so under concerns: the speed measurement still stands.",
    "V3": "Standing at a marked no-parking kerb longer than allowed. The images can show whether the vehicle stands at the road edge; the time comes from the recorded data.",
    "V4": "Driving against the allowed direction of a one-way carriageway. A still image cannot show direction (the yellow line is its recent path). Check the vehicle type and that the box is on it.",
    "V5": "Crossing a solid lane line. Check that the box is on a vehicle and the yellow path crosses toward another lane.",
    "V6": "A motorbike rider without a helmet. Look closely at the head of the rider (the person driving) in the close-up: if the rider wears a helmet, the images contradict the violation (supports_violation \"no\").",
    "V7": "Standing still in a running traffic lane while other traffic passes. Check that the vehicle is in a lane, not at the kerb.",
    "V8": "A vehicle class that is banned on this road (bicycles, rickshaws and pedal vans count as vehicles). supports_violation is \"yes\" if the vehicle is of the recorded class, \"no\" only if it is clearly another type.",
}
# The detector's Bangladeshi class names (bd_vehicles_best.pt), for the model.
CLASSES = {
    "Bus": "a bus or minibus",
    "Bhotbhoti": "a locally made motor cart (nosimon / korimon)",
    "Car": "a sedan, hatchback or SUV",
    "CNG": "a three-wheeled CNG auto-rickshaw with a metal cage body, usually green",
    "Easybike": "a battery-powered three-wheeled auto-rickshaw",
    "Leguna": "a small covered human hauler (passengers sit in the back)",
    "MPV": "a boxy microbus or van such as a Toyota Hiace or Noah",
    "Pickup": "a pickup truck with an open cargo bed",
    "PowerTiller": "a tractor-like power tiller vehicle",
    "Rickshaw": "a pedal cycle rickshaw with a passenger seat",
    "Van": "a pedal flatbed rickshaw van carrying goods",
    "Wheelbarrow": "a hand-pushed cart",
}
TAIL = ("\n\nRule {code}: {guide}\n{cls}{mismatch}Never write plate characters yourself: only quote the plate reader's "
        "result. Do not comment on speeds unless the violation is about speed. The vehicle owner may read your answer: "
        "refer to the scene photo, the close-up and the video by what they show, never by number.{video}")
# With a clip: what the frames are for. Rules about a moving vehicle get frames a second apart around the violation
# (the vehicle is close and boxed there); rules about standing get them spread over the stand. First try (2026-10-28,
# bus #1971 over the limit, frames 3 s apart from -9 s, the bus far away and not yet boxed in the early ones): the
# model said it was "stopped or moving very slowly": a speed is never judged from the frames, and such sentences are
# removed from over-speed answers (tidy).
MOVING_RULES = {"V2", "V4", "V5"}
VIDEO_TAIL = {
    "moving": (" The video frames, a second apart, show the boxed vehicle around the violation: say in one sentence "
               "where it is and which way it goes. Do not judge its speed from them: the speed was measured over the "
               "calibrated road zone."),
    "standing": (" The video frames, a few seconds apart, show the boxed vehicle before and at the violation: say in "
                 "one sentence whether it stays in the same place."),
}
CLIP_FRAMES_S = {"moving": (-2, -1, 0, 1, 2), "standing": (-9, -6, -3, 0, 2)}   # seconds from the violation
CLIP_FRAME_WIDTH = 768   # ~450 image tokens each
MISMATCH = ("If the vehicle in the close-up is clearly a different type from the recorded class, the images contradict "
            "the violation. ")
# Rules a single look at the close-up decides. Asked first, on its own: in the long answer the 2B model describes the
# helmet correctly and still "supports" the violation. The answer goes into the prompt as a fact and sets the verdict.
# A choice of answers instead of yes/no: small models lean to "yes".
VISUAL_CHECKS = {
    "V6": ("Look at this close-up of a motorbike. What is on the head of the person driving it (the front rider)? "
           "Answer with one word: helmet, hair, cap or unclear.",
           {"helmet": ("the person driving appears to wear a helmet, which contradicts this violation", "no"),
            "hair": ("the person driving does not appear to wear a helmet (bare head)", "yes"),
            "cap": ("the person driving wears a cap, not a helmet", "yes"),
            "unclear": ("the close-up does not show clearly whether the person driving wears a helmet", "unclear")}),
}
ANSWER = ('Answer with one JSON object only: {"explanation": "...", "supports_violation": "yes|no|unclear", '
          '"vehicle_description": "...", "concerns": ["..."]}')

# Two-word look of a vehicle for the passed-vehicle list ("white car", "grey SUV", "green CNG"): the colour from the
# model, the type from the detector's class, which knows Bangladeshi vehicles better. Asked for colour and type
# itself, the model called CNGs "green motorbike", a grey SUV "silver microbus", a bus "green truck"; asked only the
# colour (with the class), it got the cars, buses, CNGs and microbuses right; it is asked car or SUV too, because the
# detector's "Car" is both (TEST clip, 24 vehicles, 2026-10-28; ~0.5 s per vehicle, ~1 s for a car). Motorbikes: the
# rider covers the bike, so the model is told to ignore the clothes; their colours are the least reliable.
TYPE_WORDS = {"Bicycle": "bicycle", "Bus": "bus", "Bhotbhoti": "bhotbhoti", "Car": "car", "CNG": "CNG",
              "Easybike": "easybike", "Leguna": "leguna", "Motorbike": "motorbike", "MPV": "microbus",
              "Pickup": "pickup", "PowerTiller": "power tiller", "Rickshaw": "rickshaw", "Truck": "truck",
              "Van": "rickshaw van", "Wheelbarrow": "handcart"}
COLOUR_QUESTION = "What is the main body colour of this vehicle ({gloss})? Answer with one colour word."
BIKE_COLOUR_QUESTION = ("What colour is the motorbike itself (its fuel tank and body panels), not the rider's clothes? "
                        "Answer with one colour word.")
CAR_QUESTION = "Is this car an SUV, a sedan or a hatchback? Answer with one word."
COLOURS = {"white", "black", "grey", "silver", "red", "maroon", "blue", "green", "yellow", "orange", "brown", "golden",
           "beige", "purple", "pink", "cream"}
COLOUR_FIX = {"gray": "grey", "gold": "golden", "navy": "blue", "teal": "green", "olive": "green", "tan": "beige"}


class VlmError(Exception):
    """A problem worth showing to the officer as it is (out of memory, model missing)."""


def _decode(b64):
    img = cv2.imdecode(np.frombuffer(base64.b64decode(b64), np.uint8), cv2.IMREAD_COLOR)
    if img is None:
        raise ValueError("An evidence image could not be read")
    return img


def hide_label(scene, case):
    """The scene image without the red label above the vehicle ("V3 ...: Motorbike #20 2 km/h"): the model reads
    track numbers and speeds there and argues with them. Same geometry as hooks.scene_image, scaled to the stored
    image; the strip is painted in from its surroundings."""
    frame_size, bbox = case.get("frameSize"), case.get("bbox")
    if not frame_size or not bbox:
        return scene
    label = violation_label(case["code"], case["title"], case["vehicleClass"], case.get("trackId"), case.get("kph"))
    if case.get("kph") is not None and case["code"] != "V2":  # cases stored before 2026-10-27 show it on every rule
        label += f" {case['kph']:.0f} km/h"
    org, scale = scene_label_org(bbox, frame_size[1])
    s = scene.shape[1] / frame_size[0]
    x1, y1, x2, y2 = (round(v * s) for v in label_rect(label, org, scale))
    mask = np.zeros(scene.shape[:2], np.uint8)
    mask[max(0, y1 - 2):max(0, y2 + 2), max(0, x1 - 2):max(0, x2 + 2)] = 255
    return cv2.inpaint(scene, mask, 5, cv2.INPAINT_TELEA)


def model_image(img, kind):
    """BGR -> PIL for the model: the scene at 1024 px wide (~600 image tokens, enough for the boxed vehicle), small
    close-ups enlarged so the shorter side is at least 336 px."""
    h, w = img.shape[:2]
    if kind == "scene" and w > 1024:
        img = cv2.resize(img, (1024, round(h * 1024 / w)), interpolation=cv2.INTER_AREA)
    elif kind != "scene" and min(h, w) < 336:
        f = 336 / min(h, w)
        img = cv2.resize(img, (round(w * f), round(h * f)), interpolation=cv2.INTER_CUBIC)
    return Image.fromarray(cv2.cvtColor(img, cv2.COLOR_BGR2RGB))


def clip_frames(clip, times):
    """[(caption, PIL image)]: frames of the violation clip (S3 key; atS / fromS: video times of the violation and of
    the clip's start) at `times` (seconds from the violation)."""
    from .clips import s3_client
    data = s3_client().get_object(Bucket=config.S3_BUCKET, Key=clip["key"])["Body"].read()
    fd, name = tempfile.mkstemp(suffix=".mp4")
    os.close(fd)
    out = []
    try:
        Path(name).write_bytes(data)
        cap = cv2.VideoCapture(name)
        at = float(clip.get("atS") or 0) - float(clip.get("fromS") or 0)   # the violation, in clip time
        for dt in times:
            if at + dt < 0:
                continue
            cap.set(cv2.CAP_PROP_POS_MSEC, (at + dt) * 1000)
            ok, frame = cap.read()
            if not ok:
                continue
            h, w = frame.shape[:2]
            frame = cv2.resize(frame, (CLIP_FRAME_WIDTH, round(h * CLIP_FRAME_WIDTH / w)), interpolation=cv2.INTER_AREA)
            when = ("at the violation moment" if dt == 0 else f"{-dt} s before the violation" if dt < 0
                    else f"{dt} s after the violation")
            out.append((f"Video frame {when}", Image.fromarray(cv2.cvtColor(frame, cv2.COLOR_BGR2RGB))))
        cap.release()
    finally:
        Path(name).unlink(missing_ok=True)
    return out


def _sentences(text):
    return [s for s in re.split(r"(?<=[.!?])\s+", text.strip()) if s]


SPEED_TALK = re.compile(r"km/h|\bspeed", re.I)
PLATE_TALK = re.compile(r"plate|registration|licen[cs]e|number", re.I)
# Over-speed answers: a photo or a few frames cannot show that a vehicle was stopped or slow (see VIDEO_TAIL).
STILL_TALK = re.compile(r"\bstop(ped|s)?\b|stationary|standing still|not moving|\bslow(ly)?\b|parked|at rest|"
                        r"\bidle\b", re.I)


NO_PLATE = {"Bicycle", "Rickshaw", "Van", "Wheelbarrow", "Pedestrian"}   # pedal vehicles carry no number plate


def tidy(answer, code, cls):
    """Checks the model's JSON and removes what it should not say: speeds when the violation is not about speed, plate
    text in the vehicle description (it copies the plate reader's guess as if it had read the plate itself), "no plate
    found" on a bicycle."""
    explanation = str(answer.get("explanation") or "").strip()
    concerns = [str(c).strip() for c in answer.get("concerns") or [] if str(c).strip()]
    off_topic = [SPEED_TALK] if code != "V2" else [STILL_TALK]
    if cls in NO_PLATE:
        off_topic.append(PLATE_TALK)
    for pattern in off_topic:
        explanation = " ".join(s for s in _sentences(explanation) if not pattern.search(s)) or explanation
        concerns = [c for c in concerns if not pattern.search(c)]
    vehicle = ", ".join(p for p in re.split(r",\s*|;\s*", str(answer.get("vehicle_description") or ""))
                        if p and not PLATE_TALK.search(p)).strip(" .")
    verdict = str(answer.get("supports_violation") or "").strip().lower()
    return {"explanation": explanation, "supports_violation": verdict if verdict in ("yes", "no", "unclear") else "unclear",
            "vehicle_description": vehicle, "concerns": concerns}


class LocalVlm:
    def __init__(self):
        self.lock = threading.Lock()
        self.model = self.processor = None
        self.last_used = 0.0
        threading.Thread(target=self._unload_when_idle, daemon=True, name="vlm-idle").start()

    def status(self):
        return {"model": MODEL, "loaded": self.model is not None, "idleUnloadMin": IDLE_MIN}

    def _load(self):
        if self.model is not None:
            return
        if not torch.cuda.is_available():
            raise VlmError("The explanation model needs the GPU (CUDA not available)")
        free = free_memory_mb()
        if free < LOAD_FREE_MB:
            raise VlmError(f"Not enough free memory to load the explanation model ({free / 1024:.1f} GB left, it "
                           f"needs {LOAD_FREE_MB / 1024:.0f} GB). Close Chrome tabs or stop a box, then try again.")
        from transformers import AutoModelForImageTextToText, AutoProcessor, BitsAndBytesConfig
        q4 = BitsAndBytesConfig(load_in_4bit=True, bnb_4bit_quant_type="nf4", bnb_4bit_compute_dtype=torch.float16,
                                bnb_4bit_use_double_quant=True)
        t = time.time()
        try:
            self.processor = AutoProcessor.from_pretrained(MODEL, local_files_only=LOCAL_ONLY)
            self.model = AutoModelForImageTextToText.from_pretrained(
                MODEL, device_map="cuda", low_cpu_mem_usage=True, quantization_config=q4,
                local_files_only=LOCAL_ONLY).eval()
        except OSError as e:
            self._unload()
            if "1455" in str(e) or "paging file" in str(e).lower():
                raise VlmError("Out of memory while loading the explanation model: close Chrome tabs or stop a box, "
                               "then try again") from e
            raise VlmError(f"Explanation model {MODEL} not found in the local model cache: download it once (see "
                           "vision/service/vlm.py)") from e
        print(f"[vlm] {MODEL} loaded in {time.time() - t:.0f} s, GPU {torch.cuda.memory_allocated() / 2**30:.1f} GB",
              flush=True)

    def _unload(self):
        self.model = self.processor = None
        gc.collect()
        if torch.cuda.is_available():
            torch.cuda.empty_cache()

    def _unload_when_idle(self):
        while True:
            time.sleep(30)
            if self.model is not None and time.time() - self.last_used > IDLE_MIN * 60:
                with self.lock:
                    if self.model is not None and time.time() - self.last_used > IDLE_MIN * 60:
                        self._unload()
                        print(f"[vlm] unloaded after {IDLE_MIN:g} min idle", flush=True)

    @staticmethod
    def _images(case):
        """[(kind, caption, PIL image)] for the scene and the close-up, as the model gets them."""
        images = []
        for im in case["images"]:
            if im["kind"] in ("scene", "closeup"):
                img = _decode(im["data"])
                if im["kind"] == "scene":
                    img = hide_label(img, case)
                images.append((im["kind"], im.get("caption") or im["kind"], model_image(img, im["kind"])))
        if not images:
            raise ValueError("No scene or close-up image to explain")
        return images

    def _generate(self, messages, max_new_tokens):
        inputs = self.processor.apply_chat_template(
            messages, tokenize=True, add_generation_prompt=True, return_dict=True, return_tensors="pt",
            enable_thinking=False).to(self.model.device)
        with torch.inference_mode():
            out = self.model.generate(**inputs, max_new_tokens=max_new_tokens, do_sample=False,
                                      repetition_penalty=1.05)
        return self.processor.decode(out[0, inputs["input_ids"].shape[1]:], skip_special_tokens=True).strip()

    def _visual_check(self, case, images):
        """(fact for the prompt, forced verdict or None); None when the rule has no check or the answer is unclear."""
        check = VISUAL_CHECKS.get(case["code"])
        closeup = next((img for kind, _, img in images if kind == "closeup"), None)
        if not check or closeup is None:
            return None
        question, outcomes = check
        answer = self._generate([{"role": "user", "content": [{"type": "image", "image": closeup},
                                                              {"type": "text", "text": question}]}], 4)
        word = re.sub(r"[^a-z]", "", answer.lower().split()[0]) if answer.split() else ""
        print(f"[vlm] {case['code']} #{case.get('trackId')} visual check: {answer!r}", flush=True)
        return outcomes.get(word)

    @staticmethod
    def _messages(case, images, check, frames=()):
        code = case["code"]
        content = []
        for kind, caption, img in images:
            content += [{"type": "text", "text": f"{'Scene photo' if kind == 'scene' else 'Close-up photo'}: {caption}"},
                        {"type": "image", "image": img}]
        for caption, img in frames:
            content += [{"type": "text", "text": caption}, {"type": "image", "image": img}]
        gloss = CLASSES.get(case["vehicleClass"])
        cls = f'The recorded class "{case["vehicleClass"]}" means {gloss}.\n' if gloss else ""
        guide = GUIDE.get(code, case["title"])
        facts = case["facts"] + (f"\nVisual check of the close-up: {check[0]}." if check else "")
        motion = "moving" if code in MOVING_RULES else "standing"
        tail = TAIL.format(code=code, guide=guide, cls=cls, mismatch="" if code == "V2" else MISMATCH,
                           video=VIDEO_TAIL[motion] if frames else "")
        content.append({"type": "text", "text": facts + tail + "\n\n" + ANSWER})
        return [{"role": "system", "content": [{"type": "text", "text": SYSTEM}]},
                {"role": "user", "content": content}]

    def explain(self, case):
        """case: code, title, vehicleClass, trackId, kph, bbox, frameSize, facts (text), images [{kind, caption,
        data (base64 JPEG)}], clip (optional: key, atS, fromS). Returns the backend's explanation fields."""
        images = self._images(case)
        frames = []
        if case.get("clip"):
            try:
                frames = clip_frames(case["clip"],
                                     CLIP_FRAMES_S["moving" if case["code"] in MOVING_RULES else "standing"])
            except Exception as e:   # explain from the photos alone
                print(f"[vlm] clip frames not read: {e!r}", flush=True)
        with self.lock:
            self._load()
            self.last_used = time.time()
            t = time.time()
            try:
                check = self._visual_check(case, images)
                text = self._generate(self._messages(case, images, check, frames), 320)
            except (MemoryError, torch.cuda.OutOfMemoryError):
                torch.cuda.empty_cache()
                raise VlmError("Out of memory while explaining: stop a box or close Chrome tabs, then try again") \
                    from None
            finally:
                self.last_used = time.time()
        m = re.search(r"\{.*\}", text, re.S)
        try:
            answer = json.loads(m.group(0)) if m else None
        except json.JSONDecodeError:
            answer = None
        if not isinstance(answer, dict):
            raise VlmError(f"The model did not answer in the expected format: {text[:200]}")
        result = tidy(answer, case["code"], case["vehicleClass"])
        dropped = [s for s in _sentences(str(answer.get("explanation") or "")) if s not in result["explanation"]]
        if dropped:
            print(f"[vlm] {case['code']} #{case.get('trackId')}: left out {dropped}", flush=True)
        if check and check[1]:
            result["supports_violation"] = check[1]
        return {**result, "model": MODEL, "seconds": round(time.time() - t, 1), "videoFrames": len(frames)}

    def describe(self, vehicles):
        """[(vehicle image BGR, detector class)] -> two words each for the passed-vehicle list, e.g. "grey SUV"
        (just the type when the colour answer is not a colour)."""
        out = []
        with self.lock:
            self._load()
            try:
                for img, cls in vehicles:
                    image = model_image(img, "closeup")
                    ask = lambda q: self._generate(  # noqa: E731
                        [{"role": "user", "content": [{"type": "image", "image": image}, {"type": "text", "text": q}]}], 3)
                    self.last_used = time.time()
                    gloss = CLASSES.get(cls) or f"a {TYPE_WORDS.get(cls, cls or 'vehicle').lower()}"
                    words = re.findall(r"[a-z]+", ask(BIKE_COLOUR_QUESTION if cls == "Motorbike"
                                                      else COLOUR_QUESTION.format(gloss=gloss)).lower())
                    colour = COLOUR_FIX.get(words[0], words[0]) if words else ""
                    kind = TYPE_WORDS.get(cls, (cls or "vehicle").lower())
                    if cls == "Car" and "suv" in ask(CAR_QUESTION).lower():
                        kind = "SUV"
                    out.append(f"{colour} {kind}" if colour in COLOURS else kind)
            except (MemoryError, torch.cuda.OutOfMemoryError):
                torch.cuda.empty_cache()
                raise VlmError("Out of memory while describing vehicles: stop a box or close Chrome tabs") from None
            finally:
                self.last_used = time.time()
        return out
