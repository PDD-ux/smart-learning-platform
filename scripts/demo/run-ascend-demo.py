"""Local Next.js + real Ascend through SSH. Secrets stay only in child environments.

Run in the foreground or start with a hidden Windows process. Stop by creating
the stopFile listed in .taskbook-working/ascend-demo/current.json, or Ctrl+C.
"""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
import json
import os
import re
from pathlib import Path
import secrets
import shlex
import shutil
import signal
import socket
import subprocess
import sys
import tarfile
import threading
import time
import urllib.request


def main() -> int:
    root = Path(__file__).resolve().parents[2]
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--host", required=True)
    parser.add_argument("--ip", required=True)
    parser.add_argument("--ssh-port", default="31637")
    parser.add_argument("--key", type=Path, required=True)
    parser.add_argument("--remote-python", required=True)
    parser.add_argument("--known-hosts", type=Path, help="Isolated host-key record; accept new keys and reject changes.")
    parser.add_argument("--model-dir", default="/home/ma-user/work")
    parser.add_argument("--duration-seconds", type=int, default=7200)
    parser.add_argument("--queue-retries", type=int, help="Optional extra retries for this demo child only (0 to 3).")
    args = parser.parse_args()
    if not 60 <= args.duration_seconds <= 7200:
        parser.error("duration must be between 60 and 7200 seconds")
    if args.queue_retries is not None and not 0 <= args.queue_retries <= 3:
        parser.error("queue retries must be between 0 and 3")
    for port in (3000, 8001):
        with socket.socket() as probe:
            probe.bind(("127.0.0.1", port))
    if not args.key.is_file():
        parser.error("SSH key is missing")
    node = shutil.which("node")
    if not node or not (root / "node_modules/next/dist/bin/next").is_file():
        parser.error("Existing Node.js and Next.js dependencies are required")
    options = ["-o", f"HostName={args.ip}", "-o", f"HostKeyAlias={args.host.split('@')[-1]}",
               "-o", "StrictHostKeyChecking=no", "-o", "BatchMode=yes", "-o", "ConnectTimeout=15",
               "-o", "ServerAliveInterval=15", "-o", "ServerAliveCountMax=3", "-i", str(args.key.resolve())]
    if args.known_hosts:
        args.known_hosts.parent.mkdir(parents=True, exist_ok=True)
        options[5] = "StrictHostKeyChecking=accept-new"
        options += ["-o", "UserKnownHostsFile=" + str(args.known_hosts.resolve())]
    ssh = ["ssh", *options, "-p", args.ssh_port]
    session = root / ".taskbook-working/ascend-demo" / datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    session.mkdir(parents=True)
    stop_file = session / "stop"
    state = {"status": "starting", "stage": "upload", "controllerPid": os.getpid(),
             "startedAtUtc": datetime.now(timezone.utc).isoformat(), "durationSeconds": args.duration_seconds,
             "appUrl": "http://localhost:3000", "inferenceUrl": "http://127.0.0.1:8001",
             "sessionDir": str(session), "stopFile": str(stop_file)}
    if args.queue_retries is not None:
        state["queueRetries"] = args.queue_retries
    record = session.parent / "current.json"

    def save() -> None:
        serialized = json.dumps(state, indent=2) + "\n"
        record.write_text(serialized, encoding="utf-8")
        (session / "state.json").write_text(serialized, encoding="utf-8")

    save()
    children = []
    handles = []
    flags = subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0
    stopping = False
    lifetime_deadline = time.monotonic() + args.duration_seconds
    remote_service_pid = None
    web = None
    log_thread = None

    def stop(signum: int, frame: object) -> None:
        nonlocal stopping
        stopping = True

    signal.signal(signal.SIGINT, stop)
    signal.signal(signal.SIGTERM, stop)
    try:
        remote = subprocess.check_output(ssh + [args.host, "mktemp -d /home/ma-user/work/taskbook-demo-XXXXXXXX"],
                                         stdin=subprocess.DEVNULL, text=True, timeout=60, creationflags=flags).strip()
        if not remote.startswith("/home/ma-user/work/taskbook-demo-") or any(c.isspace() for c in remote):
            raise ValueError("Unexpected remote directory")
        state["remoteRoot"] = remote
        bundle = session / "source.tar.gz"
        with tarfile.open(bundle, "w:gz") as archive:
            for path in (root / "services/mindspore-infer").rglob("*.py"):
                if "__pycache__" not in path.parts:
                    archive.add(path, arcname=path.relative_to(root).as_posix())
            archive.add(Path(__file__).with_name("serve-ascend-demo.py"), arcname="scripts/demo/serve-ascend-demo.py")
        subprocess.run(["scp", *options, "-P", args.ssh_port, str(bundle), f"{args.host}:{remote}/source.tar.gz"],
                       stdin=subprocess.DEVNULL, check=True, timeout=90, creationflags=flags)
        subprocess.run(ssh + [args.host, f"tar -xzf {shlex.quote(remote + '/source.tar.gz')} -C {shlex.quote(remote)}"],
                       stdin=subprocess.DEVNULL, check=True, timeout=60, creationflags=flags)
        token = secrets.token_urlsafe(32)
        command = ("source /usr/local/Ascend/ascend-toolkit/set_env.sh; " + shlex.quote(args.remote_python) +
                   " " + shlex.quote(remote + "/scripts/demo/serve-ascend-demo.py"))
        launched = subprocess.run(ssh + [args.host, command],
                                  input=json.dumps({"token": token, "durationSeconds": args.duration_seconds,
                                                    "modelDir": args.model_dir}) + "\n",
                                  capture_output=True, check=True, timeout=60, text=True, creationflags=flags)
        remote_launch = json.loads(launched.stdout)
        remote_service_pid = int(remote_launch["servicePid"])
        if remote_service_pid <= 1 or remote_launch.get("root") != remote:
            raise ValueError("Unexpected remote service launch response")
        tunnel_log = (session / "ssh-tunnel.log").open("w", encoding="utf-8")
        handles.append(tunnel_log)
        tunnel = subprocess.Popen(ssh + ["-o", "ExitOnForwardFailure=yes", "-N", "-L",
                                         "127.0.0.1:8001:127.0.0.1:18765", args.host],
                                  stdin=subprocess.DEVNULL, stdout=tunnel_log, stderr=subprocess.STDOUT, creationflags=flags)
        children.append(tunnel)
        state.update(stage="prewarm", remoteServicePid=remote_service_pid, tunnelPid=tunnel.pid)
        save()
        client = urllib.request.build_opener(urllib.request.ProxyHandler({}))
        deadline = time.monotonic() + 600
        while time.monotonic() < deadline:
            if stopping or stop_file.exists() or any(child.poll() is not None for child in children):
                raise RuntimeError("Demo stopped before inference readiness")
            try:
                with client.open("http://127.0.0.1:8001/health", timeout=2) as response:
                    health = json.load(response)
                if health.get("device") == "ascend" and health.get("modelsLoaded") and health.get("mock") is False:
                    state["health"] = health
                    break
            except (OSError, ValueError):
                pass
            time.sleep(1)
        else:
            raise TimeoutError("Ascend prewarm did not complete")
        web_log = (session / "web.log").open("w", encoding="utf-8")
        handles.append(web_log)
        environment = dict(os.environ)
        environment.update(ASCEND_INFER_URL="http://127.0.0.1:8001", ASCEND_INFER_TOKEN=token,
                           FEATURE_MINDSPORE_INFER="true", QUEUE_DRIVER="memory")
        if args.queue_retries is not None:
            environment["QUEUE_RETRY_MAX"] = str(args.queue_retries)
        web = subprocess.Popen([node, str(root / "node_modules/next/dist/bin/next"), "dev", "--webpack", "-p", "3000",
                                "-H", "127.0.0.1"], cwd=root, env=environment,
                               stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True,
                               encoding="utf-8", errors="replace", creationflags=flags)
        children.append(web)

        def relay_web_log() -> None:
            assert web is not None and web.stdout is not None
            for line in web.stdout:
                web_log.write(re.sub(r"([?&](?:sig|token)=)[^&\s]+", r"\1[REDACTED]", line))
                web_log.flush()

        log_thread = threading.Thread(target=relay_web_log, daemon=True)
        log_thread.start()
        state.update(stage="web-startup", webPid=web.pid)
        save()
        for _ in range(120):
            if stopping or stop_file.exists():
                raise RuntimeError("Demo stopped during web startup")
            if web.poll() is not None:
                raise RuntimeError("Next.js exited")
            try:
                with client.open("http://127.0.0.1:3000", timeout=10) as response:
                    if response.status == 200:
                        break
            except (OSError, ValueError):
                pass
            time.sleep(1)
        else:
            raise TimeoutError("Web startup timed out")
        state.update(status="ready", stage="demo", readyAtUtc=datetime.now(timezone.utc).isoformat())
        save()
        print(json.dumps({"status": "ready", "appUrl": state["appUrl"], "record": str(record)}), flush=True)
        deadline = lifetime_deadline
        while not stopping and not stop_file.exists() and time.monotonic() < deadline:
            if web.poll() is not None:
                state["failedComponent"] = "web"
                state["componentExitCode"] = web.returncode
                raise RuntimeError("Web exited")
            if tunnel.poll() is not None:
                events = state.setdefault("reconnections", [])
                event = {"startedAtUtc": datetime.now(timezone.utc).isoformat(),
                         "previousExitCode": tunnel.returncode, "status": "reconnecting"}
                events.append(event)
                state.update(status="reconnecting", stage="ssh-reconnect")
                save()
                recovered = False
                # Keep the same token/service/web; never replay an upload or worker.
                recovery_deadline = min(deadline, time.monotonic() + 120)
                for attempt in range(1, 4):
                    if stopping or stop_file.exists() or time.monotonic() >= recovery_deadline:
                        break
                    tunnel = subprocess.Popen(ssh + ["-o", "ExitOnForwardFailure=yes", "-N", "-L",
                                                     "127.0.0.1:8001:127.0.0.1:18765", args.host],
                                              stdin=subprocess.DEVNULL, stdout=tunnel_log,
                                              stderr=subprocess.STDOUT, creationflags=flags)
                    children.append(tunnel)
                    state["tunnelPid"] = tunnel.pid
                    event["attempts"] = attempt
                    save()
                    attempt_deadline = min(recovery_deadline, time.monotonic() + 35)
                    while time.monotonic() < attempt_deadline:
                        if stopping or stop_file.exists() or web.poll() is not None or tunnel.poll() is not None:
                            break
                        try:
                            with client.open("http://127.0.0.1:8001/health", timeout=2) as response:
                                health = json.load(response)
                            if health.get("device") == "ascend" and health.get("modelsLoaded") and health.get("mock") is False:
                                state["health"] = health
                                recovered = True
                                break
                        except (OSError, ValueError):
                            pass
                        time.sleep(1)
                    if recovered:
                        break
                    if tunnel.poll() is None:
                        tunnel.terminate()
                        tunnel.wait(timeout=10)
                event.update(status="recovered" if recovered else "failed",
                             endedAtUtc=datetime.now(timezone.utc).isoformat())
                if not recovered:
                    if stopping or stop_file.exists() or time.monotonic() >= deadline:
                        break
                    state["failedComponent"] = "ssh-or-remote-inference"
                    raise RuntimeError("SSH/inference recovery exhausted")
                state.update(status="ready", stage="demo")
                save()
            time.sleep(1)
        state.update(status="stopped", stage="complete")
        return 0
    except Exception as error:
        state.update(status="failed", errorType=type(error).__name__)
        details = getattr(error, "stderr", None) or getattr(error, "stdout", None)
        if isinstance(details, str) and details:
            state["errorDetail"] = re.sub(r"(?i)(token|password|secret|sig)=?[^\s&]+", r"\1=[REDACTED]", details)[-1200:]
        return 1
    finally:
        cleanup_errors = []
        for child in reversed(children):
            try:
                if child.stdin:
                    child.stdin.close()
                if child.poll() is not None:
                    continue
                if child is web and os.name == "nt":
                    subprocess.run(["taskkill", "/PID", str(child.pid), "/T", "/F"],
                                   stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                                   timeout=30, check=False, creationflags=flags)
                try:
                    child.wait(timeout=0.1)
                except subprocess.TimeoutExpired:
                    try:
                        child.terminate()
                        child.wait(timeout=10)
                    except subprocess.TimeoutExpired:
                        child.kill()
                        child.wait(timeout=10)
            except (OSError, subprocess.TimeoutExpired):
                cleanup_errors.append(type(child).__name__)
                try:
                    child.kill()
                    child.wait(timeout=10)
                except (OSError, subprocess.TimeoutExpired):
                    pass
        if remote_service_pid is not None:
            try:
                subprocess.run(ssh + [args.host, f"kill -TERM {remote_service_pid}"],
                               stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
                               stderr=subprocess.DEVNULL, timeout=30, check=False, creationflags=flags)
            except (OSError, subprocess.TimeoutExpired):
                cleanup_errors.append("remote-service")
        if log_thread is not None:
            log_thread.join(timeout=5)
        for handle in handles:
            handle.close()
        state["endedAtUtc"] = datetime.now(timezone.utc).isoformat()
        if cleanup_errors:
            state["cleanupErrorTypes"] = cleanup_errors
            if state.get("status") == "stopped":
                state["status"] = "cleanup_failed"
        save()


if __name__ == "__main__":
    raise SystemExit(main())
