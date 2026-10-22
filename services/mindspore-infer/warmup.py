"""在真实 Ascend 服务启动阶段预热四个 MindIR（tasks.md §5.3）。"""

from __future__ import annotations

import logging
import time
from typing import Tuple

import numpy as np

from config import settings
from device import mindspore_lite_available, model_load_status
from inference import CLASSIFIER
from model_runtime import MindIRModel
from ocr_runtime import get_ocr_engine
import rapid_ocr

logger = logging.getLogger(__name__)


def prewarm_models() -> None:
    """Ascend 上 fail fast；CPU/GPU/mock 保留既有懒加载与降级语义。"""
    if settings.mock or settings.device != "ascend" or not settings.prewarm_models:
        return
    if not mindspore_lite_available():
        raise RuntimeError("Ascend prewarm requires mindspore_lite")

    status = model_load_status()
    missing = [name for name, ready in status.items() if not ready]
    if missing:
        raise RuntimeError("Ascend prewarm missing model assets: " + ", ".join(missing))

    engine = get_ocr_engine()
    models: Tuple[Tuple[str, MindIRModel, Tuple[int, int, int, int]], ...] = (
        ("textDetector", engine.detector, (1, 3, 736, 1280)),
        ("orientationClassifier", engine.orientation, (1, 3, 48, 192)),
        ("textRecognizer", engine.recognizer, (1, 3, 32, 320)),
        ("classifier", CLASSIFIER, (1, 3, 224, 224)),
    )
    for name, model, shape in models:
        started_at = time.monotonic()
        try:
            model.predict(np.zeros(shape, dtype=np.float32))
        except Exception as exc:
            # 不记录异常正文、模型绝对路径或服务令牌；失败时 Uvicorn 不开放端口。
            logger.error("Ascend prewarm failed for %s: %s", name, type(exc).__name__)
            raise RuntimeError(f"Ascend prewarm failed for {name}") from exc
        logger.info("Ascend prewarm %s complete in %.1fs", name, time.monotonic() - started_at)

    _prewarm_rapidocr()


def _prewarm_rapidocr() -> None:
    """预热 RapidOCR（PP-OCRv4），避免演示首次 OCR 承担几秒冷启动。

    未安装该包时静默跳过——Ascend 环境并非都有对应的 onnxruntime wheel，
    缺包应退回 MindSpore，而不是让服务起不来。
    """
    started_at = time.monotonic()
    if rapid_ocr.warmup():
        logger.info("Ascend prewarm rapidocr complete in %.1fs", time.monotonic() - started_at)
    else:
        logger.warning("RapidOCR prewarm skipped (not installed or disabled); MindSpore OCR stays primary")
