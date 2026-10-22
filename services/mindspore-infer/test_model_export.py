"""模型导出参数的本机逻辑测试；不需要 MindSpore。"""

from __future__ import annotations

import unittest
from pathlib import Path

from scripts.export_mindir import expected_extension, validate_output_path


class ModelExportFormatTests(unittest.TestCase):
    def test_mindir_extension(self) -> None:
        self.assertEqual(expected_extension("MINDIR"), ".mindir")
        validate_output_path(Path("models/classifier.mindir"), "MINDIR")

    def test_air_extension(self) -> None:
        self.assertEqual(expected_extension("AIR"), ".air")
        validate_output_path(Path("models/classifier.air"), "AIR")

    def test_onnx_extension(self) -> None:
        self.assertEqual(expected_extension("ONNX"), ".onnx")
        validate_output_path(Path("models/classifier.onnx"), "ONNX")

    def test_rejects_mindir_as_air(self) -> None:
        with self.assertRaisesRegex(ValueError, r"必须以 \.air 结尾"):
            validate_output_path(Path("models/classifier.mindir"), "AIR")

    def test_rejects_air_as_onnx(self) -> None:
        with self.assertRaisesRegex(ValueError, r"必须以 \.onnx 结尾"):
            validate_output_path(Path("models/classifier.air"), "ONNX")


if __name__ == "__main__":
    unittest.main()
