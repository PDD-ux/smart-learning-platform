"""Public test images, genuine model inference. No user capture, vector or score output."""
import base64
import hashlib
import io
import json
import sys
import time
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

import cv2
import numpy as np
from PIL import Image
from engine import FaceEngine, MODEL_VERSION, decode_capture


def main() -> None:
    runtime = Path(sys.argv[1])
    sample_dir = runtime / 'samples'
    sample_dir.mkdir(exist_ok=True)
    engine = FaceEngine(runtime / 'models')
    images = []
    results = {}
    sources = []
    started = time.monotonic()
    try:
        for name in ['portrait.jpg', 'business-person.png', 'cat.jpg']:
            url = 'https://storage.googleapis.com/mediapipe-assets/' + name
            raw = urllib.request.urlopen(url, timeout=30).read()
            sources.append({'url': url, 'sha256': hashlib.sha256(raw).hexdigest()})
            with Image.open(io.BytesIO(raw)) as source:
                source.thumbnail((640, 480))
                stream = io.BytesIO()
                source.convert('RGB').save(stream, format='JPEG', quality=85)
            data = stream.getvalue()
            (sample_dir / (name.split('.')[0] + '.capture.jpg')).write_bytes(data)
            images.append(decode_capture(base64.b64encode(data).decode(), 'image/jpeg'))
        enrollment = engine.enroll([images[0]])
        other = engine.enroll([images[1]])
        results['singleFaceEnrollment'] = enrollment['faceCount'] == 1
        results['differentPersonDetected'] = other['faceCount'] == 1
        feature = np.frombuffer(base64.b64decode(enrollment['embeddingBase64']), dtype='<f4').copy()
        try:
            results['normalized128Vector'] = feature.size == 128 and abs(float(np.linalg.norm(feature)) - 1) < 0.001
        finally:
            feature.fill(0)
        for action in ['blink', 'turn_left', 'turn_right']:
            static = engine.verify([images[0]] * 11, enrollment['embeddingBase64'], action)
            results[action + 'SameIdentityMatched'] = static['matched'] is True
            results[action + 'StaticRejected'] = static['livenessPassed'] is False
        different = engine.verify([images[1]] * 11, enrollment['embeddingBase64'], 'blink')
        results['differentPersonRejected'] = different['matched'] is False
        results['noFaceRejected'] = engine.enroll([images[2]])['faceCount'] == 0
        pair = cv2.resize(np.concatenate([images[0], images[0]], axis=1), (640, 480))
        images.append(pair)
        results['multipleFacesRejected'] = engine.enroll([pair])['faceCount'] > 1
        try:
            engine.verify([images[0]] * 4, base64.b64encode(bytes(512)).decode(), 'blink')
            results['invalidTemplateRejected'] = False
        except ValueError:
            results['invalidTemplateRejected'] = True
        result = {'time': datetime.now(timezone.utc).isoformat(), 'modelVersion': MODEL_VERSION,
                  'device': 'cpu', 'realModel': True, 'userCameraTested': False,
                  'dynamicPositiveTested': False, 'durationSeconds': round(time.monotonic() - started, 2),
                  'checks': results, 'publicSampleSources': sources}
        destination = Path('docs/acceptance/face-real-models-20261009.json')
        destination.write_text(json.dumps(result, indent=2) + '\n', encoding='utf-8')
        print(json.dumps({'checks': results, 'allPassed': all(results.values())}))
        if not all(results.values()):
            raise SystemExit(1)
    finally:
        for image in images:
            image.fill(0)
        engine.close()


if __name__ == '__main__':
    main()
