"""后端设备与模型加载状态探测（tasks.md §5.1）

MVP 无 NPU 环境时以 mock 模式运行；接入 §5.3 训练产物后 models_loaded 置 true。
"""

from __future__ import annotations

import importlib.util
from typing import Any, Dict

from config import settings
from tesseract_ocr import tesseract_available

_MODEL_FILES = {
    "classifier": ("keyframe_classifier_v3_balanced.mindir",),
    "textDetector": ("db_r50_icdar15-ch.mindir",),
    "textRecognizer": ("crnn_resnet34_ch.mindir",),
    "orientationClassifier": ("cls_mv3.mindir",),
    "characterDictionary": ("ch_dict.txt",),
}


def mindspore_available() -> bool:
    return (
        importlib.util.find_spec("mindspore_lite") is not None
        or importlib.util.find_spec("mindspore") is not None
    )


def mindspore_lite_available() -> bool:
    return importlib.util.find_spec("mindspore_lite") is not None


def model_load_status() -> Dict[str, bool]:
    import os

    status: Dict[str, bool] = {}
    for name, candidates in _MODEL_FILES.items():
        status[name] = any(
            os.path.isfile(os.path.join(settings.model_dir, filename))
            for filename in candidates
        )
    return status


def rapidocr_available() -> bool:
    """RapidOCR（PP-OCRv4 本地 CPU 引擎）是否可用。

    只探测包是否存在，不加载模型，因此 /health 不会被几秒的冷启动拖慢。
    """
    return settings.ocr_rapid_enabled and importlib.util.find_spec("rapidocr_onnxruntime") is not None


def ocr_backend() -> str:
    """当前实际可用的最高优先级 OCR 后端（不触发模型加载）。

    优先级与 inference._recognize_frame() 保持一致：
    MindSpore（昇腾） > RapidOCR（PP-OCRv4 CPU） > Tesseract。
    """
    if settings.mock:
        return "mock"
    if ocr_models_ready() and mindspore_lite_available():
        return "mindspore"
    if rapidocr_available():
        return "rapidocr"
    if tesseract_available():
        return "tesseract"
    return "none"


def ocr_models_ready() -> bool:
    status = model_load_status()
    return all(
        status.get(name, False)
        for name in (
            "textDetector",
            "textRecognizer",
            "orientationClassifier",
            "characterDictionary",
        )
    )


def device_info() -> Dict[str, Any]:
    models = model_load_status()
    return {
        "device": settings.device,
        "mindsporeAvailable": mindspore_available(),
        "mindsporeLiteAvailable": mindspore_lite_available(),
        "modelsLoaded": ocr_models_ready() and mindspore_lite_available(),
        "modelFilesReady": ocr_models_ready(),
        "tesseractAvailable": tesseract_available(),
        "ocrFallbackAvailable": tesseract_available(),
        "rapidocrAvailable": rapidocr_available(),
        "ocrBackend": ocr_backend(),
        "modelStatus": models,
        "qualityFrameSelector": True,
        "mock": settings.mock,
    }
