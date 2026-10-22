"""Audit exact and perceptual duplicates across classifier train/eval splits."""

from __future__ import annotations

import argparse
import hashlib
from pathlib import Path

import numpy as np
from PIL import Image


def _hash_file(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _perceptual_hash(path: Path) -> np.ndarray:
    with Image.open(path) as image:
        gray = np.asarray(
            image.convert("L").resize((16, 16), Image.Resampling.BILINEAR),
            dtype=np.float32,
        )
    return gray >= float(np.mean(gray))


def _images(directory: Path) -> list[Path]:
    return sorted(path for path in directory.glob("*/*.jpg") if path.is_file())


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="检查分类数据跨集合重复")
    parser.add_argument("--train-dir", type=Path, required=True)
    parser.add_argument("--eval-dir", type=Path, required=True)
    parser.add_argument("--hamming-threshold", type=int, default=12)
    parser.add_argument("--max-near-ratio", type=float, default=0.10)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    train_files = _images(args.train_dir)
    eval_files = _images(args.eval_dir)
    if not train_files or not eval_files:
        raise RuntimeError("train/eval 至少一侧没有 JPG")

    train_exact = {_hash_file(path) for path in train_files}
    exact_duplicates = sum(_hash_file(path) in train_exact for path in eval_files)
    train_by_label: dict[str, list[np.ndarray]] = {}
    for path in train_files:
        train_by_label.setdefault(path.parent.name, []).append(_perceptual_hash(path))

    near = 0
    per_label: dict[str, tuple[int, int, float]] = {}
    for label_dir in sorted(path for path in args.eval_dir.iterdir() if path.is_dir()):
        hashes = train_by_label.get(label_dir.name, [])
        files = sorted(label_dir.glob("*.jpg"))
        distances: list[int] = []
        for path in files:
            current = _perceptual_hash(path)
            distance = min(
                (int(np.count_nonzero(current != old)) for old in hashes),
                default=256,
            )
            distances.append(distance)
        label_near = sum(value <= args.hamming_threshold for value in distances)
        near += label_near
        median = float(np.median(distances)) if distances else 0.0
        per_label[label_dir.name] = (label_near, len(files), median)

    ratio = near / len(eval_files)
    for label, (label_near, total, median) in per_label.items():
        print(f"{label}: near={label_near}/{total} nearest_median={median:.1f}")
    print(
        f"summary train={len(train_files)} eval={len(eval_files)} "
        f"exact={exact_duplicates} near={near} near_ratio={ratio:.4f}"
    )
    if exact_duplicates:
        raise SystemExit("audit failed: exact cross-split duplicates found")
    if ratio > args.max_near_ratio:
        raise SystemExit(
            f"audit failed: near_ratio {ratio:.4f} exceeds {args.max_near_ratio:.4f}"
        )


if __name__ == "__main__":
    main()
