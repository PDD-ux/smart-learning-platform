"""训练视频关键帧保留/丢弃二分类器并产出 frame_selector.ckpt。"""

from __future__ import annotations

import argparse
from pathlib import Path
import sys


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="训练 MindSpore 关键帧筛选模型")
    parser.add_argument("--dataset-dir", type=Path, required=True, help="含 keep/ 与 drop/ 子目录的 ImageFolder 数据集目录")
    parser.add_argument("--output", type=Path, default=Path("models/frame_selector.ckpt"))
    parser.add_argument("--epochs", type=int, default=8)
    parser.add_argument("--batch-size", type=int, default=16)
    parser.add_argument("--device-target", choices=("CPU", "GPU", "Ascend"), default="CPU")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    if args.epochs < 1 or args.batch_size < 1:
        raise ValueError("epochs 和 batch-size 必须大于 0")
    for label in ("keep", "drop"):
        if not (args.dataset_dir / label).is_dir():
            raise FileNotFoundError(f"缺少类别目录：{args.dataset_dir / label}")

    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
    import mindspore as ms
    import mindspore.dataset as ds
    import mindspore.dataset.transforms as transforms
    import mindspore.dataset.vision as vision
    from mindspore import nn
    from mindspore.train import Model
    from mindspore.train.callback import LossMonitor

    from models import IMAGE_SIZE, create_model

    ms.set_context(mode=ms.GRAPH_MODE, device_target=args.device_target)
    dataset = ds.ImageFolderDataset(str(args.dataset_dir), class_indexing={"drop": 0, "keep": 1}, shuffle=True)
    dataset = dataset.map([vision.Decode(), vision.Resize((IMAGE_SIZE, IMAGE_SIZE)), vision.HWC2CHW(), vision.Rescale(1.0 / 255.0, 0.0)], input_columns="image")
    dataset = dataset.map(transforms.TypeCast(ms.int32), input_columns="label").batch(args.batch_size)
    network = create_model("frame_selector")
    model = Model(network, nn.SoftmaxCrossEntropyWithLogits(sparse=True, reduction="mean"), nn.Adam(network.trainable_params(), learning_rate=1e-3))
    model.train(args.epochs, dataset, callbacks=[LossMonitor()])
    args.output.parent.mkdir(parents=True, exist_ok=True)
    ms.save_checkpoint(network, str(args.output))
    print(f"frame selector checkpoint saved: {args.output}")


if __name__ == "__main__":
    main()
