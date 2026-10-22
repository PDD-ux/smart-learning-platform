"""Model loading fallback should not repeatedly rebuild an incompatible MindIR."""

from __future__ import annotations

import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

import numpy as np

from model_runtime import MindIRModel


class ModelRuntimeTests(unittest.TestCase):
    def test_failed_build_is_not_retried_for_each_request(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            Path(directory, "broken.mindir").touch()
            attempts = 0

            class BrokenModel:
                def build_from_file(self, _path: str, _kind: object, _context: object) -> None:
                    nonlocal attempts
                    attempts += 1
                    raise RuntimeError("unsupported operator")

            fake_lite = SimpleNamespace(
                Context=lambda: SimpleNamespace(target=[]),
                Model=BrokenModel,
                ModelType=SimpleNamespace(MINDIR=object()),
            )
            with patch("model_runtime.settings") as settings, patch(
                "model_runtime.importlib.import_module", return_value=fake_lite
            ):
                settings.model_dir = directory
                settings.device = "cpu"
                model = MindIRModel("broken.mindir")
                value = np.zeros((1, 3, 32, 32), dtype=np.float32)
                with self.assertRaisesRegex(RuntimeError, "unsupported operator"):
                    model.predict(value)
                with self.assertRaisesRegex(RuntimeError, "previously failed"):
                    model.predict(value)
            self.assertEqual(attempts, 1)


if __name__ == "__main__":
    unittest.main()
