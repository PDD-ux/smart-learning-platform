"""健康检查路由（tasks.md §5.1）

GET /health —— 返回后端设备（CPU/GPU/Ascend）与模型加载状态；无需鉴权，
供 docker-compose healthcheck 与平台 InferenceGateway 探测使用。
"""

from __future__ import annotations

from fastapi import APIRouter, Request

from config import settings
from device import device_info

router = APIRouter(tags=["health"])


@router.get("/health")
def health(request: Request) -> dict:
    info = device_info()
    return {
        "status": "ok",
        "service": settings.service_name,
        "version": settings.version,
        "device": info["device"],
        "mindsporeAvailable": info["mindsporeAvailable"],
        "modelsLoaded": info["modelsLoaded"],
        "modelFilesReady": info["modelFilesReady"],
        "tesseractAvailable": info["tesseractAvailable"],
        "ocrFallbackAvailable": info["ocrFallbackAvailable"],
        "rapidocrAvailable": info["rapidocrAvailable"],
        "ocrBackend": info["ocrBackend"],
        "modelStatus": info["modelStatus"],
        "mock": info["mock"],
        "traceId": getattr(request.state, "trace_id", None),
    }
