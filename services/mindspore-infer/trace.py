"""traceId 透传中间件（tasks.md §5.1）

读取请求头 X-Trace-Id（缺失则生成），注入 request.state.trace_id 并在响应头回写，
供端云协同链路追踪贯通（spec/03-ARCHITECTURE.md §1.1）。
"""

from __future__ import annotations

import uuid

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request

TRACE_HEADER = "X-Trace-Id"


class TraceIdMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        trace_id = request.headers.get(TRACE_HEADER) or uuid.uuid4().hex
        request.state.trace_id = trace_id
        response = await call_next(request)
        response.headers[TRACE_HEADER] = trace_id
        return response
