"""Upload current sources and diagnostic frames to a fresh directory for §10.4.

Uses an existing Linux Lite/CANN environment; installs nothing and changes no
existing service or model. Keeps bounded acceptance evidence for inspection.
"""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
import json
from pathlib import Path
import shlex
import subprocess
import tarfile


def main() -> int:
    root = Path(__file__).resolve().parents[2]
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--host", required=True)
    parser.add_argument("--ip", required=True)
    parser.add_argument("--key", type=Path, required=True)
    parser.add_argument("--port", default="31637")
    parser.add_argument("--python", required=True)
    args = parser.parse_args()
    if not args.key.is_file():
        parser.error("local key missing")
    output = root / ".taskbook-working/ascend-resume" / datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    output.mkdir(parents=True)
    options = ["-o", "HostName=" + args.ip, "-o", "HostKeyAlias=" + args.host.split("@")[-1],
               "-o", "StrictHostKeyChecking=no", "-o", "BatchMode=yes", "-o", "ConnectTimeout=10",
               "-i", str(args.key.resolve())]
    ssh = ["ssh", *options, "-p", args.port, args.host]
    state = {"status": "running", "stage": "upload", "output": str(output), "ip": args.ip,
             "scope": "isolated direct-model and loopback HTTP; no full-video or accuracy claim"}

    def save() -> None:
        (output / "controller.json").write_text(json.dumps(state, indent=2) + "\n", encoding="utf-8")

    save()
    try:
        created = subprocess.run(ssh + ["mktemp -d /home/ma-user/work/taskbook-accept-20261009-XXXXXXXX"],
                                 capture_output=True, text=True, timeout=30, check=True)
        remote = created.stdout.strip()
        if not remote.startswith("/home/ma-user/work/taskbook-accept-20261009-") or any(c.isspace() for c in remote):
            raise ValueError("unexpected remote directory")
        state["remote"] = remote
        bundle = output / "source.tar.gz"
        with tarfile.open(bundle, "w:gz") as archive:
            for folder in (root / "services/mindspore-infer", root / "scripts/performance"):
                for source in folder.rglob("*.py"):
                    if "__pycache__" not in source.parts:
                        archive.add(source, arcname=source.relative_to(root).as_posix())
            for frame in (root / ".taskbook-working/video-infer-diagnostic-20261003").glob("frame_*.jpg"):
                archive.add(frame, arcname=frame.relative_to(root).as_posix())
        with (output / "ssh.log").open("a", encoding="utf-8") as log:
            subprocess.run(["scp", *options, "-P", args.port, str(bundle), args.host + ":" + remote + "/source.tar.gz"],
                           stdout=log, stderr=log, check=True, timeout=90)
            subprocess.run(ssh + ["tar -xzf " + shlex.quote(remote + "/source.tar.gz") + " -C " + shlex.quote(remote)],
                           stdout=log, stderr=log, check=True, timeout=30)
            for name, script_args in (
                ("direct", ["scripts/performance/accept-mindspore-frames.py", "--model-dir", "/home/ma-user/work", "--rounds", "1", "--output", "evidence/direct.json"]),
                ("http", ["scripts/performance/accept-mindspore-http.py", "--model-dir", "/home/ma-user/work", "--output-dir", "evidence/http"]),
            ):
                state["stage"] = name
                save()
                print(json.dumps({"stage": name, "output": str(output)}), flush=True)
                command = "source /usr/local/Ascend/ascend-toolkit/set_env.sh\ncd " + shlex.quote(remote) + "\n" + shlex.join([args.python, *script_args])
                result = subprocess.run(ssh + [command], stdout=log, stderr=log, timeout=1500)
                state[name + "ExitCode"] = result.returncode
                save()
                subprocess.run(["scp", *options, "-P", args.port, "-r", args.host + ":" + remote + "/evidence", str(output)],
                               stdout=log, stderr=log, check=True, timeout=120)
                if result.returncode:
                    raise RuntimeError(name + " acceptance failed; evidence retained")
        state.update(status="executed", stage="complete")
    except Exception as error:
        state.update(status="failed", errorType=type(error).__name__)
    save()
    print(json.dumps(state), flush=True)
    return 0 if state["status"] == "executed" else 1


if __name__ == "__main__":
    raise SystemExit(main())
