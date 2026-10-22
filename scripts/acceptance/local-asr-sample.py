"""Bounded offline CPU ASR diagnostic; never writes learning data or calls cloud ASR."""
from __future__ import annotations

import argparse
import hashlib
import json
import math
from pathlib import Path
import socket
import time
import wave


import importlib.util
_timing_spec = importlib.util.spec_from_file_location("asr_timing", Path(__file__).resolve().parents[2] / "services/local-asr/timing.py")
assert _timing_spec and _timing_spec.loader
_timing = importlib.util.module_from_spec(_timing_spec)
_timing_spec.loader.exec_module(_timing)
validate_timestamps = _timing.validate_timestamps

def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--audio", type=Path, required=True)
    parser.add_argument("--offset-seconds", type=int, required=True, help="Actual source video cut start; never inferred from text")
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    if args.output.exists() or args.offset_seconds < 0:
        parser.error("Fresh output and nonnegative source offset required")
    args.output.parent.mkdir(parents=True, exist_ok=True)
    root = Path(__file__).resolve().parents[2]
    model_dir = root / ".taskbook-working/local-asr/model"
    # Model is a fixed local ONNX graph; no remote model code or cloud audio upload.
    from importlib.util import spec_from_file_location, module_from_spec
    spec = spec_from_file_location("asr_assets", Path(__file__).with_name("local-asr-download.py"))
    assert spec and spec.loader
    assets = module_from_spec(spec)
    spec.loader.exec_module(assets)
    for name, expected in assets.FILES.items():
        if hashlib.sha256((model_dir / name).read_bytes()).hexdigest() != expected:
            raise ValueError("Unverified model asset")
    with wave.open(str(args.audio), "rb") as audio:
        if audio.getframerate() != 16000 or audio.getnchannels() != 1 or audio.getsampwidth() != 2:
            parser.error("16kHz mono PCM16 WAV required")
        duration = audio.getnframes() / audio.getframerate()
    if not 0 < duration <= 60:
        parser.error("Only audio samples up to 60 seconds allowed")
    report = {"status": "running", "scope": "offline sample only; no product integration",
              "audioSeconds": duration, "sourceOffsetSeconds": args.offset_seconds,
              "audioSha256": hashlib.sha256(args.audio.read_bytes()).hexdigest(),
              "modelRevision": assets.REVISION, "cloudAsrCalled": False, "databaseWrites": False}
    args.output.write_text(json.dumps(report, indent=2), encoding="utf-8")
    blocked_calls = []

    def deny_connect(*_args: object, **_kwargs: object) -> None:
        blocked_calls.append(True)
        raise RuntimeError("Network disabled for local inference")

    socket.socket.connect = deny_connect
    socket.create_connection = deny_connect
    try:
        report["stage"] = "import"
        from funasr_onnx import Paraformer, Fsmn_vad
        import numpy as np
        report["stage"] = "load"
        start = time.perf_counter()
        model = Paraformer(str(model_dir), quantize=True, device_id="-1", intra_op_num_threads=4)
        vad = Fsmn_vad(str(model_dir / "vad"), quantize=True, device_id="-1", intra_op_num_threads=4)
        report["loadMs"] = round((time.perf_counter() - start) * 1000)
        report["stage"] = "inference"
        start = time.perf_counter()
        with wave.open(str(args.audio), "rb") as audio:
            waveform = np.frombuffer(audio.readframes(audio.getnframes()), dtype="<i2").astype(np.float32) / 32768
        detected = vad(waveform)
        report["rawVad"] = detected
        if len(detected) != 1:
            raise ValueError("Unexpected VAD output")
        local_times = validate_timestamps(detected[0], round(duration * 1000), 0)
        times = validate_timestamps(detected[0], round(duration * 1000), args.offset_seconds * 1000)
        results = []
        for begin, end in local_times:
            output = model(waveform[begin * 16:end * 16])
            if len(output) != 1:
                raise ValueError("Unexpected ASR output")
            # Official wrapper without word alignment returns (text, token-list).
            prediction = output[0].get("preds")
            text = prediction if isinstance(prediction, str) else prediction[0] if isinstance(prediction, (list, tuple)) and len(prediction) == 2 else None
            if not isinstance(text, str) or not text.strip():
                raise ValueError("No usable speech text")
            results.append({"text": text, "startMs": begin + args.offset_seconds * 1000,
                            "endMs": end + args.offset_seconds * 1000})
        report["inferenceMs"] = round((time.perf_counter() - start) * 1000)
        report["rawResults"] = results
        report["stage"] = "timestamp-validation"
        report.update(status="executed", stage="complete", timingBasis="fsmn-vad speech intervals; not word alignment",
                      sourceTimestampsMs=times, timestampCount=len(times))
        return 0
    except Exception as error:
        report.update(status="blocked", errorType=type(error).__name__)
        if isinstance(error, ModuleNotFoundError):
            report["missingModule"] = error.name
        return 1
    finally:
        report["blockedNetworkAttempts"] = len(blocked_calls)
        args.output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        print(json.dumps({key: report[key] for key in ("status", "audioSeconds", "cloudAsrCalled", "databaseWrites")}), flush=True)


if __name__ == "__main__":
    raise SystemExit(main())
