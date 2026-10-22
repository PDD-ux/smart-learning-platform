# ============================================================
# MindSpore 端侧推理服务 · Dockerfile
# Python FastAPI 服务，运行 select_frames / classify / detect_text
# ============================================================
# 镜像分两个 profile：
#   default (cpu):    MindSpore CPU 模式 + mock 降级（无 NPU 环境）
#   target=ascend:    完整 MindSpore GPU/Ascend 版（生产/部署环境）
# ============================================================

# ---- 基础镜像 ----
FROM python:3.11-slim AS base

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

# 系统依赖（curl 用于 healthcheck；libgomp 是 MindSpore 运行时需要；Tesseract 是 CPU OCR 后备）
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    libgomp1 \
    tesseract-ocr \
    tesseract-ocr-chi-sim \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# ---- CPU/Mock profile（默认）----
FROM base AS cpu
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# 非 root 用户
RUN useradd --create-home --shell /bin/bash --uid 1001 infer && \
    chown -R infer:infer /app
USER infer

EXPOSE 8000

HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=5 \
  CMD curl -f http://localhost:8000/health || exit 1

ENTRYPOINT ["python", "-m", "uvicorn", "infer_server:app", \
            "--host", "0.0.0.0", \
            "--port", "8000", \
            "--workers", "1", \
            "--log-level", "info"]

# ---- Ascend profile（昇腾 NPU，构建参数：--target=ascend）----
# 注意：完整昇腾构建需在 x86 主机上使用 MindSpore Ascend 版本 wheel
# 与华为 Ascend Docker 镜像配合使用；本毕设 MVP 默认走 cpu profile
FROM base AS ascend
COPY requirements.txt requirements-ascend.txt ./
RUN pip install --no-cache-dir -r requirements.txt && \
    pip install --no-cache-dir -r requirements-ascend.txt

COPY . .

RUN useradd --create-home --shell /bin/bash --uid 1001 infer && \
    chown -R infer:infer /app
USER infer

EXPOSE 8000

HEALTHCHECK --interval=15s --timeout=5s --start-period=60s --retries=5 \
  CMD curl -f http://localhost:8000/health || exit 1

ENTRYPOINT ["python", "-m", "uvicorn", "infer_server:app", \
            "--host", "0.0.0.0", \
            "--port", "8000", \
            "--workers", "1", \
            "--log-level", "info"]
