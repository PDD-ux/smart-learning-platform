"""文字区域检测与轻量 OCR 路由（tasks.md §5.2 · 主角能力）

POST /detect_text —— 定位图片/帧中的文字块；
mock 降级返回空文本块。
"""

from __future__ import annotations

from fastapi import APIRouter

from inference import detect_text_frames
from schemas import DetectTextRequest, DetectTextResponse

router = APIRouter(tags=["infer"])


@router.post("/detect_text", response_model=DetectTextResponse)
def detect_text(payload: DetectTextRequest) -> DetectTextResponse:
    return DetectTextResponse(items=detect_text_frames(payload.frames))
