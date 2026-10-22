"""Offline checks for interrupted model downloads."""

from __future__ import annotations

import hashlib
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from scripts import download_pretrained_models as downloader


class FakeResponse:
    def __init__(self, status: int, chunks: list[bytes | Exception], content_range: str = "") -> None:
        self.status = status
        self.headers = {"Content-Range": content_range}
        self.chunks = iter(chunks)

    def __enter__(self) -> "FakeResponse":
        return self

    def __exit__(self, *_args: object) -> None:
        return None

    def read(self, _size: int) -> bytes:
        chunk = next(self.chunks, b"")
        if isinstance(chunk, Exception):
            raise chunk
        return chunk


class DownloadRetryTests(unittest.TestCase):
    def test_connection_reset_resumes_partial_file_and_verifies_hash(self) -> None:
        payload = b"abcdefgh"
        seen_ranges: list[str | None] = []

        def open_request(request: object, timeout: int) -> FakeResponse:
            self.assertEqual(timeout, 60)
            requested_range = request.get_header("Range")  # type: ignore[attr-defined]
            seen_ranges.append(requested_range)
            if requested_range is None:
                return FakeResponse(200, [b"abcd", ConnectionResetError("reset")])
            return FakeResponse(206, [b"efgh"], "bytes 4-7/8")

        with tempfile.TemporaryDirectory() as directory:
            destination = Path(directory) / "model.mindir"
            with patch.object(downloader.urllib.request, "urlopen", side_effect=open_request):
                with patch.object(downloader.time, "sleep"):
                    downloader._download(
                        "https://example.invalid/model.mindir",
                        destination,
                        len(payload),
                        hashlib.sha256(payload).hexdigest(),
                    )
            self.assertEqual(destination.read_bytes(), payload)
            self.assertFalse(destination.with_suffix(".mindir.part").exists())
            self.assertEqual(seen_ranges, [None, "bytes=4-"])

    def test_ignored_range_restarts_instead_of_appending(self) -> None:
        payload = b"abcdefgh"
        with tempfile.TemporaryDirectory() as directory:
            destination = Path(directory) / "model.mindir"
            destination.with_suffix(".mindir.part").write_bytes(b"abcd")
            with patch.object(
                downloader.urllib.request,
                "urlopen",
                return_value=FakeResponse(200, [payload]),
            ):
                downloader._download(
                    "https://example.invalid/model.mindir",
                    destination,
                    len(payload),
                    hashlib.sha256(payload).hexdigest(),
                )
            self.assertEqual(destination.read_bytes(), payload)


if __name__ == "__main__":
    unittest.main()
