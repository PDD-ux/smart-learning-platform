"""Real OCR regression: persist all blocks, fingerprints, timings and manual ROI CER."""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys
import time
from datetime import datetime, timezone
from pathlib import Path


def fingerprint(path: Path) -> dict:
    return {"name": path.name, "sha256": hashlib.sha256(path.read_bytes()).hexdigest()}


def normalized(text: str) -> str:
    return "".join(character for character in text if character.isalnum())


def distance(expected: str, actual: str) -> int:
    previous = list(range(len(actual) + 1))
    for row, character in enumerate(expected, 1):
        current = [row]
        for column, candidate in enumerate(actual, 1):
            current.append(min(current[-1] + 1, previous[column] + 1,
                               previous[column - 1] + (character != candidate)))
        previous = current
    return previous[-1]


def evaluate(rows: list, manifest: dict) -> list:
    evaluated = []
    for region in manifest["regions"]:
        for row in rows:
            if row["frame"] != region["frame"]:
                continue
            x0, y0, x1, y1 = region["roi"]
            blocks = [block for block in row["blocks"]
                      if x0 <= block["bbox"][0] + block["bbox"][2] / 2 <= x1
                      and y0 <= block["bbox"][1] + block["bbox"][3] / 2 <= y1]
            actual = "".join(block["text"] for block in sorted(blocks, key=lambda block: block["bbox"][0]))
            expected = normalized(region["text"])
            errors = distance(expected, normalized(actual))
            evaluated.append({**region, "round": row["round"], "actual": actual,
                              "characters": len(expected), "errors": errors, "cer": errors / len(expected)})
    return evaluated


def main() -> int:
    root = Path(__file__).resolve().parents[2]
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--service-dir", type=Path, default=root / "services/mindspore-infer")
    parser.add_argument("--frames-dir", type=Path, default=root / ".taskbook-working/video-infer-diagnostic-20261003")
    parser.add_argument("--extra-frame", type=Path, action="append", default=[])
    parser.add_argument("--model-dir", type=Path, required=True)
    parser.add_argument("--rounds", type=int, default=2)
    parser.add_argument("--regions", type=Path, default=Path(__file__).with_name("ocr-quality-regions.json"))
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    if args.rounds < 1:
        parser.error("rounds must be positive")
    frames = sorted(args.frames_dir.glob("frame_*.jpg")) + args.extra_frame
    if not frames:
        parser.error("sample frames are required")
    manifest = json.loads(args.regions.read_text(encoding="utf-8"))
    report = {"checkedAtUtc": datetime.now(timezone.utc).isoformat(), "status": "running",
              "device": "ascend", "mock": False, "ocrFallbackEnabled": False,
              "source": fingerprint(args.service_dir / "ocr_runtime.py"),
              "regions": fingerprint(args.regions), "frames": [fingerprint(path) for path in frames],
              "models": [fingerprint(args.model_dir / name) for name in
                         ("db_r50_icdar15-ch.mindir", "crnn_resnet34_ch.mindir", "cls_mv3.mindir", "ch_dict.txt")],
              "results": [], "qualityAcceptance": "Partial manually transcribed regions only; not whole-product acceptance"}
    args.output.parent.mkdir(parents=True, exist_ok=True)

    def save() -> None:
        report["evaluation"] = evaluate(report["results"], manifest)
        args.output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    save()
    os.environ.update(ASCEND_DEVICE="ascend", INFER_MOCK="false", OCR_FALLBACK_ENABLED="false",
                      INFER_MODEL_DIR=str(args.model_dir.resolve()))
    sys.path.insert(0, str(args.service_dir))
    try:
        from PIL import Image
        from ocr_runtime import OcrEngine
        start = time.perf_counter()
        engine = OcrEngine()
        engine.detect_and_recognize(Image.new("RGB", (1280, 736), "white"))
        # Force both recognition models to load even if the blank detector returns no boxes.
        from ocr_runtime import _recognition_input
        engine.recognizer.predict(_recognition_input(engine._orient(Image.new("RGB", (320, 32), "white"))))
        report["prewarmMs"] = round((time.perf_counter() - start) * 1000, 3)
        save()
        for round_number in range(1, args.rounds + 1):
            for path in frames:
                image = Image.open(path).convert("RGB")
                start = time.perf_counter()
                blocks = engine.detect_and_recognize(image)
                report["results"].append({"round": round_number, "frame": path.name,
                                          "ocrMs": round((time.perf_counter() - start) * 1000, 3),
                                          "blocks": [block.model_dump() for block in blocks]})
                save()
            print(f"round {round_number}: {len(frames)} frames", flush=True)
        report["status"] = "executed"
        save()
        return 0
    except Exception as error:
        report.update(status="failed", errorType=type(error).__name__)
        save()
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
