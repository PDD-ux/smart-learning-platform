"""Supervisor failure evidence regression; no SSH, model, token or real service."""
from __future__ import annotations

import importlib.util
import json
from pathlib import Path
import signal
import tempfile
import unittest
from unittest.mock import patch


spec = importlib.util.spec_from_file_location("demo_supervisor", Path(__file__).with_name("serve-ascend-demo.py"))
assert spec is not None and spec.loader is not None
supervisor = importlib.util.module_from_spec(spec)
spec.loader.exec_module(supervisor)


class Child:
    pid = 123

    def __init__(self, returncode: int | None) -> None:
        self.returncode = returncode
        self.terminated = False

    def poll(self) -> int | None:
        return self.returncode

    def terminate(self) -> None:
        self.terminated = True
        self.returncode = -signal.SIGTERM

    def wait(self, timeout: float) -> int:
        assert self.returncode is not None
        return self.returncode


class LifecycleTests(unittest.TestCase):
    def run_case(self, child: Child, times: list[float], interrupt: bool = False) -> tuple[int, dict]:
        callbacks = {}

        def register(signum: int, callback: object) -> None:
            callbacks[signum] = callback

        def sleep(_seconds: float) -> None:
            if interrupt:
                callbacks[signal.SIGTERM](signal.SIGTERM, None)

        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "services/mindspore-infer").mkdir(parents=True)
            with patch.object(supervisor.subprocess, "Popen", return_value=child), \
                    patch.object(supervisor.signal, "SIGHUP", 1, create=True), \
                    patch.object(supervisor.signal, "signal", side_effect=register), \
                    patch.object(supervisor.time, "monotonic", side_effect=times), \
                    patch.object(supervisor.time, "sleep", side_effect=sleep):
                code = supervisor.serve(root, 60)
            record = json.loads((root / "services/mindspore-infer/lifecycle.json").read_text())
            return code, record

    def test_child_crash_preserves_exit_code(self) -> None:
        child = Child(7)
        code, record = self.run_case(child, [0, 1, 2])
        self.assertEqual(code, 7)
        self.assertEqual(record["exitReason"], "service-exited")
        self.assertEqual(record["observedServiceReturnCode"], 7)
        self.assertEqual(record["serviceReturnCode"], 7)
        self.assertFalse(child.terminated)

    def test_deadline_stops_only_owned_child(self) -> None:
        child = Child(None)
        code, record = self.run_case(child, [0, 61, 61])
        self.assertEqual(code, 0)
        self.assertEqual(record["exitReason"], "duration")
        self.assertEqual(record["serviceReturnCode"], -signal.SIGTERM)
        self.assertTrue(child.terminated)

    def test_signal_record_is_distinct_from_crash(self) -> None:
        child = Child(None)
        code, record = self.run_case(child, [0, 1], interrupt=True)
        self.assertEqual(code, 0)
        self.assertEqual(record["exitReason"], "signal")
        self.assertEqual(record["stopSignal"], signal.SIGTERM)
        self.assertIsNone(record["observedServiceReturnCode"])
        self.assertEqual(record["status"], "stopped")


if __name__ == "__main__":
    unittest.main()
