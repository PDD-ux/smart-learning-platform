"""Build numbered contact sheets for manual classifier candidate review."""

from __future__ import annotations

import argparse
from pathlib import Path

from PIL import Image, ImageDraw, ImageOps


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="生成分类候选图片联系表")
    parser.add_argument("--dataset-dir", type=Path, required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--columns", type=int, default=5)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    args.output_dir.mkdir(parents=True, exist_ok=True)
    cell_width, cell_height = 220, 180
    image_height = 150

    for label_dir in sorted(path for path in args.dataset_dir.iterdir() if path.is_dir()):
        files = sorted(label_dir.glob("*.jpg"))
        if not files:
            continue
        rows = (len(files) + args.columns - 1) // args.columns
        sheet = Image.new(
            "RGB",
            (args.columns * cell_width, rows * cell_height),
            "#eeeeee",
        )
        draw = ImageDraw.Draw(sheet)
        for index, path in enumerate(files):
            with Image.open(path) as source:
                thumb = ImageOps.contain(
                    source.convert("RGB"),
                    (cell_width - 12, image_height - 8),
                    Image.Resampling.LANCZOS,
                )
            column = index % args.columns
            row = index // args.columns
            x = column * cell_width + (cell_width - thumb.width) // 2
            y = row * cell_height + 4
            sheet.paste(thumb, (x, y))
            draw.text(
                (column * cell_width + 6, row * cell_height + image_height + 3),
                f"{index:02d}  {path.name}",
                fill="black",
            )
        output = args.output_dir / f"contact-{label_dir.name}.jpg"
        sheet.save(output, "JPEG", quality=88, optimize=True)
        print(f"saved {output} ({len(files)} images)")


if __name__ == "__main__":
    main()
