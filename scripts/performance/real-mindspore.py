"""§10.4 real inference-service first-screen latency benchmark.

This intentionally refuses mock, unloaded-model, or unavailable services so its
output cannot be mistaken for a mock result. OCR may still use a CPU fallback.
"""

from __future__ import annotations

import argparse
import base64
import http.client
import json
import math
import os
import socket
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path
from datetime import datetime, timezone
from typing import Any


def percentile(values: list[float], quantile: float) -> float:
    values.sort()
    return values[min(len(values) - 1, int((len(values) * quantile) + 0.999999) - 1)]


def request_json(url: str, token: str | None, body: dict[str, Any] | None, timeout_s: float = 10, no_proxy: bool = False) -> dict[str, Any]:
    payload = json.dumps(body).encode("utf-8") if body is not None else None
    headers = {"Content-Type": "application/json"} if payload is not None else {}
    if token:
        headers["X-Infer-Token"] = token
    request = urllib.request.Request(url, data=payload, headers=headers, method="POST" if payload else "GET")
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({})) if no_proxy else urllib.request.build_opener()
    with opener.open(request, timeout=timeout_s) as response:
        result = json.loads(response.read().decode("utf-8"))
    if not isinstance(result, dict):
        raise ValueError("response must be a JSON object")
    return result


def validate_response(endpoint: str, response: dict[str, Any], frames: list[dict[str, Any]]) -> None:
    """Reject missing, duplicated or mismatched frames and malformed payloads."""
    items = response.get("frames" if endpoint == "select_frames" else "items")
    if not isinstance(items, list) or len(items) != len(frames):
        raise ValueError(f"{endpoint}: response frame count mismatch")
    expected = {frame["frameIndex"]: frame["timestampMs"] for frame in frames}
    seen: set[int] = set()

    def number(value: Any, lower: float, upper: float) -> bool:
        return type(value) in (int, float) and math.isfinite(value) and lower <= value <= upper

    for item in items:
        if not isinstance(item, dict):
            raise ValueError(f"{endpoint}: invalid frame item")
        index = item.get("frameIndex")
        if type(index) is not int or index not in expected or index in seen:
            raise ValueError(f"{endpoint}: response frame index mismatch")
        seen.add(index)
        if endpoint == "classify":
            if item.get("category") not in ("blackboard", "screen", "invalid", "unknown"):
                raise ValueError("classify: invalid category")
        elif endpoint == "detect_text":
            blocks = item.get("blocks")
            if not isinstance(blocks, list):
                raise ValueError("detect_text: invalid blocks")
            for block in blocks:
                if not isinstance(block, dict):
                    raise ValueError("detect_text: invalid block")
                bbox = block.get("bbox")
                if (not isinstance(bbox, list) or len(bbox) != 4
                        or not all(number(value, 0, float("inf")) for value in bbox)
                        or not isinstance(block.get("text"), str)
                        or not number(block.get("confidence"), 0, 1)):
                    raise ValueError("detect_text: invalid block fields")
        elif (type(item.get("timestampMs")) is not int or item["timestampMs"] != expected[index]
              or not number(item.get("score"), 0, 1)
              or type(item.get("keep")) is not bool or not isinstance(item.get("reason"), str)):
            raise ValueError("select_frames: invalid fields")


def main() -> int:
    parser = argparse.ArgumentParser(description="Run real MindSpore first-screen latency samples.")
    parser.add_argument("--url", default=os.environ.get("ASCEND_INFER_URL", "http://127.0.0.1:8000"))
    parser.add_argument("--token", default=os.environ.get("ASCEND_INFER_TOKEN"))
    parser.add_argument("--image", type=Path, help="A representative PNG/JPEG frame for real inference.")
    parser.add_argument("--frames-dir", type=Path, help="Instead of --image, submit all JPEG/PNG frames as one bounded batch.")
    parser.add_argument("--require-device", choices=("cpu", "gpu", "ascend"))
    parser.add_argument("--output", type=Path, help="Persist responses, timings and the last execution stage as JSON.")
    parser.add_argument("--no-proxy", action="store_true", help="Connect directly without environment HTTP proxies.")
    parser.add_argument("--samples", type=int, default=30)
    parser.add_argument("--request-timeout", type=float, default=60, help="Per inference request timeout in seconds.")
    args = parser.parse_args()

    report: dict[str, Any] = {
        "checkedAt": datetime.now(timezone.utc).isoformat(), "status": "blocked",
        "stage": "health", "requiredDevice": args.require_device, "results": [],
        "plannedSamples": args.samples, "requestTimeoutSeconds": args.request_timeout,
        "noProxy": args.no_proxy,
        "scope": "HTTP execution and response contract; accuracy and backend proof require separate review",
    }

    def persist() -> None:
        if args.output:
            args.output.parent.mkdir(parents=True, exist_ok=True)
            args.output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    def stop(code: int, reason: str) -> int:
        report.update(status="blocked" if code == 2 else "failed", reason=reason, exitCode=code)
        persist()
        print(f"[perf] real-mindspore {report['status']}: {reason}")
        return code

    def record_error(error: Exception) -> None:
        report["errorType"] = type(error).__name__
        if isinstance(error, urllib.error.HTTPError):
            report["httpStatus"] = error.code
        if isinstance(error, urllib.error.URLError):
            report["causeType"] = type(error.reason).__name__
            if isinstance(error.reason, OSError):
                report["causeErrno"] = error.reason.errno

    base_url = args.url.rstrip("/")
    persist()
    try:
        health = request_json(f"{base_url}/health", None, None, no_proxy=args.no_proxy)
    except (urllib.error.URLError, http.client.HTTPException, TimeoutError, socket.timeout, ValueError) as error:
        record_error(error)
        return stop(2, f"health endpoint unavailable: {type(error).__name__}")

    report["health"] = health
    if health.get("mock") is not False or health.get("mindsporeAvailable") is not True or health.get("modelsLoaded") is not True:
        return stop(2,
            f"mock={health.get('mock')} mindsporeAvailable={health.get('mindsporeAvailable')} "
            f"modelsLoaded={health.get('modelsLoaded')}"
        )
    if args.require_device and health.get("device") != args.require_device:
        return stop(2, "health device does not match --require-device")
    if bool(args.image) == bool(args.frames_dir):
        return stop(2, "provide exactly one of --image or --frames-dir")
    images = [args.image] if args.image else sorted(
        path for path in args.frames_dir.glob("*") if path.suffix.lower() in (".jpg", ".jpeg", ".png")
    )
    if not images or len(images) > 120 or any(not path.is_file() for path in images):
        return stop(2, "provide 1 to 120 existing JPEG/PNG frames")
    sizes = [path.stat().st_size for path in images]
    if any(size > 5 * 1024 * 1024 for size in sizes) or sum(sizes) > 20 * 1024 * 1024:
        return stop(2, "image payload exceeds service limits (5 MiB/frame, 20 MiB/batch)")
    if args.samples < 1:
        return stop(1, "--samples must be >= 1")
    if args.request_timeout <= 0:
        return stop(1, "--request-timeout must be > 0")

    frames = [{"frameIndex": index, "timestampMs": 0,
               "imageBase64": base64.b64encode(path.read_bytes()).decode("ascii")}
              for index, path in enumerate(images)]
    report.update(status="running", frameNames=[path.name for path in images],
                  timestampSource="synthetic zero; source video timestamps unavailable")
    endpoint_durations: dict[str, list[float]] = {"classify": [], "detect_text": [], "select_frames": [], "first_screen": []}

    try:
        for sample in range(args.samples):
            first_screen_started = time.perf_counter()
            for endpoint, body in (
                ("classify", {"frames": frames}),
                ("detect_text", {"frames": frames}),
                ("select_frames", {"frames": frames, "strategy": "quality", "sampleEvery": 1}),
            ):
                report.update(stage=endpoint, currentSample=sample + 1)
                persist()
                started = time.perf_counter()
                response = request_json(f"{base_url}/{endpoint}", args.token, body, args.request_timeout, args.no_proxy)
                duration = (time.perf_counter() - started) * 1000
                report["results"].append({"sample": sample + 1, "endpoint": endpoint,
                                          "durationMs": round(duration, 3), "response": response})
                persist()
                validate_response(endpoint, response, frames)
                endpoint_durations[endpoint].append(duration)
            endpoint_durations["first_screen"].append((time.perf_counter() - first_screen_started) * 1000)
    except (urllib.error.URLError, http.client.HTTPException, TimeoutError, socket.timeout, ValueError) as error:
        record_error(error)
        return stop(1, f"{report['stage']} request or contract failed: {type(error).__name__}")

    p95 = {key: round(percentile(values, 0.95), 3) for key, values in endpoint_durations.items()}
    report.update(status="executed", stage="complete", samples=args.samples, p95Ms=p95, exitCode=0,
                  reason="Execution completed; empty OCR and unknown categories need review; not accuracy acceptance.")
    persist()
    print(json.dumps({"status": "executed", "samples": args.samples, "framesPerBatch": len(frames),
                      "p95Ms": p95, "health": health}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
