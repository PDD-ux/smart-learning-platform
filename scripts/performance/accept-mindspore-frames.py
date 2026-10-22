"""§10.4 target-host acceptance: real Lite models, no mock or OCR fallback.

Run in a fresh process on the model host. This records direct model results;
it does not claim network, Next.js gateway, accuracy or full-video acceptance.
"""
from __future__ import annotations

import argparse
import base64
import hashlib
import importlib.util
import json
import os
import platform
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, List


def fingerprint(path: Path) -> Dict[str, object]:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return {"name": path.name, "bytes": path.stat().st_size, "sha256": digest.hexdigest()}


def save_report(path: Path, report: Dict[str, object]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def main() -> int:
    root = Path(__file__).resolve().parents[2]
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--frames-dir", type=Path, default=root / ".taskbook-working/video-infer-diagnostic-20261003")
    parser.add_argument("--model-dir", type=Path, default=root / "services/mindspore-infer/models")
    parser.add_argument("--device", choices=("cpu", "gpu", "ascend"), default="ascend")
    parser.add_argument("--rounds", type=int, default=2)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    if args.rounds < 1:
        parser.error("--rounds must be >= 1")

    frames = sorted(args.frames_dir.glob("frame_*.jpg"))
    assets = ("keyframe_classifier_v3_balanced.mindir", "db_r50_icdar15-ch.mindir",
              "crnn_resnet34_ch.mindir", "cls_mv3.mindir", "ch_dict.txt")
    service = root / "services/mindspore-infer"
    report: Dict[str, object] = {
        "checkedAtUtc": datetime.now(timezone.utc).isoformat(),
        "python": sys.executable, "pythonVersion": platform.python_version(),
        "platform": platform.platform(), "device": args.device,
        "mock": False, "ocrFallbackEnabled": False,
        "status": "blocked", "scope": "direct-model-multi-frame",
        "frames": [fingerprint(path) for path in frames],
        "models": [fingerprint(args.model_dir / name) for name in assets if (args.model_dir / name).is_file()],
        "sources": [fingerprint(service / name) for name in (
            "inference.py", "model_runtime.py", "ocr_runtime.py", "warmup.py", "config.py")],
        "results": [],
    }
    missing = [name for name in assets if not (args.model_dir / name).is_file()]
    runtime = importlib.util.find_spec("mindspore_lite") is not None
    report["mindsporeLiteFound"] = runtime
    report["missingAssets"] = missing
    exit_code = 2
    if not frames or missing or not runtime:
        report["reason"] = "Requires sample frames, all five assets and mindspore_lite in this interpreter"
    else:
        # Set before importing config; never modify the host's .env or running service.
        os.environ.update({"ASCEND_DEVICE": args.device, "INFER_MODEL_DIR": str(args.model_dir.resolve()),
                           "INFER_MOCK": "false", "OCR_FALLBACK_ENABLED": "false", "INFER_PREWARM": "true"})
        sys.path.insert(0, str(service))
        results: List[Dict[str, object]] = []
        report["results"] = results
        try:
            import mindspore_lite
            from PIL import Image
            from inference import CLASSIFIER, _classifier_input, _category_from_logits
            from ocr_runtime import get_ocr_engine
            from schemas import FrameInput
            from frame_quality import quality_select_frames
            from warmup import prewarm_models

            report["status"] = "running"
            report["liteVersion"] = getattr(mindspore_lite, "__version__", "unreported")
            report["stage"] = "prewarm"
            save_report(args.output, report)
            started = time.perf_counter()
            prewarm_models()
            report["prewarmMs"] = round((time.perf_counter() - started) * 1000, 3)
            engine = get_ocr_engine()
            for round_index in range(args.rounds):
                for index, path in enumerate(frames):
                    row: Dict[str, object] = {"round": round_index + 1, "frame": path.name}
                    results.append(row)
                    report["stage"] = "classify"
                    save_report(args.output, report)
                    with Image.open(path) as opened:
                        image = opened.convert("RGB")
                    started = time.perf_counter()
                    row["category"] = _category_from_logits(CLASSIFIER.predict(_classifier_input(image)))
                    row["classifyMs"] = round((time.perf_counter() - started) * 1000, 3)
                    report["stage"] = "ocr"
                    save_report(args.output, report)
                    started = time.perf_counter()
                    # Call the real engine directly: errors propagate, Tesseract cannot mask them.
                    blocks = engine.detect_and_recognize(image)
                    row["ocrMs"] = round((time.perf_counter() - started) * 1000, 3)
                    row["blocks"] = [block.model_dump() for block in blocks]
                    frame = FrameInput(frameIndex=index, imageBase64=base64.b64encode(path.read_bytes()).decode("ascii"))
                    row["selection"] = [item.model_dump() for item in quality_select_frames([frame], 1)]
                    save_report(args.output, report)
            report["status"] = "executed"
            report["stage"] = "complete"
            report["reason"] = "Real model execution completed; inspect text manually. No accuracy or network claim."
            exit_code = 0
        except Exception as error:
            report["status"] = "failed"
            # Exception text may contain private paths/configuration; save only type and failed row.
            report["errorType"] = type(error).__name__
            exit_code = 1
    save_report(args.output, report)
    print(json.dumps({"status": report["status"], "exitCode": exit_code,
                      "frameCount": len(frames), "mindsporeLiteFound": runtime,
                      "report": str(args.output)}, ensure_ascii=False))
    return exit_code


if __name__ == "__main__":
    sys.exit(main())
