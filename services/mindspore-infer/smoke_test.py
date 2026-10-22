"""冒烟测试（无需 pytest）：python smoke_test.py

覆盖 tasks.md §5.1 / §5.2 验收点：
  - GET /health 返回 status=ok、device、模型加载状态
  - X-Infer-Token 中间件：非 /health 接口缺 token → 401，正确 token → 200
  - traceId 透传：请求头 X-Trace-Id 回写响应头
  - POST /classify /detect_text /select_frames 的 mock 降级行为
"""

from __future__ import annotations

from fastapi.testclient import TestClient

from config import settings
from infer_server import app

TOKEN_HEADERS = {"X-Infer-Token": "dev-infer-token"}


def main() -> None:
    client = TestClient(app)

    # --- health ---
    health = client.get("/health")
    assert health.status_code == 200, health.text
    body = health.json()
    assert body["status"] == "ok", body
    assert body["device"], body
    assert "modelsLoaded" in body and "mock" in body, body
    assert health.headers.get("X-Trace-Id"), "traceId should be echoed"

    # --- auth ---
    assert client.get("/").status_code == 401, "missing token must be rejected"
    assert client.get("/", headers=TOKEN_HEADERS).status_code == 200

    # --- traceId passthrough ---
    traced = client.get("/health", headers={"X-Trace-Id": "trace-smoke-1"})
    assert traced.headers.get("X-Trace-Id") == "trace-smoke-1"

    frames = [
        {"frameIndex": 0, "timestampMs": 0, "imageBase64": "AAAA"},
        {"frameIndex": 1, "timestampMs": 2000, "imageUrl": "http://example.com/f1.jpg"},
    ]

    # --- classify (mock → unknown) ---
    assert client.post("/classify", json={"frames": frames}).status_code == 401
    classified = client.post("/classify", json={"frames": frames}, headers=TOKEN_HEADERS)
    assert classified.status_code == 200, classified.text
    items = classified.json()["items"]
    assert [item["category"] for item in items] == ["unknown", "unknown"], items

    # --- detect_text (mock → empty blocks) ---
    detected = client.post("/detect_text", json={"frames": frames}, headers=TOKEN_HEADERS)
    assert detected.status_code == 200, detected.text
    assert detected.json()["items"][0]["blocks"] == []

    # --- select_frames (mock → uniform, step=2 drops odd frames) ---
    selected = client.post(
        "/select_frames",
        json={"frames": frames, "sampleEvery": 2},
        headers=TOKEN_HEADERS,
    )
    assert selected.status_code == 200, selected.text
    selected_frames = selected.json()["frames"]
    assert selected_frames[0]["keep"] is True
    assert selected_frames[1]["keep"] is False
    assert selected_frames[1]["timestampMs"] == 2000

    # --- validation: frame without image source → 422 ---
    invalid = client.post(
        "/classify",
        json={"frames": [{"frameIndex": 0}]},
        headers=TOKEN_HEADERS,
    )
    assert invalid.status_code == 422, invalid.text

    # --- validation: request batch cannot exceed configured frame limit ---
    too_many_frames = [
        {"frameIndex": index, "imageUrl": "http://example.com/frame.jpg"}
        for index in range(settings.max_frames + 1)
    ]
    oversized = client.post(
        "/classify",
        json={"frames": too_many_frames},
        headers=TOKEN_HEADERS,
    )
    assert oversized.status_code == 422, oversized.text

    print("smoke_test: OK")


if __name__ == "__main__":
    main()
