"""用 MindSpore Lite 在独立测试集上评测三类关键帧分类器 MindIR。

与 `scripts/evaluate_image_classifier.py` 的区别：那个脚本评测训练 checkpoint 且需要
完整 mindspore 包；本脚本直接加载部署用的 MindIR，用与线上 `/classify` 完全一致的
预处理和无效类阈值，因此结果可以直接代表线上行为。

用法：
    python scripts/evaluate_mindir_classifier.py \
        --dataset-dir /path/to/dataset_split_v3/test \
        --model-dir /path/to/models \
        --model-file keyframe_classifier_v3_balanced.mindir
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path
import sys

import numpy as np
from PIL import Image

LABELS = ("blackboard", "screen", "invalid")
IMAGE_SIZE = 224
EXTENSIONS = (".jpg", ".jpeg", ".png", ".bmp", ".webp")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="评测三类关键帧分类器 MindIR")
    parser.add_argument("--dataset-dir", type=Path, required=True,
                        help="直接包含 blackboard/screen/invalid 三个子目录的测试集")
    parser.add_argument("--model-dir", type=Path, required=True, help="MindIR 所在目录")
    parser.add_argument("--model-file", type=str, default="keyframe_classifier_v3_balanced.mindir")
    parser.add_argument("--threshold", type=float, default=0.95,
                        help="无效类判定门槛，低于该概率时返回 unknown（与 CLASSIFIER_INVALID_THRESHOLD 一致）")
    parser.add_argument("--device", choices=("cpu", "ascend"), default="cpu")
    parser.add_argument("--limit", type=int, default=0, help="每类最多评测多少张，0 表示不限")
    return parser.parse_args()


def preprocess(image: Image.Image) -> np.ndarray:
    """与 `inference._classifier_input` 保持一致：RGB → 224 双线性缩放 → CHW → /255。"""
    resized = image.convert("RGB").resize((IMAGE_SIZE, IMAGE_SIZE), Image.Resampling.BILINEAR)
    pixels = np.asarray(resized, dtype=np.float32)
    return np.ascontiguousarray(pixels.transpose(2, 0, 1)[None, ...] / 255.0)


def predict_category(model, image: Image.Image, threshold: float) -> tuple[str, float]:
    """返回 (类别, 无效类概率)；无效类概率不足门槛时返回 unknown。"""
    inputs = model.get_inputs()
    if len(inputs) != 1:
        raise RuntimeError(f"expected one model input, got {len(inputs)}")
    inputs[0].set_data_from_numpy(preprocess(image))
    outputs = model.predict(inputs)
    logits = np.asarray(outputs[0].get_data_to_numpy(), dtype=np.float64).reshape(-1)
    if logits.size != len(LABELS):
        raise RuntimeError(f"expected {len(LABELS)} logits, got {logits.size}")
    scores = np.exp(logits - np.max(logits))
    probabilities = scores / np.sum(scores)
    index = int(np.argmax(probabilities))
    category = LABELS[index]
    if category == "invalid" and float(probabilities[index]) < threshold:
        return "unknown", float(probabilities[index])
    return category, float(probabilities[index])


def collect_images(dataset_dir: Path, limit: int) -> dict[str, list[Path]]:
    result: dict[str, list[Path]] = {}
    for label in LABELS:
        class_dir = dataset_dir / label
        if not class_dir.is_dir():
            raise FileNotFoundError(f"缺少类别目录：{class_dir}")
        files = sorted(path for path in class_dir.iterdir()
                       if path.is_file() and path.suffix.lower() in EXTENSIONS)
        if limit > 0:
            files = files[:limit]
        if not files:
            raise FileNotFoundError(f"类别目录为空：{class_dir}")
        result[label] = files
    return result


def main() -> None:
    args = parse_args()
    images = collect_images(args.dataset_dir, args.limit)
    print("test samples: " + ", ".join(f"{label}={len(images[label])}" for label in LABELS))

    import mindspore_lite as mslite

    model_path = args.model_dir / args.model_file
    if not model_path.is_file():
        raise FileNotFoundError(f"MindIR 不存在：{model_path}")
    context = mslite.Context()
    context.target = ["ascend" if args.device == "ascend" else "cpu"]
    if args.device == "ascend":
        context.ascend.device_id = 0
    model = mslite.Model()
    model.build_from_file(str(model_path), mslite.ModelType.MINDIR, context)
    print(f"model loaded: {model_path} device={args.device}")

    # 行=真实，列=预测；第四列是 unknown（模型判无效但概率不足门槛）
    columns = list(LABELS) + ["unknown"]
    matrix = {truth: {pred: 0 for pred in columns} for truth in LABELS}
    invalid_probs: list[float] = []

    for truth in LABELS:
        for path in images[truth]:
            with Image.open(path) as handle:
                handle.load()
                category, _prob = predict_category(model, handle, args.threshold)
            matrix[truth][category] += 1
            if truth == "invalid":
                invalid_probs.append(_prob)

    print("\nconfusion matrix (row=truth, col=pred)")
    print("            " + "".join(f"{name:>12}" for name in columns))
    for truth in LABELS:
        row = "".join(f"{matrix[truth][pred]:>12}" for pred in columns)
        total = sum(matrix[truth].values())
        correct = matrix[truth][truth]
        print(f"{truth:>10}  {row}   recall={correct}/{total}={correct / total:.2%}")

    total = sum(sum(row.values()) for row in matrix.values())
    correct = sum(matrix[label][label] for label in LABELS)
    print(f"\ntotal accuracy: {correct}/{total}={correct / total:.2%}")
    print("matrix: " + json.dumps([[matrix[t][p] for p in columns] for t in LABELS]))

    # 产品口径：只有判为 invalid 才跳帧，unknown 与板书/屏幕都会进入 OCR
    valid_truth = sum(len(images[label]) for label in ("blackboard", "screen"))
    dropped_valid = matrix["blackboard"]["invalid"] + matrix["screen"]["invalid"]
    blocked_invalid = matrix["invalid"]["invalid"]
    print(f"\nthreshold={args.threshold}")
    print(f"  有效帧被误丢: {dropped_valid}/{valid_truth}")
    print(f"  无效帧被拦截: {blocked_invalid}/{len(images['invalid'])}")
    if invalid_probs:
        below = sum(1 for value in invalid_probs if value < args.threshold)
        print(f"  无效类概率低于门槛的张数: {below}/{len(invalid_probs)}")


if __name__ == "__main__":
    sys.exit(main())
