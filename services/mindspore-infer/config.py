"""MindSpore 端侧推理服务 · 配置（tasks.md §5.1）

对齐平台侧环境变量约定（.env.example / DEPLOY.md §4）：
  - ASCEND_INFER_URL       平台侧发现本服务的地址（本服务自身不读取）
  - ASCEND_INFER_TOKEN     服务级共享密钥，对应请求头 X-Infer-Token
  - ASCEND_INFER_TIMEOUT_MS 超时（毫秒），由平台侧控制
  - ASCEND_DEVICE          后端设备：cpu | gpu | ascend

说明：为减少部署依赖，这里使用标准库 os.environ 而非 pydantic-settings。
"""

from __future__ import annotations

import os
from dataclasses import dataclass

SERVICE_NAME = "mindspore-infer"
SERVICE_VERSION = "0.2.0"


def _int_env(name: str, default: int) -> int:
    raw = os.getenv(name, "").strip()
    if not raw:
        return default
    try:
        value = int(raw)
        return value if value > 0 else default
    except ValueError:
        return default


def _positive_int_env(name: str, default: int) -> int:
    value = _int_env(name, default)
    return value if value > 0 else default


def _bool_env(name: str, default: bool) -> bool:
    raw = os.getenv(name, "").strip().lower()
    if raw in ("1", "true", "yes", "on"):
        return True
    if raw in ("0", "false", "no", "off"):
        return False
    return default


def _float_env(name: str, default: float) -> float:
    raw = os.getenv(name, "").strip()
    if not raw:
        return default
    try:
        value = float(raw)
        return value if value >= 0 else default
    except ValueError:
        return default


def _secret_env(name: str, development_default: str) -> str:
    value = os.getenv(name, "").strip()
    if os.getenv("NODE_ENV", "").strip().lower() == "production":
        if not value or value == development_default:
            raise RuntimeError(f"{name} must be configured to a non-default value in production")
    return value or development_default


@dataclass(frozen=True)
class Settings:
    service_name: str
    version: str
    device: str
    infer_token: str
    timeout_ms: int
    max_frames: int
    max_image_bytes: int
    max_request_bytes: int
    model_dir: str
    mock: bool
    prewarm_models: bool
    log_level: str
    ocr_det_threshold: float
    ocr_min_box_area: int
    # 识别模型规格：换成 SVTR 中文版只需改这四项，不必改代码
    ocr_rec_model: str
    ocr_rec_height: int
    ocr_rec_width: int
    ocr_rec_normalize: str
    ocr_rec_channel: str
    # RapidOCR（PP-OCRv4 本地 CPU 引擎）与图像增强相关
    ocr_rapid_enabled: bool
    ocr_primary: str
    ocr_enhance: bool
    ocr_max_variants: int
    ocr_good_confidence: float
    ocr_max_side: int
    frame_min_clarity: float
    frame_duplicate_hamming: int
    frame_keep_threshold: float
    classifier_invalid_threshold: float
    ocr_fallback_enabled: bool
    tesseract_cmd: str
    tesseract_lang: str
    tesseract_timeout_sec: int


def load_settings() -> Settings:
    device = os.getenv("ASCEND_DEVICE", "cpu").strip().lower() or "cpu"
    return Settings(
        service_name=SERVICE_NAME,
        version=SERVICE_VERSION,
        device=device,
        infer_token=_secret_env("ASCEND_INFER_TOKEN", "dev-infer-token"),
        timeout_ms=_int_env("ASCEND_INFER_TIMEOUT_MS", 8000),
        max_frames=_positive_int_env("INFER_MAX_FRAMES", 120),
        max_image_bytes=_positive_int_env("INFER_MAX_IMAGE_BYTES", 5 * 1024 * 1024),
        max_request_bytes=_positive_int_env("INFER_MAX_REQUEST_BYTES", 20 * 1024 * 1024),
        model_dir=os.getenv("INFER_MODEL_DIR", "models"),
        # 默认 mock（MVP）；接入 §5.3 训练产物后置 false 走真实推理
        mock=_bool_env("INFER_MOCK", True),
        prewarm_models=_bool_env("INFER_PREWARM", device == "ascend"),
        log_level=os.getenv("LOG_LEVEL", "info").strip().lower() or "info",
        ocr_det_threshold=_float_env("OCR_DET_THRESHOLD", 0.30),
        ocr_min_box_area=_positive_int_env("OCR_MIN_BOX_AREA", 64),
        ocr_rec_model=os.getenv("OCR_REC_MODEL", "crnn_resnet34_ch.mindir").strip() or "crnn_resnet34_ch.mindir",
        ocr_rec_height=_positive_int_env("OCR_REC_HEIGHT", 32),
        ocr_rec_width=_positive_int_env("OCR_REC_WIDTH", 320),
        ocr_rec_normalize=(
            lambda value: value if value in ("minus_127", "imagenet", "half", "raw") else "minus_127"
        )(os.getenv("OCR_REC_NORMALIZE", "minus_127").strip().lower()),
        # MindOCR 训练用 cv2 读图（BGR）；默认 rgb 保持 CRNN 既有行为不变
        ocr_rec_channel=(lambda value: value if value in ("rgb", "bgr") else "rgb")(
            os.getenv("OCR_REC_CHANNEL", "rgb").strip().lower()
        ),
        ocr_rapid_enabled=_bool_env("OCR_RAPID_ENABLED", True),
        ocr_primary=(lambda value: value if value in ("auto", "mindspore", "rapidocr") else "auto")(
            os.getenv("OCR_PRIMARY", "auto").strip().lower()
        ),
        ocr_enhance=_bool_env("OCR_ENHANCE", True),
        ocr_max_variants=max(1, min(4, _int_env("OCR_MAX_VARIANTS", 3))),
        ocr_good_confidence=min(1.0, max(0.0, _float_env("OCR_GOOD_CONFIDENCE", 0.85))),
        ocr_max_side=_positive_int_env("OCR_MAX_SIDE", 1600),
        frame_min_clarity=_float_env("FRAME_MIN_CLARITY", 0.08),
        frame_duplicate_hamming=_positive_int_env("FRAME_DUPLICATE_HAMMING", 6),
        frame_keep_threshold=_float_env("FRAME_KEEP_THRESHOLD", 0.28),
        classifier_invalid_threshold=min(1.0, max(0.0, _float_env("CLASSIFIER_INVALID_THRESHOLD", 0.95))),
        ocr_fallback_enabled=_bool_env("OCR_FALLBACK_ENABLED", True),
        tesseract_cmd=os.getenv("TESSERACT_CMD", "tesseract").strip() or "tesseract",
        tesseract_lang=os.getenv("TESSERACT_LANG", "chi_sim+eng").strip() or "chi_sim+eng",
        tesseract_timeout_sec=_positive_int_env("TESSERACT_TIMEOUT_SEC", 30),
    )


settings = load_settings()
