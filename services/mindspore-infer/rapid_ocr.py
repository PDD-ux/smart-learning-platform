"""RapidOCR（PP-OCRv4 · onnxruntime）本地主力 OCR 引擎 + 图像增强预处理。

为什么需要它
------------
仓库自带的 MindIR 引擎是 DBNet(db_r50_icdar15) + CRNN(crnn_resnet34_ch)：
  - db_r50 在 ICDAR2015 英文场景集上训练，中文版面检测并不强；
  - crnn_resnet34 是较早期的轻量识别模型；
  - 检测后处理是手写连通域，没有 DBNet 标准的 unclip 多边形还原。
而 MindSpore Lite 在 Windows / 无 NPU 环境往往装不上，本机即如此，
于是整条链路一直在 mock，返回空文本。

RapidOCR 用 PP-OCRv4 的 det + cls + rec 三件套走 onnxruntime 纯 CPU 推理：
  - 中文印刷体 / 屏幕文字准确率显著高于 Tesseract chi_sim；
  - 模型随包自带，无需再下载几百 MB 的 MindIR；
  - Windows 零编译，pip 装完即用。

链路位置：inference.detect_text_frames() 中，MindSpore 真引擎不可用时的
**首选 CPU 引擎**，优先级高于 Tesseract。

准确率的两大加成
----------------
1. 图像增强：手机拍照作业常见阴影、光照不均、低对比、轻微模糊，
   直接送 OCR 会大量掉字。这里做「背景估计去阴影 → CLAHE → 锐化」。
2. 多版本融合：同一张图生成多个预处理版本分别识别，
   按位置聚类后每个位置取置信度最高的结果，抵消单一预处理的偏差。

配置项见 config.py：OCR_RAPID_ENABLED / OCR_ENHANCE / OCR_MAX_VARIANTS
/ OCR_GOOD_CONFIDENCE / OCR_MAX_SIDE。
"""

from __future__ import annotations

import logging
import math
from typing import List, Optional, Sequence, Tuple

import numpy as np
from PIL import Image, ImageFilter, ImageOps

from config import settings
from schemas import TextBlock

logger = logging.getLogger(__name__)

# 可选依赖：装了 opencv 就用 CLAHE（效果更好），没装则退回 PIL 的自适应对比。
try:  # pragma: no cover - 依赖环境而定
    import cv2

    _CV2 = True
except ImportError:  # pragma: no cover
    _CV2 = False


# ---------------------------------------------------------------------------
# 引擎单例
# ---------------------------------------------------------------------------

_ENGINE = None
_ENGINE_FAILED = False


def _engine():
    """懒加载 RapidOCR。首次加载约 3~4 秒，失败后不再重试。"""
    global _ENGINE, _ENGINE_FAILED
    if _ENGINE is not None or _ENGINE_FAILED:
        return _ENGINE
    try:
        from rapidocr_onnxruntime import RapidOCR

        # Notebook containers may expose host CPU count while permitting far fewer cores.
        # ORT's default per-model pools then create hundreds of threads and can exceed
        # the product's bounded OCR timeout even after model prewarm.
        _ENGINE = RapidOCR(intra_op_num_threads=4, inter_op_num_threads=1)
        logger.info("RapidOCR engine loaded (PP-OCRv4 / onnxruntime)")
    except (ImportError, OSError, RuntimeError, ValueError, TypeError) as exc:
        _ENGINE_FAILED = True
        logger.warning("RapidOCR unavailable: %s", type(exc).__name__)
    return _ENGINE


def available() -> bool:
    """引擎是否可用（配置开启且包已安装）。"""
    return settings.ocr_rapid_enabled and _engine() is not None


def warmup() -> bool:
    """预加载模型，避免首个识别请求承担 3~4 秒冷启动。

    供 Ascend 预热流程调用；未安装或加载失败时返回 False，不阻断服务启动。
    """
    if not settings.ocr_rapid_enabled:
        return False
    try:
        return _engine() is not None
    except (ImportError, OSError, RuntimeError, ValueError, TypeError):
        return False


# ---------------------------------------------------------------------------
# 图像预处理
# ---------------------------------------------------------------------------


def _fix_orientation(image: Image.Image) -> Image.Image:
    """按 EXIF 方向还原手机照片（拍照作业最常见的「躺着的图」）。"""
    try:
        return ImageOps.exif_transpose(image)
    except (AttributeError, ValueError, OSError):
        return image


def _resize_bounds(image: Image.Image) -> Image.Image:
    """限制最长边，同时把过小的图放大到可读尺寸。

    PP-OCR 的 det 模型对过小的文字无能为力；而过大的图只会拖慢推理。
    """
    width, height = image.size
    longest = max(width, height)
    maximum = max(640, settings.ocr_max_side)
    if longest > maximum:
        scale = maximum / float(longest)
        return image.resize((max(1, int(width * scale)), max(1, int(height * scale))), Image.Resampling.LANCZOS)
    # 文字高度低于 ~16px 时识别率明显下降，这里保证短边不低于 480。
    if longest < 480:
        scale = 480.0 / float(longest)
        return image.resize((max(1, int(width * scale)), max(1, int(height * scale))), Image.Resampling.LANCZOS)
    return image


def _deshadow(image: Image.Image) -> Image.Image:
    """去除阴影与光照不均。

    思路：把图缩到极小再放大，得到一张「只有明暗渐变、没有文字」的背景估计图，
    用原图除以背景即可抹平光照。比形态学开运算快得多，也不需要 opencv。
    """
    gray = np.asarray(image.convert("L"), dtype=np.float32)
    height, width = gray.shape
    small_width = max(2, width // 16)
    small_height = max(2, height // 16)
    small = np.asarray(image.convert("L").resize((small_width, small_height), Image.Resampling.BILINEAR), dtype=np.float32)
    background = np.asarray(
        Image.fromarray(small, mode="F").resize((width, height), Image.Resampling.BILINEAR),
        dtype=np.float32,
    )
    background = np.maximum(background, 1.0)
    normalized = np.clip(gray / background * float(np.median(background)), 0.0, 255.0)
    return Image.fromarray(normalized.astype(np.uint8), mode="L").convert("RGB")


def _contrast(image: Image.Image) -> Image.Image:
    """CLAHE 局部对比度增强（opencv 可用时）或 PIL 自适应对比。"""
    if _CV2:
        gray = np.asarray(image.convert("L"), dtype=np.uint8)
        equalized = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8)).apply(gray)
        return Image.fromarray(equalized, mode="L").convert("RGB")
    return ImageOps.autocontrast(image.convert("L"), cutoff=1).convert("RGB")


def _sharpen(image: Image.Image) -> Image.Image:
    """轻度锐化，恢复拍照/压缩造成的边缘发虚。"""
    return image.filter(ImageFilter.UnsharpMask(radius=1.2, percent=130, threshold=3))


def _binarize(image: Image.Image) -> Image.Image:
    """自适应阈值二值化，对印刷体文档和小字号有额外收益。"""
    gray = np.asarray(image.convert("L"), dtype=np.uint8)
    if _CV2:
        binary = cv2.adaptiveThreshold(gray, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY, 31, 10)
    else:
        # 无 opencv 时用 Otsu 类阈值：取灰度直方图的最小类间方差切点。
        histogram = np.bincount(gray.ravel(), minlength=256).astype(np.float64)
        total = histogram.sum()
        if total <= 0:
            return image.convert("RGB")
        weight_background = np.cumsum(histogram)
        weight_foreground = total - weight_background
        mean_background = np.cumsum(histogram * np.arange(256)) / np.maximum(weight_background, 1e-6)
        mean_foreground = (np.cumsum((histogram * np.arange(256))[::-1])[::-1]) / np.maximum(weight_foreground, 1e-6)
        variance = weight_background * weight_foreground * (mean_background - mean_foreground) ** 2
        threshold = float(np.argmax(variance))
        binary = np.where(gray > threshold, 255, 0).astype(np.uint8)
    return Image.fromarray(binary, mode="L").convert("RGB")


def _base(image: Image.Image) -> Image.Image:
    """所有版本的公共前置处理：EXIF 方向 + 尺寸归一化。"""
    return _resize_bounds(_fix_orientation(image))


def _variants(image: Image.Image, count: int) -> List[Tuple[str, Image.Image]]:
    """生成待识别的预处理版本，按预期收益排序。

    count=1 只跑增强版（快）；count>=2 追加原图；count>=4 再追加二值化与 2x 放大。
    """
    base = _base(image)
    if not settings.ocr_enhance:
        return [("raw", base)]

    enhanced = _sharpen(_contrast(_deshadow(base)))
    result: List[Tuple[str, Image.Image]] = [("enhanced", enhanced)]
    if count >= 2:
        result.append(("raw", base))
    if count >= 3:
        result.append(("binary", _binarize(_deshadow(base))))
    if count >= 4:
        result.append(
            ("upscale", base.resize((base.width * 2, base.height * 2), Image.Resampling.LANCZOS))
        )
    return result[: max(1, min(4, count))]


# ---------------------------------------------------------------------------
# 结果融合
# ---------------------------------------------------------------------------

Box = Tuple[float, float, float, float]  # x0, y0, x1, y1
Candidate = Tuple[Box, str, float]


def _run_once(engine, image: Image.Image) -> List[Candidate]:
    """对一个预处理版本执行识别，返回候选框。"""
    try:
        result, _ = engine(np.asarray(image.convert("RGB")))
    except (OSError, RuntimeError, ValueError, TypeError) as exc:
        logger.warning("RapidOCR inference failed: %s", type(exc).__name__)
        return []
    if not result:
        return []
    candidates: List[Candidate] = []
    for item in result:
        points = item[0]
        text = (item[1] or "").strip()
        score = float(item[2])
        if not text or not math.isfinite(score) or score <= 0:
            continue
        xs = [float(point[0]) for point in points]
        ys = [float(point[1]) for point in points]
        candidates.append(((min(xs), min(ys), max(xs), max(ys)), text, score))
    return candidates


def _merge(candidates: Sequence[Candidate]) -> List[TextBlock]:
    """按视觉阅读顺序聚类融合：先分行，行内再按列分槽，每槽取置信度最高者。

    同一块文字在多个预处理版本里会重复出现，融合能同时去掉坏结果、保住好结果。
    """
    if not candidates:
        return []

    # 1) 按中心 y 分行：行高阈值取候选框高度中位数的一半。
    heights = sorted(box[3] - box[1] for box, _, _ in candidates)
    median_height = heights[len(heights) // 2] or 1.0
    row_threshold = max(4.0, median_height * 0.6)

    ordered = sorted(candidates, key=lambda item: ((item[0][1] + item[0][3]) / 2.0, item[0][0]))
    rows: List[List[Candidate]] = []
    for candidate in ordered:
        box = candidate[0]
        center_y = (box[1] + box[3]) / 2.0
        if rows and abs(center_y - (rows[-1][0][0][1] + rows[-1][0][0][3]) / 2.0) <= row_threshold:
            rows[-1].append(candidate)
        else:
            rows.append([candidate])

    blocks: List[TextBlock] = []
    for row in rows:
        # 2) 行内按 x 分槽：水平重叠超过一半视为同一处文字的不同版本。
        slots: List[List[Candidate]] = []
        for candidate in sorted(row, key=lambda item: item[0][0]):
            box = candidate[0]
            placed = False
            for slot in slots:
                reference = slot[0][0]
                overlap = min(box[2], reference[2]) - max(box[0], reference[0])
                if overlap > 0.5 * min(box[2] - box[0], reference[2] - reference[0]):
                    slot.append(candidate)
                    placed = True
                    break
            if not placed:
                slots.append([candidate])

        # 3) 每个槽位取胜出者：置信度优先，其次取信息量更大的长文本。
        for slot in slots:
            best = max(slot, key=lambda item: (item[2], len(item[1])))
            box, text, score = best
            blocks.append(
                TextBlock(
                    bbox=[box[0], box[1], max(0.0, box[2] - box[0]), max(0.0, box[3] - box[1])],
                    text=text,
                    confidence=round(min(1.0, max(0.0, score)), 4),
                )
            )
    return blocks


def average_confidence(blocks: Sequence[TextBlock]) -> float:
    """一组文字块的平均置信度，用于判断结果是否可信、是否需要换后端。"""
    if not blocks:
        return 0.0
    return sum(block.confidence for block in blocks) / len(blocks)


# ---------------------------------------------------------------------------
# 对外入口
# ---------------------------------------------------------------------------


def recognize(image: Image.Image) -> Tuple[List[TextBlock], str]:
    """识别一张图，返回 (文字块, 使用的版本名)。

    策略：先用增强版快速识别；置信度不够再逐步加入更多预处理版本重跑并融合。
    """
    engine = _engine()
    if engine is None:
        return [], "unavailable"

    maximum = max(1, min(4, settings.ocr_max_variants))
    # 预处理是纯 PIL 运算，成本远低于一次推理，一次性全部生成后按需取用。
    pool = _variants(image, maximum)

    used = 1
    candidates = _run_once(engine, pool[0][1])
    blocks = _merge(candidates)

    # 首轮已经够好就收工；否则逐个追加版本重跑并融合，直到达到上限。
    while used < maximum and (
        not blocks or average_confidence(blocks) < settings.ocr_good_confidence
    ):
        candidates.extend(_run_once(engine, pool[used][1]))
        used += 1
        blocks = _merge(candidates)

    return blocks, f"rapidocr(variants={used})"
