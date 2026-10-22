from __future__ import annotations

import base64
import io
import unittest
from unittest.mock import patch

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

from frame_quality import clarity_score, hamming_distance, perceptual_hash, quality_select_frames
from ocr_runtime import OcrEngine, _connected_boxes, _orientation_input, _recognition_input, _recognition_spans, decode_ctc
from schemas import FrameInput


def _encoded(image: Image.Image) -> str:
    output = io.BytesIO()
    image.save(output, format="PNG")
    return base64.b64encode(output.getvalue()).decode("ascii")


def _text_like_image() -> Image.Image:
    image = Image.new("RGB", (640, 360), "white")
    draw = ImageDraw.Draw(image)
    for row in range(30, 320, 32):
        draw.rectangle((40, row, 590, row + 8), fill="black")
        for column in range(50, 560, 44):
            draw.rectangle((column, row - 7, column + 4, row + 15), fill="black")
    return image


class VisionRuleTests(unittest.TestCase):
    def test_clarity_detects_blur(self) -> None:
        sharp = _text_like_image()
        blurred = sharp.filter(ImageFilter.GaussianBlur(radius=8))
        self.assertGreater(clarity_score(sharp), clarity_score(blurred))

    def test_perceptual_hash_detects_duplicate(self) -> None:
        image = _text_like_image()
        self.assertEqual(hamming_distance(perceptual_hash(image), perceptual_hash(image.copy())), 0)

    def test_quality_selector_drops_duplicate(self) -> None:
        encoded = _encoded(_text_like_image())
        frames = [
            FrameInput(frameIndex=0, timestampMs=0, imageBase64=encoded),
            FrameInput(frameIndex=1, timestampMs=1000, imageBase64=encoded),
        ]
        result = quality_select_frames(frames)
        self.assertTrue(result[0].keep)
        self.assertFalse(result[1].keep)
        self.assertEqual(result[1].reason, "duplicate")

    def test_ctc_greedy_decode_collapses_repeats_and_blank(self) -> None:
        logits = np.full((5, 4), -8.0, dtype=np.float32)
        logits[0, 0] = 8.0
        logits[1, 0] = 8.0
        logits[2, 3] = 8.0
        logits[3, 1] = 8.0
        logits[4, 1] = 8.0
        text, confidence = decode_ctc(logits, ["中", "文", "字"])
        self.assertEqual(text, "中文")
        self.assertGreater(confidence, 0.99)

    def test_ctc_accepts_already_normalized_probabilities(self) -> None:
        probabilities = np.asarray([[0.98, 0.01, 0.01], [0.005, 0.005, 0.99]], dtype=np.float32)
        text, confidence = decode_ctc(probabilities, ["中", "文"])
        self.assertEqual(text, "中")
        self.assertAlmostEqual(confidence, 0.98, places=2)

    def test_recognition_input_normalizes_padding_to_black(self) -> None:
        value = _recognition_input(Image.new("RGB", (32, 32), "white"))
        self.assertEqual(value.shape, (1, 3, 32, 320))
        np.testing.assert_allclose(value[0, :, 0, 0], (255.0 - 127.0) / 127.0)
        np.testing.assert_allclose(value[0, :, 0, -1], -1.0)

    def test_long_line_splits_between_glyphs_and_covers_every_column(self) -> None:
        for background, foreground in (("white", "black"), ("black", "white")):
            image = Image.new("RGB", (1200, 32), background)
            draw = ImageDraw.Draw(image)
            for column in range(4, 1190, 24):
                draw.rectangle((column, 3, column + 16, 28), fill=foreground)
            spans = _recognition_spans(image)
            self.assertGreater(len(spans), 1)
            self.assertLessEqual(len(spans), 16)
            self.assertEqual(spans[0][0], 0)
            self.assertEqual(spans[-1][1], image.width)
            for index, (left, right) in enumerate(spans):
                self.assertLessEqual(right - left, image.height * 10)
                if index:
                    self.assertEqual(left, spans[index - 1][1])
                    self.assertEqual(image.getpixel((left, 15)), Image.new("RGB", (1, 1), background).getpixel((0, 0)))

    def test_short_lines_no_safe_gaps_and_extreme_aspects_keep_original_crop(self) -> None:
        self.assertEqual(_recognition_spans(Image.new("RGB", (320, 32), "white")), [(0, 320)])
        no_gaps = Image.new("RGB", (1200, 32), "white")
        ImageDraw.Draw(no_gaps).rectangle((0, 10, 1199, 20), fill="black")
        self.assertEqual(_recognition_spans(no_gaps), [(0, 1200)])
        self.assertEqual(_recognition_spans(Image.new("RGB", (6000, 32), "white")), [(0, 6000)])

    def test_split_blocks_keep_original_coordinates_after_orientation(self) -> None:
        class Recognizer:
            def predict(self, value: np.ndarray) -> list:
                return [np.asarray([[0.99, 0.01], [0.01, 0.99]], dtype=np.float32)]

        engine = object.__new__(OcrEngine)
        engine.characters = ["中"]
        engine.recognizer = Recognizer()
        for rotated in (False, True):
            with patch.object(engine, "_detect", return_value=[(10, 20, 610, 52, 0.8)]), \
                 patch.object(engine, "_orient", side_effect=lambda crop: crop.rotate(180) if rotated else crop), \
                 patch("ocr_runtime._recognition_spans", return_value=[(0, 200), (200, 600)]):
                blocks = engine.detect_and_recognize(Image.new("RGB", (640, 80), "white"))
            self.assertEqual([block.bbox[0] for block in blocks], [10, 210])
            self.assertEqual([block.bbox[2] for block in blocks], [200, 400])
            self.assertTrue(all(block.bbox[1] == 20 and block.bbox[3] == 32 for block in blocks))
            self.assertTrue(all(block.text == "中" for block in blocks))

    def test_orientation_preserves_short_crop_aspect_and_pads_after_normalization(self) -> None:
        value = _orientation_input(Image.new("RGB", (48, 48), "white"))
        self.assertEqual(value.shape, (1, 3, 48, 192))
        np.testing.assert_allclose(value[0, :, :, :48], 1.0)
        np.testing.assert_allclose(value[0, :, :, 48:], 0.0)

    def test_short_tail_direction_vote_does_not_rotate_the_whole_upright_line(self) -> None:
        class Recognizer:
            def predict(self, value: np.ndarray) -> list:
                return [np.asarray([[0.99, 0.01], [0.01, 0.99]], dtype=np.float32)]

        engine = object.__new__(OcrEngine)
        engine.characters = ["中"]
        engine.recognizer = Recognizer()
        image = Image.new("RGB", (640, 32), "white")
        ImageDraw.Draw(image).rectangle((0, 0, 639, 3), fill="black")
        with patch.object(engine, "_detect", return_value=[(0, 0, 640, 32, 0.8)]), \
             patch.object(engine, "_orient", side_effect=lambda crop: crop.rotate(180) if crop.width < 100 else crop), \
             patch("ocr_runtime._recognition_spans", return_value=[(0, 300), (300, 600), (600, 640)]), \
             patch("ocr_runtime._recognition_input", wraps=_recognition_input) as recognition:
            engine.detect_and_recognize(image)
        self.assertEqual(recognition.call_count, 3)
        self.assertTrue(all(call.args[0].getpixel((0, 0)) == (0, 0, 0) for call in recognition.call_args_list))

    def test_detection_box_expands_shrunken_text_core_vertically(self) -> None:
        probability = np.zeros((100, 100), dtype=np.float32)
        probability[40:50, 20:70] = 1.0
        boxes = _connected_boxes(probability, (100, 100))
        self.assertEqual(len(boxes), 1)
        x0, y0, x1, y1, confidence = boxes[0]
        self.assertEqual((x0, y0, x1, y1), (18, 32, 72, 58))
        self.assertAlmostEqual(confidence, 1.0)


if __name__ == "__main__":
    unittest.main()
