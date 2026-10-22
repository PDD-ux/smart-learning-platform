"""DBNet + direction classifier + CRNN OCR pipeline for official MindOCR MindIR files."""

from __future__ import annotations

import math
from pathlib import Path
from typing import List, Sequence, Tuple

import numpy as np
from PIL import Image

from config import settings
from model_runtime import MindIRModel
from schemas import TextBlock

DETECTOR_FILE = "db_r50_icdar15-ch.mindir"
# 默认识别模型；OCR_REC_MODEL 可覆盖为导出的 SVTR 中文版
RECOGNIZER_FILE = "crnn_resnet34_ch.mindir"
ORIENTATION_FILE = "cls_mv3.mindir"
DICTIONARY_FILE = "ch_dict.txt"


def _softmax(value: np.ndarray, axis: int = -1) -> np.ndarray:
    shifted = value - np.max(value, axis=axis, keepdims=True)
    exponent = np.exp(shifted)
    return exponent / np.maximum(np.sum(exponent, axis=axis, keepdims=True), 1e-8)


def _probabilities(value: np.ndarray, axis: int = -1) -> np.ndarray:
    candidate = value.astype(np.float32)
    totals = np.sum(candidate, axis=axis)
    if (
        float(np.min(candidate)) >= 0.0
        and float(np.max(candidate)) <= 1.0
        and np.allclose(totals, 1.0, atol=1e-3)
    ):
        return candidate
    return _softmax(candidate, axis=axis)


def decode_ctc(logits: np.ndarray, characters: Sequence[str]) -> Tuple[str, float]:
    value = np.squeeze(logits)
    if value.ndim != 2:
        raise ValueError(f"unexpected CRNN output shape: {value.shape}")
    if value.shape[0] > 1000 and value.shape[1] < 1000:
        value = value.T
    blank_index = len(characters)
    if value.shape[1] != blank_index + 1:
        raise ValueError(f"CRNN output has {value.shape[1]} classes, expected {blank_index + 1}")
    probabilities = _probabilities(value, axis=1)
    indices = np.argmax(probabilities, axis=1)
    confidences = np.max(probabilities, axis=1)
    text: List[str] = []
    accepted: List[float] = []
    previous = -1
    for index, confidence in zip(indices.tolist(), confidences.tolist()):
        if index != blank_index and index != previous:
            text.append(characters[index])
            accepted.append(float(confidence))
        previous = index
    return "".join(text), (sum(accepted) / len(accepted) if accepted else 0.0)


def _normalized_rgb(image: Image.Image, size: Tuple[int, int], imagenet: bool) -> np.ndarray:
    resized = image.convert("RGB").resize(size, Image.Resampling.BILINEAR)
    value = np.asarray(resized, dtype=np.float32) / 255.0
    if imagenet:
        value = (value - np.asarray([0.485, 0.456, 0.406], dtype=np.float32)) / np.asarray(
            [0.229, 0.224, 0.225], dtype=np.float32
        )
    else:
        value = (value - 0.5) / 0.5
    return np.transpose(value, (2, 0, 1))[None, ...].astype(np.float32)


def _recognition_normalize(canvas: np.ndarray) -> np.ndarray:
    """按识别模型的训练前处理归一化。

    CRNN 用 (x - 127) / 127；SVTR / PP-OCR 系列多为 imagenet 或 (x/255 - 0.5)/0.5。
    归一化和训练不一致会让识别结果全错，换模型时务必用 OCR_REC_NORMALIZE 对齐。
    """
    mode = settings.ocr_rec_normalize
    if mode == "raw":
        # MindOCR 的 SVTR 训练时输入就是 0~255 原值：DecodeImage(to_float32=False)
        # + SVTRRecResizeImg 只做 resize/padding，模型内部也没有 /255。
        return canvas
    if mode == "imagenet":
        value = canvas / 255.0
        return (value - np.asarray([0.485, 0.456, 0.406], dtype=np.float32)) / np.asarray(
            [0.229, 0.224, 0.225], dtype=np.float32
        )
    if mode == "half":
        return (canvas / 255.0 - 0.5) / 0.5
    return (canvas - 127.0) / 127.0


def _recognition_input(image: Image.Image) -> np.ndarray:
    height = max(1, int(settings.ocr_rec_height))
    limit = max(1, int(settings.ocr_rec_width))
    source = image.convert("RGB")
    width = max(1, min(limit, int(math.ceil(height * source.width / max(1, source.height)))))
    resized = source.resize((width, height), Image.Resampling.BILINEAR)
    pixels = np.asarray(resized, dtype=np.float32)
    if settings.ocr_rec_channel == "bgr":
        pixels = pixels[:, :, ::-1]
    canvas = np.zeros((height, limit, 3), dtype=np.float32)
    canvas[:, :width, :] = pixels
    canvas = _recognition_normalize(canvas)
    return np.transpose(canvas, (2, 0, 1))[None, ...].astype(np.float32)


def _orientation_input(image: Image.Image) -> np.ndarray:
    source = image.convert("RGB")
    width = max(1, min(192, int(math.ceil(48.0 * source.width / max(1, source.height)))))
    resized = np.asarray(source.resize((width, 48), Image.Resampling.BILINEAR), dtype=np.float32)
    canvas = np.zeros((48, 192, 3), dtype=np.float32)
    # The direction model pads after normalization; CRNN pads before it.
    canvas[:, :width, :] = (resized / 255.0 - 0.5) / 0.5
    return np.transpose(canvas, (2, 0, 1))[None, ...].astype(np.float32)


def _recognition_spans(image: Image.Image) -> List[Tuple[int, int]]:
    """Split long lines at background columns before the fixed-height resize.

    Keep every source column, prefer wide background gaps, and bound recognition
    work to 16 spans. Short lines and crops without safe gaps keep the old path.
    The maximum span width follows the recognizer input, so a 64x256 SVTR model
    simply produces more spans than a 32x320 CRNN one.
    """
    width, height = image.size
    maximum = max(1, int(settings.ocr_rec_width))
    if width <= maximum or width > maximum * 16:
        return [(0, width)]
    gray = np.asarray(image.convert("L"), dtype=np.float32)
    background = float(np.median(np.concatenate((gray[0], gray[-1], gray[:, 0], gray[:, -1]))))
    contrast = np.abs(gray - background)
    threshold = max(20.0, float(np.max(contrast)) * 0.2)
    ink = np.count_nonzero(contrast > threshold, axis=0)
    spans: List[Tuple[int, int]] = []
    left = 0
    while width - left > maximum:
        target = left + int(maximum * 0.8)
        start = left + int(maximum * 0.7)
        end = min(width, left + maximum)
        gaps = np.flatnonzero(ink[start:end] == 0) + start
        if not gaps.size or len(spans) >= 15:
            return [(0, width)]
        runs = np.split(gaps, np.flatnonzero(np.diff(gaps) > 1) + 1)
        gap = min(runs, key=lambda run: (-len(run), abs(float(np.mean(run)) - target)))
        right = int(gap[len(gap) // 2])
        spans.append((left, right))
        left = right
    spans.append((left, width))
    return spans


def _probability_map(outputs: List[np.ndarray]) -> np.ndarray:
    if not outputs:
        raise RuntimeError("DBNet returned no output")
    candidates = [np.squeeze(output) for output in outputs]
    value = max((item for item in candidates if item.ndim == 2), key=lambda item: item.size)
    value = value.astype(np.float32)
    if float(np.min(value)) < 0.0 or float(np.max(value)) > 1.0:
        value = 1.0 / (1.0 + np.exp(-np.clip(value, -30.0, 30.0)))
    return value


def _connected_boxes(probability: np.ndarray, original_size: Tuple[int, int]) -> List[Tuple[int, int, int, int, float]]:
    map_height, map_width = probability.shape
    scale = min(1.0, 320.0 / max(map_width, map_height))
    scan_width = max(1, int(round(map_width * scale)))
    scan_height = max(1, int(round(map_height * scale)))
    scan = np.asarray(
        Image.fromarray(probability).resize((scan_width, scan_height), Image.Resampling.BILINEAR),
        dtype=np.float32,
    )
    mask = scan >= settings.ocr_det_threshold
    visited = np.zeros(mask.shape, dtype=np.bool_)
    boxes: List[Tuple[int, int, int, int, float]] = []
    original_width, original_height = original_size

    for row in range(scan_height):
        for column in range(scan_width):
            if not mask[row, column] or visited[row, column]:
                continue
            stack = [(row, column)]
            visited[row, column] = True
            min_row = max_row = row
            min_column = max_column = column
            values: List[float] = []
            while stack:
                current_row, current_column = stack.pop()
                values.append(float(scan[current_row, current_column]))
                min_row = min(min_row, current_row)
                max_row = max(max_row, current_row)
                min_column = min(min_column, current_column)
                max_column = max(max_column, current_column)
                for next_row, next_column in (
                    (current_row - 1, current_column),
                    (current_row + 1, current_column),
                    (current_row, current_column - 1),
                    (current_row, current_column + 1),
                ):
                    if (
                        0 <= next_row < scan_height
                        and 0 <= next_column < scan_width
                        and mask[next_row, next_column]
                        and not visited[next_row, next_column]
                    ):
                        visited[next_row, next_column] = True
                        stack.append((next_row, next_column))
            component_area = (max_row - min_row + 1) * (max_column - min_column + 1)
            if component_area < max(4, int(settings.ocr_min_box_area * scale * scale)):
                continue
            x0 = int(math.floor(min_column / scan_width * original_width))
            y0 = int(math.floor(min_row / scan_height * original_height))
            x1 = int(math.ceil((max_column + 1) / scan_width * original_width))
            y1 = int(math.ceil((max_row + 1) / scan_height * original_height))
            padding_x = max(2, int((x1 - x0) * 0.03))
            # DBNet's probability component covers the text core, not the full glyph height.
            padding_y = max(2, int(round((y1 - y0) * 0.75)))
            boxes.append(
                (
                    max(0, x0 - padding_x),
                    max(0, y0 - padding_y),
                    min(original_width, x1 + padding_x),
                    min(original_height, y1 + padding_y),
                    sum(values) / len(values),
                )
            )
    boxes.sort(key=lambda item: (item[1], item[0]))
    return boxes[:100]


class OcrEngine:
    def __init__(self) -> None:
        self.detector = MindIRModel(DETECTOR_FILE)
        self.recognizer = MindIRModel(settings.ocr_rec_model or RECOGNIZER_FILE)
        self.orientation = MindIRModel(ORIENTATION_FILE)
        dictionary_path = Path(settings.model_dir) / DICTIONARY_FILE
        self.characters = [line.rstrip("\r\n") for line in dictionary_path.read_text(encoding="utf-8").splitlines()]

    def _detect(self, image: Image.Image) -> List[Tuple[int, int, int, int, float]]:
        output = self.detector.predict(_normalized_rgb(image, (1280, 736), imagenet=True))
        return _connected_boxes(_probability_map(output), image.size)

    def _orient(self, crop: Image.Image) -> Image.Image:
        output = self.orientation.predict(_orientation_input(crop))
        logits = np.squeeze(output[0])
        probabilities = _probabilities(logits)
        if probabilities.size >= 2 and int(np.argmax(probabilities)) == 1 and float(np.max(probabilities)) >= 0.90:
            return crop.rotate(180, expand=True)
        return crop

    def detect_and_recognize(self, image: Image.Image) -> List[TextBlock]:
        blocks: List[TextBlock] = []
        for x0, y0, x1, y1, detector_confidence in self._detect(image):
            source = image.crop((x0, y0, x1, y1))
            # Classify direction per span: squeezing a whole long line can
            # confidently misclassify upright text as upside down.
            spans = _recognition_spans(source)
            pieces = [source.crop((left, 0, right, source.height)) for left, right in spans]
            # A short tail can also give a false 180-degree prediction. All spans
            # belong to one detected line, so use a width-weighted direction vote.
            rotated_width = sum(piece.width for piece in pieces if self._orient(piece) is not piece)
            rotate = rotated_width > source.width / 2
            texts: List[str] = []
            scores: List[float] = []
            weights: List[float] = []
            for (left, right), piece in zip(spans, pieces):
                crop = piece.rotate(180, expand=True) if rotate else piece
                outputs = self.recognizer.predict(_recognition_input(crop))
                logits = max(outputs, key=lambda output: output.size)
                text, recognition_confidence = decode_ctc(logits, self.characters)
                if not text:
                    continue
                texts.append(text)
                scores.append(recognition_confidence)
                weights.append(float(right - left))
            if not texts:
                continue
            # 一个检测框就是一整行：多个 span 必须拼回一个文本块，
            # 否则长行会被切成若干碎片，这正是「断行」的来源。
            total_weight = sum(weights) or 1.0
            recognition_confidence = sum(s * w for s, w in zip(scores, weights)) / total_weight
            confidence = max(0.0, min(1.0, detector_confidence * recognition_confidence))
            blocks.append(
                TextBlock(
                    bbox=[float(x0), float(y0), float(x1 - x0), float(y1 - y0)],
                    text="".join(texts),
                    confidence=round(confidence, 4),
                )
            )
        return blocks


_ENGINE: OcrEngine | None = None


def get_ocr_engine() -> OcrEngine:
    global _ENGINE
    if _ENGINE is None:
        _ENGINE = OcrEngine()
    return _ENGINE
