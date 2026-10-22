"""MindSpore Lite MindIR lazy runtime.

The model object and its mutable input tensor are protected by one lock because
FastAPI may execute synchronous route handlers concurrently.
"""

from __future__ import annotations

import importlib
import threading
from pathlib import Path
from typing import Any, List, Optional

import numpy as np

from config import settings


class MindIRModel:
    def __init__(self, filename: str) -> None:
        self.path = Path(settings.model_dir) / filename
        self._model: Optional[Any] = None
        self._build_error: Optional[str] = None
        self._lock = threading.Lock()

    def _load(self) -> Any:
        if self._model is not None:
            return self._model
        if not self.path.is_file():
            raise FileNotFoundError(f"MindIR model not found: {self.path}")
        if self._build_error is not None:
            raise RuntimeError(f"MindIR model build previously failed: {self.path.name} ({self._build_error})")

        try:
            mslite = importlib.import_module("mindspore_lite")
            context = mslite.Context()
            target = settings.device.lower()
            context.target = [target if target in ("cpu", "gpu", "ascend") else "cpu"]
            if target == "ascend":
                context.ascend.device_id = 0
            model = mslite.Model()
            model.build_from_file(str(self.path), mslite.ModelType.MINDIR, context)
        except Exception as exc:
            # An incompatible MindIR/device cannot be repaired by rebuilding it for every frame.
            # Keep the existing caller fallback; a service restart allows a new attempt.
            self._build_error = type(exc).__name__
            raise
        self._model = model
        return model

    def predict(self, value: np.ndarray) -> List[np.ndarray]:
        contiguous = np.ascontiguousarray(value.astype(np.float32, copy=False))
        with self._lock:
            model = self._load()
            inputs = model.get_inputs()
            if len(inputs) != 1:
                raise RuntimeError(f"expected one model input, got {len(inputs)}")
            inputs[0].set_data_from_numpy(contiguous)
            outputs = model.predict(inputs)
            return [output.get_data_to_numpy() for output in outputs]
