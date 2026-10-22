"""服务级鉴权中间件（tasks.md §5.1）

除 /health、/docs、/openapi.json、/redoc 外，所有接口必须携带请求头：

    X-Infer-Token: <ASCEND_INFER_TOKEN>

校验失败返回 401。平台侧 InferenceGateway 会自动带上该 token。
"""

from __future__ import annotations

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse

from config import settings

PUBLIC_PATHS = {"/health", "/docs", "/redoc", "/openapi.json", "/docs/oauth2-redirect"}


class InferTokenMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        path = request.url.path
        if path in PUBLIC_PATHS or path.startswith("/docs"):
            return await call_next(request)

        provided = request.headers.get("X-Infer-Token", "")
        if not settings.infer_token or provided != settings.infer_token:
            return JSONResponse(
                status_code=401,
                content={
                    "error": {
                        "code": "UNAUTHORIZED",
                        "message": "invalid or missing X-Infer-Token",
                    }
                },
            )
        return await call_next(request)
