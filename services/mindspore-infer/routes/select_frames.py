"""视频关键帧筛选路由（tasks.md §5.2 · 辅助能力）

POST /select_frames —— 对候选帧打分并丢弃低价值帧；
CPU/mock 模式提供均匀抽帧保底。
"""

from __future__ import annotations

from fastapi import APIRouter

from inference import select_frames as run_select_frames
from schemas import SelectFramesRequest, SelectFramesResponse

router = APIRouter(tags=["infer"])


@router.post("/select_frames", response_model=SelectFramesResponse)
def select_frames(payload: SelectFramesRequest) -> SelectFramesResponse:
    frames = run_select_frames(payload.frames, payload.sampleEvery, payload.strategy)
    return SelectFramesResponse(frames=frames)
