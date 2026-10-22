"""推理接口契约模型（tasks.md §5.2）

对齐 spec/03-ARCHITECTURE.md §2.2.2-(8) 与平台侧 InferenceGateway 类型：
  - classify      → { items: [{frameIndex, category}] }
  - detect_text   → { items: [{frameIndex, blocks: [{bbox, text, confidence}]}] }
  - select_frames → { frames: [{frameIndex, timestampMs, score, keep, reason}] }
"""

from __future__ import annotations

from typing import List, Literal, Optional

from pydantic import BaseModel, Field, model_validator

from config import settings

# 图像分类类别（spec §2.2.2-(8)）；unknown 仅用于 mock/故障降级
FRAME_CATEGORIES = (
    "blackboard",
    "screen",
    "invalid",
    "unknown",
)


class FrameInput(BaseModel):
    """单帧输入：图片 URL 或 base64 字节二选一"""

    frameIndex: int = Field(ge=0)
    timestampMs: Optional[int] = Field(default=None, ge=0)
    imageUrl: Optional[str] = Field(default=None, max_length=2048)
    imageBase64: Optional[str] = Field(default=None, max_length=((settings.max_image_bytes + 2) // 3) * 4)

    @model_validator(mode="after")
    def _require_image_source(self) -> "FrameInput":
        if not self.imageUrl and not self.imageBase64:
            raise ValueError("frame must provide imageUrl or imageBase64")
        return self


class FrameBatchRequest(BaseModel):
    frames: List[FrameInput] = Field(min_length=1, max_length=settings.max_frames)

    @model_validator(mode="after")
    def _limit_total_base64_bytes(self) -> "FrameBatchRequest":
        total_bytes = sum((len(frame.imageBase64 or "") * 3) // 4 for frame in self.frames)
        if total_bytes > settings.max_request_bytes:
            raise ValueError("total image payload exceeds configured request limit")
        return self


class ClassifyRequest(FrameBatchRequest):
    pass


class DetectTextRequest(FrameBatchRequest):
    pass


class CategoryItem(BaseModel):
    frameIndex: int
    category: Literal["blackboard", "screen", "invalid", "unknown"]


class ClassifyResponse(BaseModel):
    items: List[CategoryItem]


class TextBlock(BaseModel):
    # [x, y, width, height]
    bbox: List[float] = Field(min_length=4, max_length=4)
    text: str
    confidence: float = Field(ge=0.0, le=1.0)


class DetectTextItem(BaseModel):
    frameIndex: int
    blocks: List[TextBlock] = Field(default_factory=list)


class DetectTextResponse(BaseModel):
    items: List[DetectTextItem]


class SelectFramesRequest(FrameBatchRequest):
    # 抽样策略：uniform（均匀保底，默认）| quality（真实模型评估）
    strategy: Literal["uniform", "quality"] = "uniform"
    # 均匀抽帧步长（>=1；1 表示保留全部）
    sampleEvery: int = Field(default=1, ge=1)


class SelectedFrame(BaseModel):
    frameIndex: int
    timestampMs: int
    score: float = Field(ge=0.0, le=1.0)
    keep: bool
    reason: str


class SelectFramesResponse(BaseModel):
    frames: List[SelectedFrame]
