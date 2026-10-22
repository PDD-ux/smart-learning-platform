"""Download only fixed official Paraformer ONNX assets; no model Python execution."""
from __future__ import annotations

import hashlib
import json
from pathlib import Path
import urllib.request

import importlib.util
_assets_spec = importlib.util.spec_from_file_location("local_asr_assets", Path(__file__).resolve().parents[2] / "services/local-asr/assets.py")
assert _assets_spec and _assets_spec.loader
_assets = importlib.util.module_from_spec(_assets_spec)
_assets_spec.loader.exec_module(_assets)
REPO, REVISION, FILES = _assets.REPO, _assets.REVISION, _assets.FILES
VAD_REPO, VAD_REVISION = _assets.VAD_REPO, _assets.VAD_REVISION


def main() -> int:
    root = Path(__file__).resolve().parents[2]
    target = root / ".taskbook-working/local-asr/model"
    target.mkdir(parents=True, exist_ok=True)
    records = []
    for name, expected in FILES.items():
        path = target / name
        path.parent.mkdir(parents=True, exist_ok=True)
        if not path.exists():
            repo, revision, filename = (VAD_REPO, VAD_REVISION, name[4:]) if name.startswith("vad/") else (REPO, REVISION, name)
            url = f"https://modelscope.cn/api/v1/models/{repo}/repo?Revision={revision}&FilePath={filename}"
            with urllib.request.urlopen(url, timeout=60) as response, path.open("xb") as output:
                while chunk := response.read(1024 * 1024):
                    output.write(chunk)
        digest = hashlib.sha256(path.read_bytes()).hexdigest()
        if digest != expected:
            raise ValueError("Asset hash mismatch: " + name)
        records.append({"file": name, "sha256": digest, "bytes": path.stat().st_size})
        print(json.dumps({"verified": name, "bytes": path.stat().st_size}), flush=True)
    (target / "manifest.json").write_text(json.dumps({"repository": REPO, "revision": REVISION,
        "vadRepository": VAD_REPO, "vadRevision": VAD_REVISION, "files": records}, indent=2) + "\n", encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
