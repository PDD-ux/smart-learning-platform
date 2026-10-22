"""训练三类课堂关键帧分类器并产出 checkpoint。"""

from __future__ import annotations

import argparse
from pathlib import Path
import sys

import numpy as np


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="训练 MindSpore 三类课堂关键帧分类模型")
    parser.add_argument("--dataset-dir", type=Path, required=True, help="含 train/ 与 val/ 的三类 ImageFolder 数据集目录")
    parser.add_argument("--output", type=Path, default=Path("models/keyframe_classifier.ckpt"))
    parser.add_argument("--epochs", type=int, default=10)
    parser.add_argument("--batch-size", type=int, default=16)
    parser.add_argument("--learning-rate", type=float, default=3e-4)
    parser.add_argument("--class-weight-power", type=float, default=0.5, help="按 train 类别数的倒数幂加权；0=不加权，默认 0.5")
    parser.add_argument("--label-smoothing", type=float, default=0.05, help="交叉熵标签平滑，默认 0.05")
    parser.add_argument("--patience", type=int, default=5, help="验证集宏平均召回率连续多少轮不提升时早停")
    parser.add_argument("--min-delta", type=float, default=0.001, help="宏平均召回率最小有效提升")
    parser.add_argument("--seed", type=int, default=20260919)
    parser.add_argument("--device-target", choices=("CPU", "GPU", "Ascend"), default="CPU")
    parser.add_argument("--validate-only", action="store_true", help="只检查 train/val 目录，不启动 MindSpore 训练")
    return parser.parse_args()


def class_weights(counts: dict[str, int], labels: tuple[str, ...], power: float) -> np.ndarray:
    """只依据 train 集类别数计算温和权重，禁止用 val/test 分布。"""
    if not 0 <= power <= 1:
        raise ValueError("class-weight-power 必须在 [0, 1] 内")
    frequencies = np.asarray([counts[label] for label in labels], dtype=np.float32)
    if np.any(frequencies <= 0):
        raise ValueError("每个训练类别必须非空")
    return np.power(frequencies.max() / frequencies, power).astype(np.float32)


def validation_metrics(confusion: np.ndarray) -> tuple[float, float, np.ndarray]:
    """返回总体准确率、三类宏平均召回率及逐类召回率。"""
    if confusion.ndim != 2 or confusion.shape[0] != confusion.shape[1]:
        raise ValueError("混淆矩阵必须为方阵")
    counts = confusion.sum(axis=1)
    if np.any(counts == 0):
        raise ValueError("验证集每个类别必须有样本")
    recalls = np.diag(confusion) / counts
    return float(np.trace(confusion) / confusion.sum()), float(recalls.mean()), recalls


def main() -> None:
    args = parse_args()
    if args.epochs < 1 or args.batch_size < 1 or args.learning_rate <= 0 or args.patience < 1:
        raise ValueError("epochs、batch-size、learning-rate 和 patience 必须大于 0")
    if not 0 <= args.label_smoothing < 1 or args.min_delta < 0:
        raise ValueError("label-smoothing 必须在 [0, 1) 内，min-delta 必须非负")
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
    from models import CLASSIFIER_LABELS, IMAGE_EXTENSIONS, validate_imagefolder_dir

    split_counts: dict[str, dict[str, int]] = {}
    for split in ("train", "val"):
        counts = validate_imagefolder_dir(args.dataset_dir / split)
        split_counts[split] = counts
        print(f"{split} samples: " + ", ".join(f"{label}={counts[label]}" for label in counts))
    weights = class_weights(split_counts["train"], CLASSIFIER_LABELS, args.class_weight_power)
    print("train class weights: " + ", ".join(f"{label}={weight:.3f}" for label, weight in zip(CLASSIFIER_LABELS, weights)))
    if args.validate_only:
        print("三类 train/val 目录检查通过；未启动训练。")
        return

    import mindspore as ms
    import mindspore.dataset as ds
    import mindspore.dataset.transforms as transforms
    import mindspore.dataset.vision as vision
    from mindspore import nn
    from mindspore.train import Model
    from mindspore.train.callback import LossMonitor

    from models import IMAGE_SIZE, create_model

    ms.set_seed(args.seed)
    ds.config.set_seed(args.seed)
    ms.set_context(mode=ms.GRAPH_MODE, device_target=args.device_target)
    class_indexing = {label: index for index, label in enumerate(CLASSIFIER_LABELS)}

    def make_dataset(split: str, shuffle: bool) -> ds.Dataset:
        dataset = ds.ImageFolderDataset(
            str(args.dataset_dir / split),
            class_indexing=class_indexing,
            extensions=list(IMAGE_EXTENSIONS),
            shuffle=shuffle,
        )
        dataset = dataset.map([vision.Decode(), vision.Resize((IMAGE_SIZE, IMAGE_SIZE)), vision.HWC2CHW(), vision.Rescale(1.0 / 255.0, 0.0)], input_columns="image")
        return dataset.map(transforms.TypeCast(ms.int32), input_columns="label").batch(args.batch_size)

    network = create_model("classifier")
    model = Model(
        network,
        nn.CrossEntropyLoss(weight=ms.Tensor(weights, ms.float32), label_smoothing=args.label_smoothing),
        nn.Adam(network.trainable_params(), learning_rate=args.learning_rate),
    )
    args.output.parent.mkdir(parents=True, exist_ok=True)
    best_macro_recall = -1.0
    best_accuracy = -1.0
    best_epoch = 0
    stale_epochs = 0
    for epoch in range(1, args.epochs + 1):
        model.train(1, make_dataset("train", True), callbacks=[LossMonitor()])
        network.set_train(False)
        confusion = np.zeros((len(CLASSIFIER_LABELS), len(CLASSIFIER_LABELS)), dtype=np.int64)
        for images, labels in make_dataset("val", False).create_tuple_iterator(output_numpy=False):
            predictions = np.argmax(network(images).asnumpy(), axis=1)
            for actual, predicted in zip(labels.asnumpy().reshape(-1), predictions):
                confusion[int(actual), int(predicted)] += 1
        accuracy, macro_recall, recalls = validation_metrics(confusion)
        improved = macro_recall > best_macro_recall + args.min_delta
        if improved:
            best_macro_recall = macro_recall
            best_accuracy = accuracy
            best_epoch = epoch
            stale_epochs = 0
            ms.save_checkpoint(network, str(args.output))
        else:
            stale_epochs += 1
        marker = " best" if improved else ""
        per_class = ", ".join(f"{label}={recall:.4f}" for label, recall in zip(CLASSIFIER_LABELS, recalls))
        print(f"validation epoch={epoch}: accuracy={accuracy:.4f}; macro_recall={macro_recall:.4f}; {per_class}{marker}")
        if stale_epochs >= args.patience:
            print(f"early stopping at epoch={epoch}; best_epoch={best_epoch}")
            break
    print(
        f"classifier best checkpoint saved: {args.output}; "
        f"best_epoch={best_epoch}; validation_accuracy={best_accuracy:.4f}; "
        f"validation_macro_recall={best_macro_recall:.4f}"
    )


if __name__ == "__main__":
    main()
