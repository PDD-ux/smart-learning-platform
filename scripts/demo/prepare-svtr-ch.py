#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""把云端识别模型从 CRNN 换成 MindOCR 的 SVTR 中文版（保住昇腾 NPU 推理）。

现状（2026-10-19 云端实测）
--------------------------
官方「推理模型清单」里 SVTR 只有英文版 mindir，中文版 svtr_tiny_ch 只发 ckpt，
mindir 栏是空链接。链路只能是：

    ckpt --(MindOCR tools/export.py)--> MindIR --(Lite 转换)--> 可加载模型

**已知阻塞**：云端 mindspore 2.7.1 已移除 `mindspore.parallel._transformer`，
而 MindOCR 的 abinet 模块仍依赖它，`tools/export.py` 在 import 阶段就会失败。
除非把 mindspore 降到 MindOCR 适配的版本（会影响现有推理服务），否则本脚本
大概率走不完。脚本会如实报出卡点，不会留下半成品。

云端已验证可用且推荐先用：`pip install rapidocr-onnxruntime`（PP-OCRv4）。
它跑在 CPU 上、不走 NPU，但识别率立竿见影，可作为演示保底。

用法
----
    python prepare-svtr-ch.py --model-dir /home/ma-user/work

完成后在推理服务环境变量里设（注意中文 SVTR 是 32x320，不是 64x256）：
    OCR_REC_MODEL="svtr_tiny_ch.mindir"
    OCR_REC_HEIGHT=32
    OCR_REC_WIDTH=320
    OCR_REC_NORMALIZE=raw       # MindOCR 训练时输入就是 0~255 原值
    OCR_REC_CHANNEL=bgr         # MindOCR 用 cv2 读图，通道为 BGR
"""

from __future__ import annotations

import argparse
import shutil
import subprocess
import sys
import urllib.request
from pathlib import Path
from typing import Any, List, NoReturn, Optional

CKPT_URL = "https://download.mindspore.cn/toolkits/mindocr/svtr/svtr_tiny_ch-2ee6ade4.ckpt"
CKPT_NAME = "svtr_tiny_ch-2ee6ade4.ckpt"
# GitHub 上的 mindspore-lab/mindocr 已 404，Gitee 镜像仍在
MINDOCR_REPO = "https://gitee.com/mindspore-lab/mindocr.git"
# 中文 SVTR 的 img_size 取自 svtr_tiny_ch.yaml：image_shape [32, 320]
DATA_SHAPE = ("32", "320")
# export.py 导入 mindocr 时会连带导入这些可选依赖
EXPORT_DEPS = ("shapely", "pyclipper", "addict", "tqdm", "lmdb", "polygon3", "rapidfuzz")


def info(message: str) -> None:
    print("[信息] %s" % message)


def warn(message: str) -> None:
    print("[警告] %s" % message)


def fail(message: str, *hints: str) -> NoReturn:
    print("\n[失败] %s" % message)
    for hint in hints:
        print("       → %s" % hint)
    sys.exit(1)


def run(command: List[str], cwd: Optional[Path] = None) -> bool:
    info("执行：%s" % " ".join(command))
    try:
        result = subprocess.run(command, cwd=str(cwd) if cwd else None, check=False)
    except FileNotFoundError:
        return False
    return result.returncode == 0


def step_environment() -> None:
    """第 0 步：自检。把不可行的情况尽早暴露，避免白下载。"""
    info("=== 步骤 0/5 环境自检 ===")
    info("Python：%s" % sys.version.split()[0])

    version = None
    try:
        import mindspore

        version = getattr(mindspore, "__version__", None)
        info("mindspore：%s" % version)
    except ImportError:
        warn("未安装 mindspore 完整包，无法导出 MindIR")

    try:
        import mindspore_lite

        info("mindspore_lite：%s" % getattr(mindspore_lite, "__version__", "unknown"))
    except ImportError:
        warn("未安装 mindspore_lite，推理服务将无法加载 MindIR")

    if version and version.startswith("2.7"):
        warn("mindspore 2.7.x 已移除 mindspore.parallel._transformer")
        warn("MindOCR 的 abinet 模块依赖它，导出会在 import 阶段失败")

    try:
        with urllib.request.urlopen(CKPT_URL, timeout=20) as response:
            size = int(response.headers.get("Content-Length", 0))
        info("权重可下载：%.1f MB" % (size / 1024 / 1024))
    except Exception as exc:  # noqa: BLE001
        fail("权重地址不可达：%s" % exc, "检查云端能否访问 download.mindspore.cn")


def step_download(model_dir: Path) -> Path:
    """第 1 步：下载中文 SVTR ckpt。"""
    info("=== 步骤 1/5 下载中文 SVTR 权重 ===")
    target = model_dir / CKPT_NAME
    if target.is_file():
        info("已存在，跳过：%s" % target)
        return target
    model_dir.mkdir(parents=True, exist_ok=True)
    temporary = target.with_suffix(".part")
    try:
        with urllib.request.urlopen(CKPT_URL, timeout=180) as response, open(temporary, "wb") as handle:
            shutil.copyfileobj(response, handle)
    except Exception as exc:  # noqa: BLE001
        fail("下载失败：%s" % exc, "可手动 wget %s 放到 %s" % (CKPT_URL, model_dir))
    temporary.replace(target)
    info("已下载：%s（%.1f MB）" % (target, target.stat().st_size / 1024 / 1024))
    return target


def step_mindocr(mindocr_dir: Path, skip_clone: bool) -> Path:
    """第 2 步：准备 MindOCR 源码（GitHub 已失效，用 Gitee 镜像）。"""
    info("=== 步骤 2/5 准备 MindOCR 源码 ===")
    if (mindocr_dir / "tools" / "export.py").is_file():
        info("已存在：%s" % mindocr_dir)
        return mindocr_dir
    if skip_clone:
        fail("未找到 MindOCR 源码且指定了 --skip-clone", "把源码放到 %s 后重跑" % mindocr_dir)
    if not run(["git", "clone", "--depth", "1", MINDOCR_REPO, str(mindocr_dir)]):
        fail("克隆失败", "手动下载 %s 解压到 %s 后加 --skip-clone 重跑" % (MINDOCR_REPO, mindocr_dir))
    return mindocr_dir


def step_dependencies() -> None:
    """第 3 步：补齐 export.py 的可选依赖。"""
    info("=== 步骤 3/5 安装导出依赖 ===")
    command = [sys.executable, "-m", "pip", "install", "-q", *EXPORT_DEPS]
    if not run(command):
        warn("依赖安装失败，导出可能因缺包中断")


def step_export(mindocr_dir: Path, ckpt: Path, model_dir: Path) -> Path:
    """第 4 步：ckpt 导出为 MindIR（32x320）。"""
    info("=== 步骤 4/5 导出 MindIR（32x320）===")
    target = model_dir / "svtr_tiny_ch.mindir"
    command = [
        sys.executable,
        "tools/export.py",
        "--model_name_or_config",
        "configs/rec/svtr/svtr_tiny_ch.yaml",
        "--data_shape",
        *DATA_SHAPE,
        "--local_ckpt_path",
        str(ckpt),
    ]
    if not run(command, cwd=mindocr_dir):
        fail(
            "导出失败",
            "若报 No module named 'mindspore.parallel._transformer'：mindspore 2.7 与 MindOCR 不兼容",
            "可选：降级 mindspore（会影响现有推理服务），或改用 rapidocr 保底",
        )
    produced = mindocr_dir / "svtr_tiny_ch.mindir"
    if produced.is_file() and produced != target:
        shutil.move(str(produced), str(target))
    if not target.is_file():
        fail("未找到导出产物", "在 %s 下查找 *.mindir 手动拷到 %s" % (mindocr_dir, model_dir))
    info("已导出：%s" % target)
    return target


def step_verify(mindir: Path) -> None:
    """第 5 步：验证 Lite 能否直接加载普通 MindIR，省掉 converter_lite。"""
    info("=== 步骤 5/5 验证可加载性 ===")
    try:
        import mindspore_lite as mslite
    except ImportError:
        warn("mindspore_lite 不可用，跳过验证")
        return

    context = mslite.Context()
    context.target = ["cpu"]
    model = mslite.Model()
    try:
        model.build_from_file(str(mindir), mslite.ModelType.MINDIR, context)
        info("可以直接加载，无需 converter_lite")
    except Exception as exc:  # noqa: BLE001
        warn("直接加载失败：%s" % type(exc).__name__)
        warn("需要在 PATH 中提供 converter_lite（MindSpore Lite 工具包）后转 MINDIR_LITE")


def main() -> None:
    parser = argparse.ArgumentParser(description="准备 MindOCR SVTR 中文识别模型")
    parser.add_argument("--model-dir", required=True, help="推理服务 INFER_MODEL_DIR 指向的目录")
    parser.add_argument("--mindocr-dir", default="/home/ma-user/work/mindocr", help="MindOCR 源码目录")
    parser.add_argument("--skip-clone", action="store_true", help="已有 MindOCR 源码时跳过 clone")
    args = parser.parse_args()

    model_dir = Path(args.model_dir).expanduser().resolve()
    mindocr_dir = Path(args.mindocr_dir).expanduser().resolve()

    step_environment()
    ckpt = step_download(model_dir)
    step_mindocr(mindocr_dir, args.skip_clone)
    step_dependencies()
    mindir = step_export(mindocr_dir, ckpt, model_dir)
    step_verify(mindir)

    print("\n" + "=" * 60)
    info("模型就绪：%s" % mindir.name)
    print("在推理服务环境变量中设置：")
    print('  OCR_REC_MODEL="%s"' % mindir.name)
    print("  OCR_REC_HEIGHT=32")
    print("  OCR_REC_WIDTH=320")
    print('  OCR_REC_NORMALIZE=raw')
    print('  OCR_REC_CHANNEL=bgr')
    print("\n若识别结果乱码，把 OCR_REC_NORMALIZE 依次改成 half、minus_127 重试。")
    print("=" * 60)


if __name__ == "__main__":
    main()
