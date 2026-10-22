"""训练文字区域二值分割模型并产出 text_detector.ckpt。"""

from __future__ import annotations

import argparse
from pathlib import Path
import sys


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="训练 MindSpore 文字区域检测模型")
    parser.add_argument("--images-dir", type=Path, required=True, help="训练图片目录")
    parser.add_argument("--masks-dir", type=Path, required=True, help="同名 PNG 二值掩码目录（文字区域为白色）")
    parser.add_argument("--output", type=Path, default=Path("models/text_detector.ckpt"))
    parser.add_argument("--epochs", type=int, default=10)
    parser.add_argument("--batch-size", type=int, default=8)
    parser.add_argument("--device-target", choices=("CPU", "GPU", "Ascend"), default="CPU")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    if args.epochs < 1 or args.batch_size < 1:
        raise ValueError("epochs 和 batch-size 必须大于 0")
    image_paths = sorted(path for path in args.images_dir.glob("*") if path.is_file())
    if not image_paths:
        raise FileNotFoundError(f"未找到训练图片：{args.images_dir}")
    missing_masks = [path.name for path in image_paths if not (args.masks_dir / f"{path.stem}.png").is_file()]
    if missing_masks:
        raise FileNotFoundError(f"缺少同名 PNG 掩码，例如：{missing_masks[0]}")

    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
    import mindspore as ms
    import mindspore.dataset as ds
    import mindspore.dataset.vision as vision
    import numpy as np
    from PIL import Image
    from mindspore import Tensor, nn, ops
    from mindspore.train import Model
    from mindspore.train.callback import LossMonitor

    from models import IMAGE_SIZE, create_model

    class TextMaskDataset:
        def __len__(self) -> int:
            return len(image_paths)

        def __getitem__(self, index: int) -> tuple[np.ndarray, np.ndarray]:
            image = np.asarray(Image.open(image_paths[index]).convert("RGB").resize((IMAGE_SIZE, IMAGE_SIZE)), dtype=np.float32).transpose(2, 0, 1) / 255.0
            mask = np.asarray(Image.open(args.masks_dir / f"{image_paths[index].stem}.png").convert("L").resize((IMAGE_SIZE, IMAGE_SIZE)), dtype=np.float32)[None, ...] / 255.0
            return image, mask

    class DiceBceLoss(nn.Cell):
        def __init__(self) -> None:
            super().__init__()
            self.bce = nn.BCEWithLogitsLoss(reduction="mean")
            self.sigmoid = ops.Sigmoid()
            self.reduce_sum = ops.ReduceSum()

        def construct(self, logits: Tensor, target: Tensor) -> Tensor:
            probabilities = self.sigmoid(logits)
            intersection = self.reduce_sum(probabilities * target)
            dice = 1.0 - (2.0 * intersection + 1.0) / (self.reduce_sum(probabilities) + self.reduce_sum(target) + 1.0)
            return self.bce(logits, target) + dice

    ms.set_context(mode=ms.GRAPH_MODE, device_target=args.device_target)
    dataset = ds.GeneratorDataset(TextMaskDataset(), column_names=["image", "mask"], shuffle=True).batch(args.batch_size)
    network = create_model("text_detector")
    model = Model(network, DiceBceLoss(), nn.Adam(network.trainable_params(), learning_rate=1e-3))
    model.train(args.epochs, dataset, callbacks=[LossMonitor()])
    args.output.parent.mkdir(parents=True, exist_ok=True)
    ms.save_checkpoint(network, str(args.output))
    print(f"text detector checkpoint saved: {args.output}")


if __name__ == "__main__":
    main()
