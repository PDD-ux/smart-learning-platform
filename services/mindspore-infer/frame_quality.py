"""Rule-based key-frame scoring: clarity, perceptual deduplication and text density."""

from __future__ import annotations

import math
from typing import List, Tuple

import numpy as np
from PIL import Image

from config import settings
from schemas import FrameInput, SelectedFrame
from vision_io import decode_frame


def _gray_small(image: Image.Image, size: Tuple[int, int] = (160, 90)) -> np.ndarray:
    return np.asarray(image.convert("L").resize(size, Image.Resampling.BILINEAR), dtype=np.float32)


def clarity_score(image: Image.Image) -> float:
    gray = _gray_small(image)
    center = gray[1:-1, 1:-1]
    laplace = (
        gray[:-2, 1:-1]
        + gray[2:, 1:-1]
        + gray[1:-1, :-2]
        + gray[1:-1, 2:]
        - 4.0 * center
    )
    variance = float(np.var(laplace))
    return max(0.0, min(1.0, 1.0 - math.exp(-variance / 180.0)))


def text_density_score(image: Image.Image) -> float:
    gray = _gray_small(image)
    gradient = np.zeros_like(gray)
    gradient[:, 1:] += np.abs(gray[:, 1:] - gray[:, :-1])
    gradient[1:, :] += np.abs(gray[1:, :] - gray[:-1, :])
    edge_density = float(np.mean(gradient > 38.0))
    return max(0.0, min(1.0, edge_density / 0.18))


def perceptual_hash(image: Image.Image) -> np.ndarray:
    gray = np.asarray(
        image.convert("L").resize((8, 8), Image.Resampling.BILINEAR),
        dtype=np.float32,
    )
    return gray >= float(np.mean(gray))


def hamming_distance(left: np.ndarray, right: np.ndarray) -> int:
    return int(np.count_nonzero(left != right))


def quality_select_frames(frames: List[FrameInput], sample_every: int = 1) -> List[SelectedFrame]:
    result: List[SelectedFrame] = []
    recent_hashes: List[np.ndarray] = []
    step = max(1, sample_every)

    for position, frame in enumerate(frames):
        timestamp = frame.timestampMs or 0
        if position % step != 0:
            result.append(SelectedFrame(frameIndex=frame.frameIndex, timestampMs=timestamp, score=0.0, keep=False, reason="sampled-out"))
            continue
        try:
            image = decode_frame(frame)
        except ValueError:
            result.append(SelectedFrame(frameIndex=frame.frameIndex, timestampMs=timestamp, score=0.0, keep=False, reason="invalid-image"))
            continue

        sharpness = clarity_score(image)
        density = text_density_score(image)
        current_hash = perceptual_hash(image)
        minimum_distance = min(
            (hamming_distance(current_hash, old_hash) for old_hash in recent_hashes),
            default=64,
        )
        duplicate = minimum_distance <= settings.frame_duplicate_hamming
        uniqueness = min(1.0, minimum_distance / 24.0)
        score = max(0.0, min(1.0, 0.50 * sharpness + 0.35 * density + 0.15 * uniqueness))
        keep = (
            not duplicate
            and sharpness >= settings.frame_min_clarity
            and (score >= settings.frame_keep_threshold or not recent_hashes)
        )
        if duplicate:
            reason = "duplicate"
        elif sharpness < settings.frame_min_clarity:
            reason = "blurred"
        elif keep:
            reason = "quality-text-density"
        else:
            reason = "low-information"
        if keep:
            recent_hashes.append(current_hash)
            recent_hashes = recent_hashes[-8:]
        result.append(
            SelectedFrame(
                frameIndex=frame.frameIndex,
                timestampMs=timestamp,
                score=round(score, 4),
                keep=keep,
                reason=reason,
            )
        )
    return result
