"""将 §5.3 训练的 .ckpt 导出为固定输入的 MindIR、AIR 或 ONNX。"""

from __future__ import annotations

import argparse
from pathlib import Path
import sys


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="导出 MindSpore checkpoint 为 MindIR、AIR 或 ONNX")
    parser.add_argument("--model", choices=("classifier", "text_detector", "frame_selector"), required=True)
    parser.add_argument("--checkpoint", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True, help="输出文件路径；扩展名须匹配 --file-format")
    parser.add_argument("--file-format", choices=("MINDIR", "AIR", "ONNX"), default="MINDIR", help="MindIR 用于 Lite；AIR/ONNX 用于 ATC")
    parser.add_argument("--device-target", choices=("CPU", "GPU", "Ascend"), default="CPU")
    return parser.parse_args(argv)


def expected_extension(file_format: str) -> str:
    """返回 MindSpore 导出格式对应的文件扩展名。"""
    extensions = {"MINDIR": ".mindir", "AIR": ".air", "ONNX": ".onnx"}
    try:
        return extensions[file_format]
    except KeyError as error:
        raise ValueError(f"不支持的导出格式：{file_format}") from error


def validate_output_path(output: Path, file_format: str) -> None:
    """拒绝格式与扩展名不匹配的输出，避免把 MindIR 误当作 ATC 输入。"""
    expected = expected_extension(file_format)
    if output.suffix.lower() != expected:
        raise ValueError(f"{file_format} 输出必须以 {expected} 结尾：{output}")


def main() -> None:
    args = parse_args()
    if not args.checkpoint.is_file():
        raise FileNotFoundError(f"未找到 checkpoint：{args.checkpoint}")
    validate_output_path(args.output, args.file_format)

    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
    import mindspore as ms
    import numpy as np

    from models import IMAGE_SIZE, create_model

    ms.set_context(mode=ms.GRAPH_MODE, device_target=args.device_target)
    network = create_model(args.model)
    parameters = ms.load_checkpoint(str(args.checkpoint))
    missing, unexpected = ms.load_param_into_net(network, parameters)
    if missing or unexpected:
        raise RuntimeError(f"checkpoint 与模型不匹配：missing={missing}, unexpected={unexpected}")
    network.set_train(False)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    input_tensor = ms.Tensor(np.zeros((1, 3, IMAGE_SIZE, IMAGE_SIZE), np.float32))
    output_prefix = str(args.output.with_suffix(""))
    if args.file_format == "ONNX":
        # ONNX initializer weights stay embedded in the graph instead of becoming
        # additional runtime inputs; this makes the resulting ATC OM self-contained.
        ms.onnx.export(
            network,
            input_tensor,
            file_name=output_prefix,
            input_names=["input_data"],
            output_names=["output"],
            export_params=True,
            keep_initializers_as_inputs=False,
        )
    else:
        ms.export(
            network,
            input_tensor,
            file_name=output_prefix,
            file_format=args.file_format,
        )
    if not args.output.is_file():
        raise RuntimeError(f"{args.file_format} 导出失败：{args.output}")
    print(f"{args.file_format} exported: {args.output}")


if __name__ == "__main__":
    main()
