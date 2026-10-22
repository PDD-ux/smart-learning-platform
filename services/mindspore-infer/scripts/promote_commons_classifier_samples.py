"""Promote visually reviewed Commons candidates into classifier train data."""

from __future__ import annotations

import argparse
import csv
import hashlib
from pathlib import Path
import shutil


APPROVED_INDEXES = {
    "手写笔记": set(range(50)) - {7, 22, 26, 33, 34, 36, 38, 40, 41, 46, 49},
    "试卷": {0, 1, 2, 3, 4, 6, 12, 18, 21, 22, 23, 24, 25},
    "打印教材": set(range(30)) - {23},
}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="复制审核通过的 Commons 候选到训练集")
    parser.add_argument("--candidate-dir", type=Path, required=True)
    parser.add_argument("--train-dir", type=Path, required=True)
    return parser.parse_args()


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main() -> None:
    args = parse_args()
    manifest_path = args.candidate_dir / "commons-manifest.csv"
    with manifest_path.open("r", encoding="utf-8-sig", newline="") as handle:
        rows = list(csv.DictReader(handle))

    approved_rows: list[dict[str, str]] = []
    counts: dict[str, int] = {}
    for row in rows:
        source = args.candidate_dir / row["relative_path"]
        index = int(source.stem.rsplit("_", 1)[1])
        approved = index in APPROVED_INDEXES.get(row["label"], set())
        row["review_status"] = "approved" if approved else "rejected"
        if not approved:
            continue
        label = row["label"]
        destination_dir = args.train_dir / label
        destination_dir.mkdir(parents=True, exist_ok=True)
        destination = destination_dir / f"public_commons_{index:04d}.jpg"
        if destination.exists() and digest(destination) != digest(source):
            raise RuntimeError(f"拒绝覆盖内容不同的现有文件：{destination}")
        shutil.copy2(source, destination)
        promoted = dict(row)
        promoted["relative_path"] = destination.relative_to(args.train_dir).as_posix()
        approved_rows.append(promoted)
        counts[label] = counts.get(label, 0) + 1

    with manifest_path.open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=list(rows[0]))
        writer.writeheader()
        writer.writerows(rows)

    approved_path = args.candidate_dir / "approved-manifest.csv"
    with approved_path.open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=list(approved_rows[0]))
        writer.writeheader()
        writer.writerows(approved_rows)

    print(f"promoted={len(approved_rows)} counts={counts}")
    print(f"approved manifest: {approved_path}")


if __name__ == "__main__":
    main()
