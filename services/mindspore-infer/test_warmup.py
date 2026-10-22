"""Ascend 启动预热与端口就绪门控的无设备单测。"""

from __future__ import annotations

import asyncio
import unittest
from types import SimpleNamespace
from unittest.mock import patch

from infer_server import app, lifespan
from warmup import prewarm_models


class WarmupTests(unittest.TestCase):
    def test_mock_skips_model_loading(self) -> None:
        with patch("warmup.settings") as settings, patch("warmup.mindspore_lite_available") as lite:
            settings.mock = True
            settings.device = "ascend"
            settings.prewarm_models = True
            prewarm_models()
            lite.assert_not_called()

    def test_opt_out_skips_model_loading(self) -> None:
        with patch("warmup.settings") as settings, patch("warmup.mindspore_lite_available") as lite:
            settings.mock = False
            settings.device = "ascend"
            settings.prewarm_models = False
            prewarm_models()
            lite.assert_not_called()

    def test_ascend_warms_all_models_in_order(self) -> None:
        calls = []

        class FakeModel:
            def __init__(self, name: str) -> None:
                self.name = name

            def predict(self, value: object) -> list:
                calls.append((self.name, value.shape))
                return []

        engine = SimpleNamespace(
            detector=FakeModel("textDetector"),
            orientation=FakeModel("orientationClassifier"),
            recognizer=FakeModel("textRecognizer"),
        )
        with patch("warmup.settings") as settings, patch(
            "warmup.mindspore_lite_available", return_value=True
        ), patch("warmup.model_load_status", return_value={
            "classifier": True,
            "textDetector": True,
            "textRecognizer": True,
            "orientationClassifier": True,
            "characterDictionary": True,
        }), patch("warmup.get_ocr_engine", return_value=engine), patch(
            "warmup.CLASSIFIER", FakeModel("classifier")
        ):
            settings.mock = False
            settings.device = "ascend"
            settings.prewarm_models = True
            prewarm_models()

        self.assertEqual(calls, [
            ("textDetector", (1, 3, 736, 1280)),
            ("orientationClassifier", (1, 3, 48, 192)),
            ("textRecognizer", (1, 3, 32, 320)),
            ("classifier", (1, 3, 224, 224)),
        ])

    def test_missing_runtime_fails_startup(self) -> None:
        with patch("warmup.settings") as settings, patch(
            "warmup.mindspore_lite_available", return_value=False
        ):
            settings.mock = False
            settings.device = "ascend"
            settings.prewarm_models = True
            with self.assertRaisesRegex(RuntimeError, "requires mindspore_lite"):
                prewarm_models()

    def test_model_failure_stops_later_warmups(self) -> None:
        calls = []

        class BrokenModel:
            def predict(self, _value: object) -> list:
                calls.append("detector")
                raise RuntimeError("device error")

        engine = SimpleNamespace(detector=BrokenModel(), orientation=None, recognizer=None)
        with patch("warmup.settings") as settings, patch(
            "warmup.mindspore_lite_available", return_value=True
        ), patch("warmup.model_load_status", return_value={"all": True}), patch(
            "warmup.get_ocr_engine", return_value=engine
        ):
            settings.mock = False
            settings.device = "ascend"
            settings.prewarm_models = True
            with self.assertRaisesRegex(RuntimeError, "textDetector"):
                prewarm_models()
        self.assertEqual(calls, ["detector"])

    def test_lifespan_does_not_start_after_prewarm_failure(self) -> None:
        async def enter_lifespan() -> None:
            async with lifespan(app):
                pass

        with patch("infer_server.prewarm_models", side_effect=RuntimeError("failed")):
            with self.assertRaisesRegex(RuntimeError, "failed"):
                asyncio.run(enter_lifespan())


if __name__ == "__main__":
    unittest.main()
