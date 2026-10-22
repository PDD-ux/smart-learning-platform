"""Private loopback HTTP adapter; no access/body/validation-detail logs."""
import hmac
import os
import threading
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import AsyncIterator, Awaitable, Callable, Dict, List, Literal, Optional

from fastapi import FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.responses import Response
from pydantic import BaseModel, ConfigDict, Field

from engine import FaceEngine, MODEL_VERSION, decode_capture

token = os.environ.get('FACE_INFER_TOKEN', '')
if len(token) < 32:
    raise RuntimeError('a dedicated face service token is required')
engine: Optional[FaceEngine] = None
model_lock = threading.Lock()
last_verification: Optional[Dict[str, object]] = None


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    global engine
    engine = FaceEngine(Path(os.environ['FACE_MODEL_DIR']))
    try:
        yield
    finally:
        engine.close()


app = FastAPI(lifespan=lifespan, docs_url=None, redoc_url=None, openapi_url=None)


@app.middleware('http')
async def private_boundary(request: Request, call_next: Callable[[Request], Awaitable[Response]]) -> Response:
    if not hmac.compare_digest(request.headers.get('authorization', '').encode('utf-8'), ('Bearer ' + token).encode('utf-8')):
        return JSONResponse({'error': 'unauthorized'}, status_code=401)
    if request.method == 'POST':
        # Bound streamed bytes, even when Content-Length is absent or dishonest.
        body = bytearray()
        async for chunk in request.stream():
            if len(body) + len(chunk) > 17 * 1024 * 1024:
                body[:] = b'\x00' * len(body)
                return JSONResponse({'error': 'request too large'}, status_code=413)
            body.extend(chunk)
        request._body = bytes(body)
        body[:] = b'\x00' * len(body)
    response = await call_next(request)
    response.headers['Cache-Control'] = 'no-store'
    return response


@app.exception_handler(RequestValidationError)
async def validation_error(request: Request, error: RequestValidationError) -> JSONResponse:
    # Pydantic's default response echoes input, including base64. Never return it.
    return JSONResponse({'error': 'invalid request'}, status_code=422)


class Capture(BaseModel):
    model_config = ConfigDict(extra='forbid')
    mimeType: Literal['image/jpeg', 'image/png']
    dataBase64: str = Field(min_length=1, max_length=1_400_000)


class Enrollment(BaseModel):
    model_config = ConfigDict(extra='forbid')
    captures: List[Capture] = Field(min_length=1, max_length=12)


class Verification(BaseModel):
    model_config = ConfigDict(extra='forbid')
    captures: List[Capture] = Field(min_length=2, max_length=12)
    verificationMode: Literal['action', 'scan'] = 'action'
    templateEmbeddingBase64: str = Field(min_length=1, max_length=1024)
    challengeId: str = Field(min_length=1, max_length=2048)
    challengeAction: Literal['blink', 'turn_left', 'turn_right']


@app.get('/health')
def health() -> Dict[str, object]:
    return {'status': 'ok', 'modelsLoaded': engine is not None, 'device': 'cpu', 'modelVersion': MODEL_VERSION,
            'instanceId': os.environ.get('FACE_SERVICE_INSTANCE'), 'pid': os.getpid(),
            'lastVerification': last_verification, 'loginMode': os.environ.get('FACE_LOGIN_MODE', 'action')}


def process(captures: List[Capture], verification: Optional[Verification] = None) -> Dict[str, object]:
    global last_verification
    if not model_lock.acquire(blocking=False):
        raise HTTPException(503, 'face service busy')
    images = []
    try:
        if engine is None:
            raise HTTPException(503, 'face service unavailable')
        for capture in captures:
            images.append(decode_capture(capture.dataBase64, capture.mimeType))
            capture.dataBase64 = ''
        if verification is None:
            return engine.enroll(images)
        if verification.verificationMode == 'scan' and os.environ.get('FACE_LOGIN_MODE') != 'scan':
            raise HTTPException(422, 'scan login is disabled')
        result = engine.verify(images, verification.templateEmbeddingBase64, verification.challengeAction, verification.verificationMode)
        result.setdefault('verificationMode', 'action')
        reason = result.pop('_actionReason')
        # One bounded in-memory conclusion, private health only; no user/capture/vector/score/log.
        last_verification = {'time': datetime.now(timezone.utc).isoformat(), 'action': verification.challengeAction,
                             'singleFace': result['faceCount'] == 1, 'identityMatched': result['matched'],
                             'actionPassed': result['livenessPassed'], 'actionReason': reason, 'verificationMode': result['verificationMode']}
        return result
    except (ValueError, OSError):
        raise HTTPException(422, 'invalid face capture or template') from None
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(503, 'face service unavailable') from None
    finally:
        for capture in captures:
            capture.dataBase64 = ''
        if verification is not None:
            verification.templateEmbeddingBase64 = ''
        for image in images:
            image.fill(0)
        model_lock.release()


@app.post('/v1/face/enroll')
def enroll(body: Enrollment) -> Dict[str, object]:
    return process(body.captures)


@app.post('/v1/face/verify')
def verify(body: Verification) -> Dict[str, object]:
    return process(body.captures, body)
