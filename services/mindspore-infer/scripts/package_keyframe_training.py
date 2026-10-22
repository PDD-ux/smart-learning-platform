"""将三分类数据和训练脚本打成三个各小于 100 MB 的 ModelArts 上传包。"""

from __future__ import annotations

import argparse
import csv
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile


ROOT = "modelarts-keyframe-training"
MAX_BYTES = 100_000_000


def package(dataset: Path, output_dir: Path) -> None:
    dataset = dataset.resolve(strict=True)
    output_dir = output_dir.resolve()
    service = Path(__file__).resolve().parents[1]
    with (dataset / "split_manifest.csv").open("r", encoding="utf-8-sig", newline="") as stream:
        rows = list(csv.DictReader(stream))
    parts: dict[int, list[tuple[Path, str]]] = {1: [], 2: [], 3: []}
    for row in rows:
        split, category, name, origin = (
            row["split"], row["category"], row["filename"], row["original_category"]
        )
        part = 3 if split != "train" else 2 if origin in {"code", "invalid"} else 1
        source = dataset / split / category / name
        if not source.is_file():
            raise FileNotFoundError(source)
        parts[part].append((source, f"{ROOT}/dataset_split/{split}/{category}/{name}"))
    parts[2].append((dataset / "split_manifest.csv", f"{ROOT}/dataset_split/split_manifest.csv"))
    for name in ("models.py", "scripts/train_image_classifier.py", "scripts/evaluate_image_classifier.py", "scripts/export_mindir.py"):
        parts[2].append((service / name, f"{ROOT}/mindspore-infer/{name}"))
    output_dir.mkdir(parents=True, exist_ok=True)
    for part, entries in parts.items():
        target = output_dir / f"modelarts-keyframe-training-v3-part{part}.zip"
        if target.exists():
            raise FileExistsError(f"拒绝覆盖已有训练包：{target}")
        with ZipFile(target, "x", compression=ZIP_DEFLATED, compresslevel=6) as archive:
            for source, name in entries:
                archive.write(source, name)
        size = target.stat().st_size
        if size >= MAX_BYTES:
            raise ValueError(f"第 {part} 包超过 100 MB：{size} 字节；不要上传，请重新分包")
        print(f"part{part}: {len(entries)} files, {size / 1_000_000:.2f} MB -> {target}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dataset", type=Path, required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    args = parser.parse_args()
    package(args.dataset, args.output_dir)
