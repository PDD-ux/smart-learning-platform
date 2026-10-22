"""在独立 ImageFolder 数据集上评测三类课堂关键帧分类器。"""

from __future__ import annotations

import argparse
from pathlib import Path
import sys

import numpy as np


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="评测 MindSpore 三类课堂关键帧分类模型")
    parser.add_argument(
        "--dataset-dir",
        type=Path,
        required=True,
        help="直接包含 blackboard/screen/invalid 三个类别子目录的 ImageFolder 数据集目录",
    )
    parser.add_argument("--checkpoint", type=Path)
    parser.add_argument("--batch-size", type=int, default=16)
    parser.add_argument("--device-target", choices=("CPU", "GPU", "Ascend"), default="CPU")
    parser.add_argument("--validate-only", action="store_true", help="只检查独立测试集目录，不加载 MindSpore/checkpoint")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
    from models import IMAGE_EXTENSIONS, validate_imagefolder_dir

    counts = validate_imagefolder_dir(args.dataset_dir)
    print("test samples: " + ", ".join(f"{label}={counts[label]}" for label in counts))
    if args.validate_only:
        print("三类 test 目录检查通过；未加载模型或评测。")
        return
    if args.checkpoint is None or not args.checkpoint.is_file():
        raise FileNotFoundError(f"checkpoint 不存在或未指定：{args.checkpoint}")
    if args.batch_size < 1:
        raise ValueError("batch-size 必须大于 0")

    import mindspore as ms
    import mindspore.dataset as ds
    import mindspore.dataset.transforms as transforms
    import mindspore.dataset.vision as vision

    from models import CLASSIFIER_LABELS, IMAGE_EXTENSIONS, IMAGE_SIZE, create_model

    ms.set_context(mode=ms.GRAPH_MODE, device_target=args.device_target)
    class_indexing = {label: index for index, label in enumerate(CLASSIFIER_LABELS)}
    dataset = ds.ImageFolderDataset(
        str(args.dataset_dir),
        class_indexing=class_indexing,
        extensions=list(IMAGE_EXTENSIONS),
        shuffle=False,
    )
    dataset = dataset.map(
        [
            vision.Decode(),
            vision.Resize((IMAGE_SIZE, IMAGE_SIZE)),
            vision.HWC2CHW(),
            vision.Rescale(1.0 / 255.0, 0.0),
        ],
        input_columns="image",
    )
    dataset = dataset.map(transforms.TypeCast(ms.int32), input_columns="label")
    dataset = dataset.batch(args.batch_size)

    network = create_model("classifier")
    parameters = ms.load_checkpoint(str(args.checkpoint))
    load_result = ms.load_param_into_net(network, parameters)
    # MindSpore 不同版本分别返回 list，或返回
    # (网络中未加载参数, checkpoint 中未使用参数) 两个 list。
    if isinstance(load_result, tuple):
        not_loaded = [item for group in load_result for item in group]
    else:
        not_loaded = list(load_result)
    if not_loaded:
        raise RuntimeError(f"checkpoint 参数未完整加载：{not_loaded}")
    network.set_train(False)

    class_count = len(CLASSIFIER_LABELS)
    confusion = np.zeros((class_count, class_count), dtype=np.int64)
    for images, labels in dataset.create_tuple_iterator(output_numpy=False):
        logits = network(images)
        predictions = np.argmax(logits.asnumpy(), axis=1)
        expected = labels.asnumpy().reshape(-1)
        for actual, predicted in zip(expected, predictions):
            confusion[int(actual), int(predicted)] += 1

    total = int(confusion.sum())
    if total == 0:
        raise RuntimeError("数据集中没有可评测图片")
    correct = int(np.trace(confusion))
    print(f"samples={total}; correct={correct}; accuracy={correct / total:.4f}")
    print("per-class accuracy:")
    for index, label in enumerate(CLASSIFIER_LABELS):
        count = int(confusion[index].sum())
        matched = int(confusion[index, index])
        accuracy = matched / count if count else 0.0
        print(f"  {label}: {matched}/{count} = {accuracy:.4f}")

    print("confusion matrix (rows=actual, columns=predicted):")
    print("\t" + "\t".join(CLASSIFIER_LABELS))
    for index, label in enumerate(CLASSIFIER_LABELS):
        values = "\t".join(str(int(value)) for value in confusion[index])
        print(f"{label}\t{values}")


if __name__ == "__main__":
    main()
