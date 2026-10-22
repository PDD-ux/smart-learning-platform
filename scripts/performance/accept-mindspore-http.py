"""Run an isolated loopback Ascend HTTP acceptance service and stop it afterwards.

Requires an existing Lite/CANN environment. Never reuses or modifies a running
service. Results demonstrate HTTP execution, not accuracy or platform acceptance.
"""
from __future__ import annotations

import argparse
import json
import os
import secrets
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path


def main() -> int:
    root = Path(__file__).resolve().parents[2]
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--model-dir", type=Path, required=True)
    parser.add_argument("--frames-dir", type=Path, default=root / ".taskbook-working/video-infer-diagnostic-20261003")
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--port", type=int, default=18765)
    parser.add_argument("--skip-benchmark", action="store_true", help="Only open a bounded window for a separate gateway check.")
    parser.add_argument("--hold-seconds", type=int, default=0, help="Keep the isolated service alive before cleanup (0 to 300 seconds).")
    args = parser.parse_args()
    if not 0 <= args.hold_seconds <= 300 or (args.skip_benchmark and args.hold_seconds == 0):
        parser.error("hold must be 0 to 300 seconds; --skip-benchmark requires a positive hold")
    output = args.output_dir.resolve()
    output.mkdir(parents=True, exist_ok=True)
    environment = dict(os.environ)
    environment.update(ASCEND_DEVICE="ascend", INFER_MOCK="false", INFER_PREWARM="true",
                       OCR_FALLBACK_ENABLED="false", INFER_MODEL_DIR=str(args.model_dir.resolve()),
                       ASCEND_INFER_TOKEN=secrets.token_urlsafe(32))
    report = {"status": "running", "stage": "startup", "device": "ascend",
              "mock": False, "ocrFallbackEnabled": False, "prewarm": True,
              "port": args.port, "python": sys.executable,
              "scope": "isolated loopback HTTP; no cross-machine gateway or accuracy claim"}

    def save() -> None:
        (output / "http-run.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")

    save()
    started = time.perf_counter()
    process = None
    exit_code = 1
    try:
        # Refuse an occupied port before launching; never test someone else's service.
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as probe:
            probe.bind(("127.0.0.1", args.port))
        with (output / "http-service.log").open("w", encoding="utf-8") as log:
            process = subprocess.Popen([sys.executable, "-m", "uvicorn", "infer_server:app",
                                        "--host", "127.0.0.1", "--port", str(args.port)],
                                       cwd=root / "services/mindspore-infer", env=environment,
                                       stdout=log, stderr=subprocess.STDOUT)
            report["servicePid"] = process.pid
            save()
            opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
            base_url = f"http://127.0.0.1:{args.port}"
            while time.perf_counter() - started < 600:
                if process.poll() is not None:
                    raise RuntimeError("isolated service exited before readiness")
                try:
                    with opener.open(base_url + "/health", timeout=2) as response:
                        health = json.loads(response.read())
                    if health.get("device") != "ascend" or health.get("mock") is not False:
                        raise RuntimeError("unexpected health; port may already be occupied")
                    break
                except (urllib.error.URLError, TimeoutError):
                    time.sleep(0.5)
            else:
                raise TimeoutError("startup did not complete within 600 seconds")
            report["startupMs"] = round((time.perf_counter() - started) * 1000, 3)
            for name, input_args, samples in (
                ("single", ["--image", str(args.frames_dir.resolve() / "frame_003.jpg")], "30"),
                ("batch", ["--frames-dir", str(args.frames_dir.resolve())], "2"),
            ):
                if args.skip_benchmark:
                    break
                report["stage"] = name
                save()
                command = [sys.executable, str(root / "scripts/performance/real-mindspore.py"),
                           "--url", base_url, "--require-device", "ascend", "--no-proxy",
                           "--samples", samples, "--request-timeout", "60",
                           "--output", str(output / f"http-{name}.json")] + input_args
                with (output / f"http-{name}.log").open("w", encoding="utf-8") as benchmark_log:
                    result = subprocess.run(command, env=environment, stdout=benchmark_log,
                                            stderr=subprocess.STDOUT, timeout=600)
                report[f"{name}ExitCode"] = result.returncode
                if result.returncode != 0:
                    raise RuntimeError(f"{name} benchmark did not complete")
            if args.hold_seconds:
                report["stage"] = "gateway-window"
                save()
                time.sleep(args.hold_seconds)
            report.update(status="executed", stage="complete")
            exit_code = 0
    except Exception as error:
        report.update(status="failed", errorType=type(error).__name__)
    finally:
        if process is not None and process.poll() is None:
            process.terminate()
            try:
                process.wait(timeout=15)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait()
        report["exitCode"] = exit_code
        save()
    print(json.dumps(report))
    return exit_code


if __name__ == "__main__":
    sys.exit(main())
