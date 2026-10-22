"""Three-class classifier contract tests without a MindSpore Lite installation."""

from __future__ import annotations

import base64
import io
import unittest
from unittest.mock import patch

import numpy as np
from PIL import Image

from inference import _category_from_logits, _classifier_input, classify_frames
from schemas import FrameInput


def _frame() -> FrameInput:
    buffer = io.BytesIO()
    Image.new("RGB", (32, 16), (255, 127, 0)).save(buffer, format="PNG")
    return FrameInput(frameIndex=7, imageBase64=base64.b64encode(buffer.getvalue()).decode("ascii"))


class ClassifierInferenceTests(unittest.TestCase):
    def test_preprocessing_matches_training_shape_and_range(self) -> None:
        value = _classifier_input(Image.new("RGB", (32, 16), (255, 127, 0)))
        self.assertEqual(value.shape, (1, 3, 224, 224))
        self.assertEqual(value.dtype, np.float32)
        self.assertAlmostEqual(float(value[0, 0, 0, 0]), 1.0)
        self.assertAlmostEqual(float(value[0, 1, 0, 0]), 127 / 255)

    def test_label_order_and_conservative_invalid_threshold(self) -> None:
        self.assertEqual(_category_from_logits([np.array([[9.0, 0.0, 0.0]])]), "blackboard")
        self.assertEqual(_category_from_logits([np.array([[0.0, 9.0, 0.0]])]), "screen")
        self.assertEqual(_category_from_logits([np.array([[0.0, 0.0, 9.0]])]), "invalid")
        self.assertEqual(_category_from_logits([np.array([[0.0, 0.0, 2.0]])]), "unknown")

    def test_rejects_incompatible_four_class_output(self) -> None:
        with self.assertRaises(ValueError):
            _category_from_logits([np.zeros((1, 4))])

    @patch("inference.settings")
    def test_mock_never_uses_model(self, settings: object) -> None:
        settings.mock = True
        self.assertEqual(classify_frames([_frame()])[0].category, "unknown")

    @patch("inference.mindspore_lite_available", return_value=False)
    @patch("inference.model_load_status", return_value={"classifier": True})
    @patch("inference.settings")
    def test_missing_runtime_keeps_frames(self, settings: object, _status: object, _lite: object) -> None:
        settings.mock = False
        self.assertEqual(classify_frames([_frame()])[0].category, "unknown")

    @patch("inference.mindspore_lite_available", return_value=True)
    @patch("inference.model_load_status", return_value={"classifier": True})
    @patch("inference.CLASSIFIER.predict", return_value=[np.array([[0.0, 0.0, 9.0]])])
    @patch("inference.settings")
    def test_real_path_uses_exported_logits(self, settings: object, predict: object, _status: object, _lite: object) -> None:
        settings.mock = False
        settings.classifier_invalid_threshold = 0.95
        self.assertEqual(classify_frames([_frame()])[0].category, "invalid")
        self.assertEqual(predict.call_args.args[0].shape, (1, 3, 224, 224))


if __name__ == "__main__":
    unittest.main()
