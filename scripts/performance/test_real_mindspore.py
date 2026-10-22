"""HTTP benchmark regression tests; no real model execution is claimed."""

from __future__ import annotations

import contextlib
import http.client
import importlib.util
import io
import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("real_mindspore", Path(__file__).with_name("real-mindspore.py"))
benchmark = importlib.util.module_from_spec(spec)
spec.loader.exec_module(benchmark)


class BenchmarkTests(unittest.TestCase):
    def run_benchmark(self, replies: list[object], extra: list[str] | None = None) -> tuple[int, dict]:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "frame_001.jpg").write_bytes(b"transport fixture, not a decoded model sample")
            (root / "frame_002.jpg").write_bytes(b"second transport fixture")
            output = root / "result.json"
            argv = ["benchmark", "--frames-dir", str(root), "--samples", "1",
                    "--require-device", "ascend", "--output", str(output)] + (extra or [])
            with patch.object(sys, "argv", argv), patch.object(benchmark, "request_json", side_effect=replies), contextlib.redirect_stdout(io.StringIO()):
                code = benchmark.main()
            return code, json.loads(output.read_text(encoding="utf-8"))

    def health(self, device: str = "ascend") -> dict:
        return {"mock": False, "mindsporeAvailable": True, "modelsLoaded": True, "device": device}

    def test_disconnected_health_is_blocked_and_persisted(self) -> None:
        code, report = self.run_benchmark([http.client.RemoteDisconnected()])
        self.assertEqual(code, 2)
        self.assertEqual(report["status"], "blocked")
        self.assertEqual(report["results"], [])
        self.assertIn("RemoteDisconnected", report["reason"])

    def test_cpu_cannot_pass_ascend_gate(self) -> None:
        code, report = self.run_benchmark([self.health("cpu")])
        self.assertEqual(code, 2)
        self.assertEqual(report["results"], [])

    def test_missing_mock_flag_cannot_pass_real_gate(self) -> None:
        health = self.health()
        del health["mock"]
        code, _ = self.run_benchmark([health])
        self.assertEqual(code, 2)

    def test_disconnected_inference_preserves_failed_stage(self) -> None:
        code, report = self.run_benchmark([self.health(), http.client.RemoteDisconnected()])
        self.assertEqual(code, 1)
        self.assertEqual(report["stage"], "classify")
        self.assertEqual(report["status"], "failed")

    def test_incomplete_batch_is_failure_even_with_json_response(self) -> None:
        code, report = self.run_benchmark([self.health(), {"items": [{"frameIndex": 0, "category": "screen"}]}])
        self.assertEqual(code, 1)
        self.assertEqual(len(report["results"]), 1)
        self.assertNotIn("p95Ms", report)

    def test_duplicate_indices_are_rejected(self) -> None:
        with self.assertRaises(ValueError):
            benchmark.validate_response("classify", {"items": [
                {"frameIndex": 0, "category": "screen"}, {"frameIndex": 0, "category": "screen"},
            ]}, [{"frameIndex": 0, "timestampMs": 0}, {"frameIndex": 1, "timestampMs": 0}])

    def test_nonfinite_ocr_confidence_is_rejected(self) -> None:
        with self.assertRaises(ValueError):
            benchmark.validate_response("detect_text", {"items": [{"frameIndex": 0, "blocks": [
                {"text": "text", "bbox": [0, 0, 10, 10], "confidence": float("nan")},
            ]}]}, [{"frameIndex": 0, "timestampMs": 0}])

    def test_complete_batch_records_results_without_claiming_accuracy(self) -> None:
        replies = [self.health(),
                   {"items": [{"frameIndex": i, "category": "unknown"} for i in range(2)]},
                   {"items": [{"frameIndex": i, "blocks": []} for i in range(2)]},
                   {"frames": [{"frameIndex": i, "timestampMs": 0, "keep": False,
                                "score": 0.1, "reason": "duplicate"} for i in range(2)]}]
        code, report = self.run_benchmark(replies)
        self.assertEqual(code, 0)
        self.assertEqual(report["status"], "executed")
        self.assertIn("not accuracy acceptance", report["reason"])
        self.assertEqual(len(report["results"]), 3)
        self.assertEqual(len(report["frameNames"]), 2)
        self.assertIn("first_screen", report["p95Ms"])


if __name__ == "__main__":
    unittest.main()
