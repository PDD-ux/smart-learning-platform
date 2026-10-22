"""Download and verify the official MindOCR MindIR models used by this service."""

from __future__ import annotations

import argparse
import hashlib
import http.client
import os
import time
import urllib.request
from pathlib import Path
from typing import Dict, Tuple

MODELS: Dict[str, Tuple[str, int, str]] = {
    "db_r50_icdar15-ch.mindir": (
        "https://download-mindspore.osinfra.cn/toolkits/mindocr/dbnet/db_r50_icdar15-ch.mindir",
        101_491_841,
        "c2f00634ad71c6d0c6f23a6d27101b855f4eb6f40d0a9d01ebe3e8b1335b6b21",
    ),
    "crnn_resnet34_ch.mindir": (
        "https://download-mindspore.osinfra.cn/toolkits/mindocr/crnn/crnn_resnet34_ch-7a342e3c-105bccb2.mindir",
        90_567_490,
        "105bccb247a42efc5c2585672d86b6bb7baa05381b953f76bf455f659ec21bcf",
    ),
    "cls_mv3.mindir": (
        "https://download-mindspore.osinfra.cn/toolkits/mindocr/cls/cls_mv3.mindir",
        6_386_103,
        "22662c99d2966127dc564ffe9f7d9e1164ab2a8851d228abdf927d96f41b1b49",
    ),
}
DICTIONARY_URL = "https://raw.githubusercontent.com/hadipash/mindocr/main/mindocr/utils/dict/ch_dict.txt"
DICTIONARY_SIZE = 26_250
DICTIONARY_SHA256 = "a1c84d9bdb9ab29043c58896224d32941783eb821629618416dcb08f12886492"
MAX_ATTEMPTS = 5


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _download(url: str, destination: Path, expected_size: int, expected_sha256: str) -> None:
    if (
        destination.is_file()
        and destination.stat().st_size == expected_size
        and _sha256(destination) == expected_sha256
    ):
        print(f"skip {destination.name}: size and sha256 verified")
        return
    partial = destination.with_suffix(destination.suffix + ".part")
    for attempt in range(1, MAX_ATTEMPTS + 1):
        offset = partial.stat().st_size if partial.exists() else 0
        if offset > expected_size:
            partial.unlink()
            offset = 0
        if offset < expected_size:
            headers = {"User-Agent": "mindspore-infer-model-fetch/1.0"}
            if offset:
                headers["Range"] = f"bytes={offset}-"
            request = urllib.request.Request(url, headers=headers)
            try:
                with urllib.request.urlopen(request, timeout=60) as response:
                    status = response.status
                    if status == 206:
                        content_range = response.headers.get("Content-Range", "")
                        if not content_range.startswith(f"bytes {offset}-"):
                            raise RuntimeError(f"unexpected Content-Range for {destination.name}: {content_range}")
                    elif status != 200:
                        raise RuntimeError(f"unexpected HTTP {status} for {destination.name}")
                    # Some mirrors ignore Range and return the whole file.
                    mode = "ab" if offset and status == 206 else "wb"
                    with partial.open(mode) as output:
                        while True:
                            chunk = response.read(1024 * 1024)
                            if not chunk:
                                break
                            output.write(chunk)
            except (OSError, RuntimeError, http.client.IncompleteRead) as exc:
                if attempt == MAX_ATTEMPTS:
                    raise RuntimeError(f"download failed for {destination.name} after {attempt} attempts") from exc
                print(f"retry {destination.name}: attempt {attempt}/{MAX_ATTEMPTS}, saved {partial.stat().st_size if partial.exists() else 0} bytes")
                time.sleep(min(2 ** (attempt - 1), 8))
                continue
        actual_size = partial.stat().st_size
        if actual_size == expected_size:
            actual_sha256 = _sha256(partial)
            if actual_sha256 == expected_sha256:
                os.replace(partial, destination)
                print(f"saved {destination.name} sha256={actual_sha256}")
                return
            partial.unlink()
            error = f"sha256 mismatch for {destination.name}: {actual_sha256} != {expected_sha256}"
        else:
            error = f"size mismatch for {destination.name}: {actual_size} != {expected_size}"
            if actual_size > expected_size:
                partial.unlink()
        if attempt == MAX_ATTEMPTS:
            raise RuntimeError(error)
        print(f"retry {destination.name}: {error}")
        time.sleep(min(2 ** (attempt - 1), 8))


def _download_dictionary(destination: Path) -> None:
    _download(DICTIONARY_URL, destination, DICTIONARY_SIZE, DICTIONARY_SHA256)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--model-dir", default=str(Path(__file__).resolve().parents[1] / "models"))
    args = parser.parse_args()
    model_dir = Path(args.model_dir).resolve()
    model_dir.mkdir(parents=True, exist_ok=True)
    for filename, (url, expected_size, expected_sha256) in MODELS.items():
        _download(url, model_dir / filename, expected_size, expected_sha256)
    _download_dictionary(model_dir / "ch_dict.txt")


if __name__ == "__main__":
    main()
