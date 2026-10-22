"""图像分类路由（tasks.md §5.2 · 主角能力）

POST /classify —— 识别上传/拍照照片或保留帧的类型；
mock 降级返回 other。
"""

from __future__ import annotations

from fastapi import APIRouter

from inference import classify_frames
from schemas import ClassifyRequest, ClassifyResponse

router = APIRouter(tags=["infer"])


@router.post("/classify", response_model=ClassifyResponse)
def classify(payload: ClassifyRequest) -> ClassifyResponse:
    return ClassifyResponse(items=classify_frames(payload.frames))
