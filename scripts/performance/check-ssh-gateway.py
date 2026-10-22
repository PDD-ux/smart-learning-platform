"""Read-only SSH gateway bridge; keeps the ephemeral token in child env only."""
from __future__ import annotations
import argparse
import json
import os
import shlex
import socket
import subprocess
import sys
import time
from pathlib import Path


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--host", required=True)
    parser.add_argument("--ip", required=True)
    parser.add_argument("--ssh-port", required=True)
    parser.add_argument("--key", type=Path, required=True)
    parser.add_argument("--known-hosts", type=Path, help="Separate host-key record; preserve the user's existing known_hosts.")
    parser.add_argument("--remote-root", required=True)
    parser.add_argument("--remote-report", default="gateway-results/http-run.json")
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[2]
    ssh = ["ssh", "-o", "StrictHostKeyChecking=no", "-o", "BatchMode=yes", "-o", "ConnectTimeout=15",
           "-o", f"HostName={args.ip}", "-o", f"HostKeyAlias={args.host.split('@')[-1]}",
           "-i", str(args.key), "-p", args.ssh_port]
    if args.known_hosts:
        args.known_hosts.parent.mkdir(parents=True, exist_ok=True)
        # accept-new rejects subsequent changes; no overwrite/removal of old host records.
        ssh[2] = "StrictHostKeyChecking=accept-new"
        ssh += ["-o", "UserKnownHostsFile=" + str(args.known_hosts.resolve())]
    code = ("import json,pathlib; r=json.loads(pathlib.Path(" + repr(args.remote_root + "/" + args.remote_report) +
            ").read_text()); e=pathlib.Path('/proc/'+str(r['servicePid'])+'/environ').read_bytes().split(b'\\0'); "
            "print(next(x.split(b'=',1)[1].decode() for x in e if x.startswith(b'ASCEND_INFER_TOKEN=')))")
    # Capture directly into memory. Never print, persist or pass token as an argument.
    token = subprocess.check_output(ssh + [args.host, "python -c " + shlex.quote(code)], text=True).strip()
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        port = probe.getsockname()[1]
    tunnel = subprocess.Popen(ssh + ["-o", "ExitOnForwardFailure=yes", "-N", "-L",
                                   f"127.0.0.1:{port}:127.0.0.1:18765", args.host],
                              stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        for _ in range(30):
            if tunnel.poll() is not None:
                raise RuntimeError("SSH tunnel exited")
            try:
                with socket.create_connection(("127.0.0.1", port), timeout=1):
                    break
            except OSError:
                time.sleep(0.5)
        else:
            raise TimeoutError("SSH tunnel did not start")
        environment = dict(os.environ)
        environment.update(ASCEND_INFER_URL=f"http://127.0.0.1:{port}", ASCEND_INFER_TOKEN=token,
                           ASCEND_INFER_TIMEOUT_MS="8000", FEATURE_MINDSPORE_INFER="true")
        result = subprocess.run(["node", "--import", "tsx", "scripts/performance/real-mindspore-gateway.ts",
                                 str(root / ".taskbook-working/video-infer-diagnostic-20261003"),
                                 str(args.output.resolve())], cwd=root, env=environment, timeout=90)
        return result.returncode
    finally:
        tunnel.terminate()
        tunnel.wait(timeout=10)


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as error:
        print(json.dumps({"status": "blocked", "errorType": type(error).__name__}))
        sys.exit(2)
