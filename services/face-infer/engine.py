"""Local CPU face matching and basic action checks. No capture persistence/logging."""
import base64
import hashlib
import io
import json
from pathlib import Path
from typing import Dict, List, Tuple

import cv2
import mediapipe as mp
import numpy as np
from PIL import Image

MODEL_VERSION = 'yunet2023-sface2021-mp1-c045-action-v1'
MATCH_THRESHOLD = 0.45


def action_passed(samples: List[Tuple[float, float, float]], action: str) -> bool:
    return action_reason(samples, action) == 'passed'


def action_reason(samples: List[Tuple[float, float, float]], action: str) -> str:
    """Samples: left/right eye closure and unmirrored nose offset from eye midpoint."""
    if len(samples) < 4:
        return 'too_few_frames'
    start, end = samples[0], samples[-1]
    if max(start[:2]) > 0.3 or abs(start[2]) > 0.22:
        return 'start_pose_invalid'
    if max(end[:2]) > 0.3 or abs(end[2] - start[2]) > 0.07:
        return 'finish_pose_invalid'
    if action == 'blink':
        return 'passed' if any(min(s[:2]) >= 0.5 for s in samples[1:-1]) else 'blink_not_detected'
    # Subject's left moves the nose to camera image right (preview is unmirrored).
    delta = [s[2] - start[2] for s in samples[1:-1]]
    if action == 'turn_left':
        return 'passed' if max(delta) >= 0.12 and min(delta) > -0.08 else 'left_turn_not_detected'
    if action == 'turn_right':
        return 'passed' if min(delta) <= -0.12 and max(delta) < 0.08 else 'right_turn_not_detected'
    return 'unknown_action'


def decode_capture(data_base64: str, mime: str) -> np.ndarray:
    data = bytearray(base64.b64decode(data_base64, validate=True))
    try:
        if not 0 < len(data) <= 1024 * 1024:
            raise ValueError('invalid capture')
        with Image.open(io.BytesIO(data)) as image:
            expected = {'image/jpeg': 'JPEG', 'image/png': 'PNG'}
            if image.format != expected.get(mime) or min(image.size) < 80 or max(image.size) > 2048:
                raise ValueError('invalid capture')
            image.thumbnail((640, 480))
            rgb = np.asarray(image.convert('RGB')).copy()
        try:
            return cv2.cvtColor(rgb, cv2.COLOR_RGB2BGR)
        finally:
            rgb.fill(0)
    finally:
        data[:] = b'\x00' * len(data)


class FaceEngine:
    def __init__(self, model_dir: Path) -> None:
        manifest = json.loads((Path(__file__).parent / 'models-manifest.json').read_text())
        for entry in manifest:
            data = (model_dir / entry['name']).read_bytes()
            if len(data) != entry['size'] or hashlib.sha256(data).hexdigest() != entry['sha256']:
                raise RuntimeError('face model integrity check failed')
        cv2.setNumThreads(2)
        # Native Windows loaders cannot reliably open Chinese paths; use validated buffers.
        empty = np.empty(0, dtype=np.uint8)
        detector_bytes = np.frombuffer((model_dir / manifest[0]['name']).read_bytes(), dtype=np.uint8)
        recognizer_bytes = np.frombuffer((model_dir / manifest[1]['name']).read_bytes(), dtype=np.uint8)
        self.detector = cv2.FaceDetectorYN.create('onnx', detector_bytes, empty, (640, 480), 0.8, 0.3, 1000)
        self.recognizer = cv2.FaceRecognizerSF.create('onnx', recognizer_bytes, empty)
        options = mp.tasks.vision.FaceLandmarkerOptions(
            base_options=mp.tasks.BaseOptions(model_asset_buffer=(model_dir / 'face_landmarker.task').read_bytes()),
            num_faces=2, min_face_detection_confidence=0.7,
            min_face_presence_confidence=0.7, output_face_blendshapes=True)
        self.landmarker = mp.tasks.vision.FaceLandmarker.create_from_options(options)

    def close(self) -> None:
        self.landmarker.close()

    def face(self, image: np.ndarray) -> Tuple[int, np.ndarray]:
        self.detector.setInputSize((image.shape[1], image.shape[0]))
        _, faces = self.detector.detect(image)
        count = 0 if faces is None else len(faces)
        if count != 1:
            return min(count, 10), np.empty(0, dtype=np.float32)
        crop = self.recognizer.alignCrop(image, faces[0])
        try:
            feature = self.recognizer.feature(crop).reshape(-1).astype(np.float32)
            norm = float(np.linalg.norm(feature))
            if feature.size != 128 or not np.isfinite(feature).all() or norm < 1e-6:
                feature.fill(0)
                raise ValueError('invalid face feature')
            feature /= norm
            return 1, feature
        finally:
            crop.fill(0)

    def motion(self, image: np.ndarray) -> Tuple[float, float, float]:
        rgb = cv2.cvtColor(image, cv2.COLOR_BGR2RGB)
        try:
            result = self.landmarker.detect(mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb))
            if len(result.face_landmarks) != 1 or len(result.face_blendshapes) != 1:
                raise ValueError('single face required')
            values = {v.category_name: v.score for v in result.face_blendshapes[0]}
            points = result.face_landmarks[0]
            left, right, nose = points[33], points[263], points[1]
            distance = abs(right.x - left.x)
            if distance < 0.04:
                raise ValueError('face too small')
            return (values['eyeBlinkLeft'], values['eyeBlinkRight'],
                    (nose.x - (left.x + right.x) / 2) / distance)
        finally:
            rgb.fill(0)

    def enroll(self, images: List[np.ndarray]) -> Dict[str, object]:
        features = []
        try:
            for image in images:
                count, feature = self.face(image)
                features.append(feature)
                if count != 1:
                    return {'faceCount': count, 'embeddingBase64': 'AA==', 'modelVersion': MODEL_VERSION}
            if any(float(features[0] @ f) < MATCH_THRESHOLD for f in features[1:]):
                raise ValueError('inconsistent enrollment')
            feature = np.mean(features, axis=0).astype('<f4')
            feature /= np.linalg.norm(feature)
            try:
                return {'faceCount': 1, 'embeddingBase64': base64.b64encode(feature.tobytes()).decode(), 'modelVersion': MODEL_VERSION}
            finally:
                feature.fill(0)
        finally:
            for feature in features:
                feature.fill(0)

    def verify(self, images: List[np.ndarray], template: str, action: str, mode: str = 'action') -> Dict[str, object]:
        raw = bytearray(base64.b64decode(template, validate=True))
        try:
            if len(raw) != 512:
                raise ValueError('invalid template')
            feature = np.frombuffer(raw, dtype='<f4')
            if feature.size != 128 or not np.isfinite(feature).all() or abs(float(np.linalg.norm(feature)) - 1) > 0.02:
                raise ValueError('invalid template')
            samples = []
            matched = True
            for image in images:
                count, current = self.face(image)
                try:
                    if count != 1:
                        result = self.result(count, False, False, 'single_face_required')
                        result['verificationMode'] = mode
                        return result
                    matched = matched and float(feature @ current) >= MATCH_THRESHOLD
                    if mode == 'scan':
                        continue
                    try:
                        samples.append(self.motion(image))
                    except ValueError:
                        return self.result(1, matched, False, 'landmarks_unavailable')
                finally:
                    current.fill(0)
            reason = 'not_checked_scan_mode' if mode == 'scan' else action_reason(samples, action)
            result = self.result(1, matched, reason == 'passed', reason)
            result['verificationMode'] = mode
            return result
        finally:
            raw[:] = b'\x00' * len(raw)

    @staticmethod
    def result(count: int, matched: bool, live: bool, reason: str) -> Dict[str, object]:
        return {'faceCount': count, 'matched': matched, 'livenessPassed': live, 'modelVersion': MODEL_VERSION, '_actionReason': reason}
