"""Bounded image decoding shared by OCR and key-frame selection."""

from __future__ import annotations

import base64
import binascii
import io
import urllib.request
from typing import Final
from urllib.parse import urlparse

from PIL import Image, UnidentifiedImageError

from config import settings
from schemas import FrameInput

MAX_IMAGE_PIXELS: Final[int] = 50_000_000


def _read_url(url: str) -> bytes:
    parsed = urlparse(url)
    if parsed.scheme not in ("http", "https"):
        raise ValueError("imageUrl must use http or https")
    request = urllib.request.Request(url, headers={"User-Agent": "mindspore-infer/0.2"})
    with urllib.request.urlopen(request, timeout=max(1.0, settings.timeout_ms / 1000.0)) as response:
        payload = response.read(settings.max_image_bytes + 1)
    if len(payload) > settings.max_image_bytes:
        raise ValueError("remote image exceeds configured size limit")
    return payload


def decode_frame(frame: FrameInput) -> Image.Image:
    if frame.imageBase64:
        encoded = frame.imageBase64.split(",", 1)[-1]
        try:
            payload = base64.b64decode(encoded, validate=True)
        except (binascii.Error, ValueError) as exc:
            raise ValueError("invalid base64 image") from exc
        if len(payload) > settings.max_image_bytes:
            raise ValueError("image exceeds configured size limit")
    elif frame.imageUrl:
        payload = _read_url(frame.imageUrl)
    else:
        raise ValueError("frame has no image source")

    try:
        with Image.open(io.BytesIO(payload)) as opened:
            opened.load()
            if opened.width * opened.height > MAX_IMAGE_PIXELS:
                raise ValueError("image pixel count exceeds safe limit")
            return opened.convert("RGB")
    except (UnidentifiedImageError, OSError) as exc:
        raise ValueError("unsupported or damaged image") from exc
