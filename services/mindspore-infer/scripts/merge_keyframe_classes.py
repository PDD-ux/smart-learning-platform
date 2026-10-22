"""将旧四类关键帧按来源分组原样合并成三类，不改动原始数据。"""

from __future__ import annotations

import argparse
import csv
import shutil
from collections import Counter, defaultdict
from pathlib import Path
from tempfile import TemporaryDirectory


LABEL_MAP = {"blackboard": "blackboard", "ppt": "screen", "code": "screen", "invalid": "invalid"}
SPLITS = ("train", "val", "test")
LABELS = ("blackboard", "screen", "invalid")


def convert(source: Path, destination: Path) -> None:
    source = source.resolve(strict=True)
    destination = destination.resolve()
    if destination.exists():
        raise FileExistsError(f"目标已存在，拒绝覆盖：{destination}")
    if source == destination or source in destination.parents:
        raise ValueError("目标不能位于原始数据集内部")

    manifest = source / "split_manifest.csv"
    with manifest.open("r", encoding="utf-8-sig", newline="") as stream:
        reader = csv.DictReader(stream)
        required = {"category", "filename", "source_group_id", "split", "license_status"}
        if not required.issubset(reader.fieldnames or ()):
            raise ValueError(f"manifest 缺少字段：{sorted(required - set(reader.fieldnames or ())) }")
        rows = list(reader)

    groups: dict[str, set[str]] = defaultdict(set)
    seen: set[tuple[str, str, str]] = set()
    output_names: set[tuple[str, str, str]] = set()
    counts: Counter[tuple[str, str]] = Counter()
    for row in rows:
        old_label, split, name = row["category"], row["split"], row["filename"]
        if old_label not in LABEL_MAP or split not in SPLITS or Path(name).name != name:
            raise ValueError(f"非法 manifest 记录：{row}")
        old_key = (split, old_label, name)
        new_key = (split, LABEL_MAP[old_label], name)
        if old_key in seen or new_key in output_names:
            raise ValueError(f"重复或合并后文件名冲突：{new_key}")
        if not (source / split / old_label / name).is_file():
            raise FileNotFoundError(f"manifest 引用文件不存在：{old_key}")
        seen.add(old_key)
        output_names.add(new_key)
        groups[row["source_group_id"]].add(split)
        counts[(split, LABEL_MAP[old_label])] += 1
    leaking = {group: splits for group, splits in groups.items() if len(splits) != 1}
    if leaking:
        raise ValueError(f"同一来源跨数据集：{leaking}")
    for split in SPLITS:
        for label in LABEL_MAP:
            actual = {path.name for path in (source / split / label).glob("*.jpg")}
            listed = {name for s, c, name in seen if s == split and c == label}
            if actual != listed:
                raise ValueError(f"目录与 manifest 不一致：{split}/{label}, 未登记={len(actual-listed)}, 缺失={len(listed-actual)}")

    destination.parent.mkdir(parents=True, exist_ok=True)
    with TemporaryDirectory(prefix="keyframe-three-class-", dir=destination.parent) as temporary:
        staging = Path(temporary) / destination.name
        for split in SPLITS:
            for label in LABELS:
                (staging / split / label).mkdir(parents=True)
        for row in rows:
            old_label, split, name = row["category"], row["split"], row["filename"]
            shutil.copy2(source / split / old_label / name, staging / split / LABEL_MAP[old_label] / name)
        fields = [*reader.fieldnames, "original_category"]
        with (staging / "split_manifest.csv").open("w", encoding="utf-8-sig", newline="") as stream:
            writer = csv.DictWriter(stream, fieldnames=fields)
            writer.writeheader()
            for row in rows:
                writer.writerow({**row, "category": LABEL_MAP[row["category"]], "original_category": row["category"]})
        staging.rename(destination)

    print(f"三类数据集：{destination}; 图片={len(rows)}; 来源组={len(groups)}")
    for split in SPLITS:
        print(f"{split}: " + ", ".join(f"{label}={counts[split, label]}" for label in LABELS))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    convert(args.source, args.output)
