"""Offline CPU worker: one bounded PCM audio window, only JSON on stdout."""
from __future__ import annotations
import argparse
import contextlib
import hashlib
import json
from pathlib import Path
import socket
import sys
import wave
import assets
import timing


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--audio", type=Path, required=True)
    parser.add_argument("--model-root", type=Path, required=True)
    args = parser.parse_args()
    for name, expected in assets.FILES.items():
        if hashlib.sha256((args.model_root / name).read_bytes()).hexdigest() != expected:
            raise ValueError("Model checksum failed")
    with wave.open(str(args.audio), "rb") as audio:
        if audio.getframerate() != 16000 or audio.getnchannels() != 1 or audio.getsampwidth() != 2:
            raise ValueError("PCM16 mono 16k required")
        duration_ms = round(audio.getnframes() / 16)
        if not 0 < duration_ms <= 300000:
            raise ValueError("Window must be at most 300 seconds")
        pcm = audio.readframes(audio.getnframes())

    def deny(*_args: object, **_kwargs: object) -> None:
        raise RuntimeError("Network disabled")

    socket.socket.connect = deny
    socket.create_connection = deny
    with contextlib.redirect_stdout(sys.stderr):
        import numpy as np
        from funasr_onnx import Paraformer, Fsmn_vad
        waveform = np.frombuffer(pcm, dtype="<i2").astype(np.float32) / 32768
        vad = Fsmn_vad(str(args.model_root / "vad"), quantize=True, device_id="-1", intra_op_num_threads=4)
        regions = vad(waveform)
        if len(regions) != 1:
            raise ValueError("Invalid VAD output")
        intervals = timing.validate_timestamps(regions[0], duration_ms, 0) if regions[0] else []
        intervals = timing.merge_short_intervals(intervals)
        model = Paraformer(str(args.model_root), quantize=True, device_id="-1", intra_op_num_threads=4)
        segments = []
        for begin, end in intervals:
            output = model(waveform[begin * 16:end * 16])
            if len(output) != 1:
                raise ValueError("Invalid ASR output")
            pred = output[0].get("preds")
            text = pred if isinstance(pred, str) else pred[0] if isinstance(pred, (list, tuple)) and len(pred) == 2 else None
            if not isinstance(text, str) or not text.strip():
                raise ValueError("Invalid recognized text")
            segments.append({"seq": len(segments), "startMs": begin, "endMs": end, "text": text.strip()})
    print(json.dumps({"durationMs": duration_ms, "segments": segments}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception:
        # No private path, model text, environment, or library traceback in product logs.
        print("Local ASR failed", file=sys.stderr)
        raise SystemExit(1)
