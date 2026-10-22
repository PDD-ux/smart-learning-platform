"""Bounded Tesseract CPU OCR fallback for Linux inference deployments."""

from __future__ import annotations

import csv
import io
import logging
import math
import shutil
import subprocess
from typing import Dict, List, Tuple

from PIL import Image

from config import settings
from schemas import TextBlock

logger = logging.getLogger(__name__)


def tesseract_available() -> bool:
    return settings.ocr_fallback_enabled and shutil.which(settings.tesseract_cmd) is not None


def _join_words(words: List[str]) -> str:
    output = ""
    for word in words:
        if not output:
            output = word
        elif output[-1].isascii() and output[-1].isalnum() and word[0].isascii() and word[0].isalnum():
            output += " " + word
        else:
            output += word
    return output.strip()


def recognize_text(image: Image.Image) -> List[TextBlock]:
    """Run Tesseract TSV on one RGB image and return line-level text blocks."""
    if not tesseract_available():
        return []

    png = io.BytesIO()
    image.convert("RGB").save(png, format="PNG", optimize=False)
    try:
        completed = subprocess.run(
            [settings.tesseract_cmd, "stdin", "stdout", "-l", settings.tesseract_lang, "tsv"],
            input=png.getvalue(),
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            timeout=settings.tesseract_timeout_sec,
            check=False,
        )
    except (OSError, subprocess.TimeoutExpired) as exc:
        logger.warning("Tesseract fallback unavailable: %s", type(exc).__name__)
        return []

    if completed.returncode != 0:
        logger.warning("Tesseract fallback exited with status %s", completed.returncode)
        return []

    try:
        reader = csv.DictReader(io.StringIO(completed.stdout.decode("utf-8")), delimiter="\t")
        grouped: Dict[Tuple[str, str, str, str], List[Tuple[int, str, float, int, int, int, int]]] = {}
        for row in reader:
            if row.get("level") != "5":
                continue
            text = (row.get("text") or "").strip()
            if not text:
                continue
            confidence = float(row.get("conf") or "-1")
            if not math.isfinite(confidence) or confidence < 0:
                continue
            key = (row.get("page_num", "0"), row.get("block_num", "0"), row.get("par_num", "0"), row.get("line_num", "0"))
            grouped.setdefault(key, []).append((
                int(row.get("word_num") or "0"), text, confidence,
                int(row.get("left") or "0"), int(row.get("top") or "0"),
                int(row.get("width") or "0"), int(row.get("height") or "0"),
            ))
    except (UnicodeDecodeError, TypeError, ValueError, csv.Error) as exc:
        logger.warning("Tesseract fallback returned invalid TSV: %s", type(exc).__name__)
        return []

    blocks: List[TextBlock] = []
    for words in grouped.values():
        words.sort(key=lambda item: item[0])
        left = min(item[3] for item in words)
        top = min(item[4] for item in words)
        right = max(item[3] + item[5] for item in words)
        bottom = max(item[4] + item[6] for item in words)
        text = _join_words([item[1] for item in words])
        if text and right > left and bottom > top:
            blocks.append(TextBlock(
                bbox=[float(left), float(top), float(right - left), float(bottom - top)],
                text=text,
                confidence=min(1.0, max(0.0, sum(item[2] for item in words) / len(words) / 100.0)),
            ))
    return blocks
