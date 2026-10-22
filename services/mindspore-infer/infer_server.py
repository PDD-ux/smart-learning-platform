"""MindSpore 端侧推理服务 · FastAPI 入口（tasks.md §5.1）

启动：
    python -m uvicorn infer_server:app --host 0.0.0.0 --port 8000

职责：以「图像理解」为主（分类 + 文字检测），视频关键帧筛选为辅；
平台侧经 InferenceGateway 通过 ASCEND_INFER_URL 发现本服务。
"""

from __future__ import annotations

from contextlib import asynccontextmanager
from typing import AsyncIterator

from fastapi import FastAPI

from auth import InferTokenMiddleware
from config import settings
from routes import classify, detect_text, health, select_frames
from trace import TraceIdMiddleware
from warmup import prewarm_models


@asynccontextmanager
async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
    # Uvicorn 完成 lifespan 前不会接收请求，因此首个业务请求不承担模型冷启动。
    prewarm_models()
    yield

app = FastAPI(
    title="MindSpore Infer Service",
    description="端云协同 · 端侧轻量推理（图像分类 / 文字检测 / 关键帧筛选）",
    version=settings.version,
    lifespan=lifespan,
)

# 中间件顺序：后添加者在外层（先注入 traceId，再校验 token）
app.add_middleware(InferTokenMiddleware)
app.add_middleware(TraceIdMiddleware)

app.include_router(health.router)
app.include_router(classify.router)
app.include_router(detect_text.router)
app.include_router(select_frames.router)


@app.get("/", tags=["meta"])
def root() -> dict:
    return {
        "service": settings.service_name,
        "version": settings.version,
        "device": settings.device,
        "mock": settings.mock,
        "docs": "/docs",
        "health": "/health",
    }
