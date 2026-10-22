"""§5.3 训练与导出共用的轻量 MindSpore 网络定义。"""

from __future__ import annotations

from pathlib import Path
from typing import Final

IMAGE_SIZE: Final[int] = 224
CLASSIFIER_LABELS: Final[tuple[str, ...]] = (
    "blackboard", "screen", "invalid",
)
IMAGE_EXTENSIONS: Final[tuple[str, ...]] = (".jpg", ".jpeg", ".png", ".bmp", ".webp")


def validate_imagefolder_dir(dataset_dir: Path) -> dict[str, int]:
    """检查三类 ImageFolder 目录，返回每类可读取图片数。"""
    if not dataset_dir.is_dir():
        raise FileNotFoundError(f"数据集目录不存在：{dataset_dir}")

    class_dirs = {path.name for path in dataset_dir.iterdir() if path.is_dir()}
    expected = set(CLASSIFIER_LABELS)
    missing = sorted(expected - class_dirs)
    extra = sorted(class_dirs - expected)
    if missing or extra:
        raise ValueError(
            f"类别目录必须严格为 {CLASSIFIER_LABELS}；缺少={missing}，多出={extra}"
        )

    counts = {
        label: sum(
            1
            for path in (dataset_dir / label).iterdir()
            if path.is_file() and path.suffix.lower() in IMAGE_EXTENSIONS
        )
        for label in CLASSIFIER_LABELS
    }
    empty = [label for label, count in counts.items() if count == 0]
    if empty:
        raise ValueError(f"以下类别没有可读取图片：{empty}")
    return counts


def require_mindspore() -> object:
    """延迟导入，让无 MindSpore 的 CPU/mock 环境仍可查看脚本帮助。"""
    try:
        import mindspore as ms
    except ImportError as error:
        raise RuntimeError(
            "未安装 MindSpore；请在训练机按官方安装矩阵安装与 Python/设备匹配的版本。"
        ) from error
    return ms


def create_model(model_name: str) -> object:
    """创建固定输入为 NCHW 3×224×224 的轻量模型。"""
    ms = require_mindspore()
    nn = ms.nn

    if model_name == "classifier":
        # 保留空间特征到更深层后再做全局池化。原三层网络过早做
        # 28×28 全局平均，在早期八类合成基线上 60 epoch 仅达到 81.87%。
        return nn.SequentialCell(
            nn.Conv2d(3, 32, kernel_size=3, stride=2, pad_mode="pad", padding=1),
            nn.BatchNorm2d(32),
            nn.ReLU(),
            nn.Conv2d(32, 32, kernel_size=3, pad_mode="pad", padding=1),
            nn.BatchNorm2d(32),
            nn.ReLU(),
            nn.MaxPool2d(kernel_size=2, stride=2),
            nn.Conv2d(32, 64, kernel_size=3, pad_mode="pad", padding=1),
            nn.BatchNorm2d(64),
            nn.ReLU(),
            nn.MaxPool2d(kernel_size=2, stride=2),
            nn.Conv2d(64, 128, kernel_size=3, pad_mode="pad", padding=1),
            nn.BatchNorm2d(128),
            nn.ReLU(),
            nn.Conv2d(128, 128, kernel_size=3, pad_mode="pad", padding=1),
            nn.BatchNorm2d(128),
            nn.ReLU(),
            nn.AvgPool2d(kernel_size=28),
            nn.Flatten(),
            nn.Dense(128, len(CLASSIFIER_LABELS)),
        )
    elif model_name == "frame_selector":
        output_channels = 2
    elif model_name == "text_detector":
        return nn.SequentialCell(
            nn.Conv2d(3, 16, kernel_size=3, pad_mode="pad", padding=1), nn.ReLU(),
            nn.Conv2d(16, 32, kernel_size=3, pad_mode="pad", padding=1), nn.ReLU(),
            nn.Conv2d(32, 16, kernel_size=3, pad_mode="pad", padding=1), nn.ReLU(),
            nn.Conv2d(16, 8, kernel_size=3, pad_mode="pad", padding=1), nn.ReLU(),
            nn.Conv2d(8, 1, kernel_size=1),
        )
    else:
        raise ValueError(f"未知模型：{model_name}")

    return nn.SequentialCell(
        nn.Conv2d(3, 16, kernel_size=3, stride=2, pad_mode="pad", padding=1), nn.ReLU(),
        nn.Conv2d(16, 32, kernel_size=3, stride=2, pad_mode="pad", padding=1), nn.ReLU(),
        nn.Conv2d(32, 64, kernel_size=3, stride=2, pad_mode="pad", padding=1), nn.ReLU(),
        nn.AvgPool2d(kernel_size=28), nn.Flatten(),
        nn.Dense(64, output_channels),
    )
