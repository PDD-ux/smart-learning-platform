"""端侧推理实现：三类关键帧、OCR 与质量筛选。"""

from __future__ import annotations

import logging
from typing import List, Sequence, Tuple

import numpy as np
from PIL import Image

from config import settings
from device import mindspore_lite_available, model_load_status, ocr_backend, ocr_models_ready
from frame_quality import quality_select_frames
from model_runtime import MindIRModel
from models import CLASSIFIER_LABELS, IMAGE_SIZE
from ocr_runtime import get_ocr_engine
import rapid_ocr
from schemas import (
    CategoryItem,
    DetectTextItem,
    FrameInput,
    SelectedFrame,
    TextBlock,
)
from tesseract_ocr import recognize_text
from vision_io import decode_frame

logger = logging.getLogger(__name__)

# mock 分类使用未确定标记，不冒充模型识别结果。
MOCK_CATEGORY = "unknown"
MOCK_KEEP_SCORE = 0.6
MOCK_DROP_SCORE = 0.3
CLASSIFIER = MindIRModel("keyframe_classifier_v3_balanced.mindir")


def _classifier_input(image: Image.Image) -> np.ndarray:
    """与训练集 Decode→Resize→HWC2CHW→Rescale 的输入规格一致。"""
    resized = image.convert("RGB").resize((IMAGE_SIZE, IMAGE_SIZE), Image.Resampling.BILINEAR)
    pixels = np.asarray(resized, dtype=np.float32)
    return np.ascontiguousarray(pixels.transpose(2, 0, 1)[None, ...] / 255.0)


def _category_from_logits(outputs: List[np.ndarray]) -> str:
    if len(outputs) != 1:
        raise ValueError("classifier must have one output")
    logits = np.asarray(outputs[0], dtype=np.float64)
    if logits.shape != (1, len(CLASSIFIER_LABELS)) or not np.isfinite(logits).all():
        raise ValueError("classifier output must be finite [1,3] logits")
    scores = np.exp(logits[0] - np.max(logits[0]))
    probabilities = scores / np.sum(scores)
    predicted = int(np.argmax(probabilities))
    if CLASSIFIER_LABELS[predicted] == "invalid" and probabilities[predicted] < settings.classifier_invalid_threshold:
        return MOCK_CATEGORY
    return CLASSIFIER_LABELS[predicted]


def classify_frames(frames: List[FrameInput]) -> List[CategoryItem]:
    if settings.mock or not model_load_status()["classifier"] or not mindspore_lite_available():
        return [CategoryItem(frameIndex=frame.frameIndex, category=MOCK_CATEGORY) for frame in frames]

    result: List[CategoryItem] = []
    for frame in frames:
        try:
            category = _category_from_logits(CLASSIFIER.predict(_classifier_input(decode_frame(frame))))
        except (ImportError, OSError, RuntimeError, ValueError, TypeError) as exc:
            logger.warning("classifier failed for frame %s: %s", frame.frameIndex, type(exc).__name__)
            category = MOCK_CATEGORY
        result.append(CategoryItem(frameIndex=frame.frameIndex, category=category))
    return result


_MS_ENGINE = None
_MS_ENGINE_FAILED = False


def _mindspore_engine():
    """MindSpore MindIR 引擎（仅 NPU/装了 Lite 的环境可用），失败后不再重试。"""
    global _MS_ENGINE, _MS_ENGINE_FAILED
    if _MS_ENGINE is not None or _MS_ENGINE_FAILED:
        return _MS_ENGINE
    if not (ocr_models_ready() and mindspore_lite_available()):
        _MS_ENGINE_FAILED = True
        return None
    try:
        _MS_ENGINE = get_ocr_engine()
    except (ImportError, OSError, RuntimeError, ValueError, TypeError) as exc:
        logger.warning("MindSpore OCR initialization failed; falling back to CPU engine: %s", type(exc).__name__)
        _MS_ENGINE_FAILED = True
    return _MS_ENGINE


def _run_backend(name: str, image) -> List[TextBlock]:
    """执行单个后端；任何异常都降级为空结果，不影响其它后端。"""
    if name == "mindspore":
        global _MS_ENGINE
        engine = _mindspore_engine()
        if engine is None:
            return []
        try:
            return engine.detect_and_recognize(image)
        except (ImportError, OSError, RuntimeError, ValueError, TypeError) as exc:
            logger.warning("MindSpore OCR failed: %s", type(exc).__name__)
            _MS_ENGINE = None  # 单帧失败即整体降级，避免每帧都空跑
            return []
    if name == "rapidocr":
        if not rapid_ocr.available():
            return []
        try:
            blocks, _ = rapid_ocr.recognize(image)
            return blocks
        except (ImportError, OSError, RuntimeError, ValueError, TypeError) as exc:
            logger.warning("RapidOCR failed: %s", type(exc).__name__)
            return []
    if name == "tesseract":
        return recognize_text(image)
    return []


def _backend_order() -> List[str]:
    """决定后端尝试顺序。

    OCR_PRIMARY：
      - auto（默认）：昇腾真引擎可用就先跑它，否则先用本地 PP-OCRv4；
      - mindspore：坚持昇腾主线（演示场景）；
      - rapidocr：以识别率为先。
    无论哪种顺序，识别质量不达标时都会继续尝试下一个后端（见 _recognize_frame）。
    """
    primary = settings.ocr_primary
    if primary == "rapidocr":
        order = ["rapidocr", "mindspore"]
    elif primary == "mindspore":
        order = ["mindspore", "rapidocr"]
    elif _mindspore_engine() is not None:
        order = ["mindspore", "rapidocr"]
    else:
        order = ["rapidocr", "mindspore"]
    if settings.ocr_fallback_enabled:
        order.append("tesseract")
    return order


def _recognize_frame(image) -> Tuple[List[TextBlock], str]:
    """识别一帧并返回 (文字块, 命中的引擎名)。

    策略是「择优」而不是「首次命中即返回」：
      1. 按 _backend_order() 依次尝试；
      2. 一旦结果达到 OCR_GOOD_CONFIDENCE 立即收工（省时间）；
      3. 否则继续试下一个后端，最终取平均置信度最高的那份结果。
    这样昇腾主线演示不受影响，而老模型（DBNet+CRNN）漏题号、断行导致置信偏低时，
    会自动改用 PP-OCRv4 的结果。
    """
    best: List[TextBlock] = []
    best_name = "none"
    best_score = 0.0
    for name in _backend_order():
        blocks = _run_backend(name, image)
        if not blocks:
            continue
        score = rapid_ocr.average_confidence(blocks)
        if score > best_score:
            best, best_name, best_score = blocks, name, score
        if best_score >= settings.ocr_good_confidence:
            break
    return best, best_name


def detect_text_frames(frames: List[FrameInput]) -> List[DetectTextItem]:
    if settings.mock:
        logger.warning(
            "INFER_MOCK=true：所有 OCR 请求返回空结果（本机可用后端：%s）。"
            "需要真实识别请在推理服务环境变量中设置 INFER_MOCK=false。",
            ocr_backend(),
        )
        return [DetectTextItem(frameIndex=frame.frameIndex, blocks=[]) for frame in frames]

    result: List[DetectTextItem] = []
    for frame in frames:
        try:
            image = decode_frame(frame)
        except (ValueError, OSError) as exc:
            logger.warning("OCR image decode failed for frame %s: %s", frame.frameIndex, type(exc).__name__)
            result.append(DetectTextItem(frameIndex=frame.frameIndex, blocks=[]))
            continue

        blocks, backend = _recognize_frame(image)
        if not blocks:
            logger.info("frame %s produced no text (backend=%s)", frame.frameIndex, backend)
        result.append(DetectTextItem(frameIndex=frame.frameIndex, blocks=blocks))
    return result


def select_frames(
    frames: List[FrameInput],
    sample_every: int = 1,
    strategy: str = "uniform",
) -> List[SelectedFrame]:
    """quality uses rule scoring; uniform remains the safe compatibility fallback."""
    if strategy == "quality":
        return quality_select_frames(frames, sample_every)
    step = max(1, sample_every)
    result: List[SelectedFrame] = []
    for index, frame in enumerate(frames):
        keep = index % step == 0
        result.append(
            SelectedFrame(
                frameIndex=frame.frameIndex,
                timestampMs=frame.timestampMs or 0,
                score=MOCK_KEEP_SCORE if keep else MOCK_DROP_SCORE,
                keep=keep,
                reason="uniform" if keep else "uniform-dropped",
            )
        )
    return result
