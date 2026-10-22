"""Bounded loopback Ascend service, detached from its short SSH launcher."""
from __future__ import annotations

import json
from datetime import datetime, timezone
import os
from pathlib import Path
import signal
import socket
import subprocess
import sys
import time


def serve(root: Path, duration: int) -> int:
    stopping = False
    stop_signal = None
    record = root / "services/mindspore-infer/lifecycle.json"
    state = {"status": "starting", "supervisorPid": os.getpid(),
             "startedAtUtc": datetime.now(timezone.utc).isoformat(), "durationSeconds": duration}

    def save() -> None:
        record.write_text(json.dumps(state, indent=2) + "\n", encoding="utf-8")

    def stop(signum: int, frame: object) -> None:
        nonlocal stopping, stop_signal
        stopping = True
        stop_signal = signum

    for name in (signal.SIGTERM, signal.SIGINT, signal.SIGHUP):
        signal.signal(name, stop)
    with (root / "services/mindspore-infer" / "service.log").open("a", encoding="utf-8") as log:
        service = subprocess.Popen([sys.executable, "-m", "uvicorn", "infer_server:app", "--host",
                                    "127.0.0.1", "--port", "18765", "--log-level", "warning"],
                                   cwd=root / "services/mindspore-infer", env=os.environ.copy(),
                                   stdin=subprocess.DEVNULL, stdout=log, stderr=subprocess.STDOUT)
        deadline = time.monotonic() + duration
        state.update(status="running", servicePid=service.pid)
        save()
        try:
            while not stopping and time.monotonic() < deadline and service.poll() is None:
                time.sleep(1)
        finally:
            state.update(exitReason="signal" if stopping else
                         "duration" if time.monotonic() >= deadline else "service-exited",
                         stopSignal=stop_signal, observedServiceReturnCode=service.poll())
            if service.poll() is None:
                service.terminate()
                try:
                    service.wait(timeout=15)
                except subprocess.TimeoutExpired:
                    service.kill()
                    service.wait(timeout=10)
            state.update(status="stopped", serviceReturnCode=service.returncode,
                         endedAtUtc=datetime.now(timezone.utc).isoformat())
            save()
    return 0 if service.returncode in (0, -signal.SIGTERM, -signal.SIGINT) else service.returncode or 1


def main() -> int:
    root = Path(__file__).resolve().parents[2]
    if len(sys.argv) == 3 and sys.argv[1] == "--serve":
        return serve(root, int(sys.argv[2]))
    request = json.loads(sys.stdin.readline())
    duration = int(request["durationSeconds"])
    if not 60 <= duration <= 7200 or len(request["token"]) < 32:
        raise ValueError("Invalid demo configuration")
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 18765))
    environment = dict(os.environ)
    # OCR 多后端择优配置。OCR_PRIMARY：
    #   auto      —— 先用昇腾 MindSpore，结果平均置信不足时自动改用 PP-OCRv4（默认，演示主线不变）
    #   rapidocr  —— 以识别率为先，直接优先 PP-OCRv4
    #   mindspore —— 只用昇腾主线，不做补位
    # 云端若未安装 rapidocr-onnxruntime，RapidOCR 自动缺席、退回 MindSpore，不影响启动。
    environment.update(ASCEND_DEVICE="ascend", INFER_MOCK="false", INFER_PREWARM="true",
                       OCR_FALLBACK_ENABLED="false", INFER_MODEL_DIR=request["modelDir"],
                       ASCEND_INFER_TOKEN=request["token"],
                       OCR_RAPID_ENABLED="true", OCR_PRIMARY="auto",
                       OCR_MAX_VARIANTS="3", OCR_GOOD_CONFIDENCE="0.85")
    # 识别模型规格透传：本地换成 SVTR 中文版后云端一并生效。
    # 云端 model_dir 若没有对应权重，MindSpore 引擎加载失败会自动降级到 PP-OCRv4，不会启动失败。
    for key in ("OCR_REC_MODEL", "OCR_REC_HEIGHT", "OCR_REC_WIDTH", "OCR_REC_NORMALIZE"):
        value = os.environ.get(key)
        if value:
            environment[key] = value
    log_path = root / "services/mindspore-infer" / "service.log"
    with log_path.open("a", encoding="utf-8") as log:
        server = subprocess.Popen([sys.executable, str(Path(__file__).resolve()), "--serve", str(duration)],
                                  cwd=root, env=environment, stdin=subprocess.DEVNULL,
                                  stdout=log, stderr=subprocess.STDOUT, start_new_session=True, close_fds=True)
    print(json.dumps({"servicePid": server.pid, "root": str(root), "port": 18765}), flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
