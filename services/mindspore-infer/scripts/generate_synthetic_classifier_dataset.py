"""Generate a deterministic, license-clean baseline for the eight-class classifier.

The generated images are deliberately synthetic. They are suitable for wiring,
training smoke tests and a first baseline, but must not be reported as evidence of
real-world accuracy. Add independently sourced real validation images before the
model is accepted.
"""

from __future__ import annotations

import argparse
import csv
import math
import random
from pathlib import Path
from typing import Callable, Final

from PIL import Image, ImageDraw, ImageEnhance, ImageFilter, ImageFont


LABELS: Final[tuple[str, ...]] = (
    "手写笔记",
    "打印教材",
    "板书",
    "试卷",
    "代码",
    "PPT",
    "纯语音",
    "other",
)
WIDTH: Final[int] = 640
HEIGHT: Final[int] = 480

TITLES: Final[tuple[str, ...]] = (
    "线性代数重点整理",
    "数据结构与算法",
    "概率论课堂笔记",
    "计算机网络复习",
    "操作系统核心概念",
    "高等数学知识梳理",
)
BODY_LINES: Final[tuple[str, ...]] = (
    "定义：研究对象之间的结构与关系",
    "重点：理解概念、条件和适用范围",
    "例题：根据已知条件推导最终结论",
    "注意边界情况与时间复杂度分析",
    "结论需要结合图示与实际案例记忆",
    "复习时先回顾框架，再完成练习题",
)


def _font_candidates() -> tuple[Path, ...]:
    return (
        Path("C:/Windows/Fonts/STXINGKA.TTF"),
        Path("C:/Windows/Fonts/FZSTK.TTF"),
        Path("C:/Windows/Fonts/simkai.ttf"),
        Path("C:/Windows/Fonts/msyh.ttc"),
        Path("/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc"),
        Path("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"),
    )


def _load_font(size: int, handwriting: bool = False, monospace: bool = False) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    candidates = list(_font_candidates())
    if monospace:
        candidates = [
            Path("C:/Windows/Fonts/consola.ttf"),
            Path("/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf"),
        ] + candidates
    elif not handwriting:
        candidates = [
            Path("C:/Windows/Fonts/msyh.ttc"),
            Path("C:/Windows/Fonts/simhei.ttf"),
        ] + candidates
    for candidate in candidates:
        if candidate.is_file():
            return ImageFont.truetype(str(candidate), size=size)
    return ImageFont.load_default()


def _paper(rng: random.Random, tone: tuple[int, int, int] = (247, 244, 235)) -> Image.Image:
    image = Image.new("RGB", (WIDTH, HEIGHT), tone)
    pixels = image.load()
    for _ in range(9_000):
        x = rng.randrange(WIDTH)
        y = rng.randrange(HEIGHT)
        delta = rng.randint(-8, 8)
        base = pixels[x, y]
        pixels[x, y] = tuple(max(0, min(255, channel + delta)) for channel in base)
    return image


def _draw_handwritten(rng: random.Random) -> Image.Image:
    image = _paper(rng, (250, 247, 235))
    draw = ImageDraw.Draw(image)
    for y in range(58, HEIGHT, 42):
        draw.line((26, y, WIDTH - 20, y), fill=(170, 202, 224), width=1)
    draw.line((72, 18, 72, HEIGHT - 18), fill=(230, 135, 135), width=2)
    title_font = _load_font(rng.randint(28, 36), handwriting=True)
    body_font = _load_font(rng.randint(18, 24), handwriting=True)
    ink = rng.choice(((34, 54, 92), (22, 70, 62), (65, 43, 88)))
    draw.text((92, 18), rng.choice(TITLES), font=title_font, fill=ink)
    lines = rng.sample(BODY_LINES, k=5)
    for index, line in enumerate(lines):
        x = 88 + rng.randint(-4, 12)
        y = 72 + index * 60 + rng.randint(-4, 5)
        draw.text((x, y), f"{index + 1}. {line}", font=body_font, fill=ink)
        if rng.random() < 0.6:
            draw.line((x + 25, y + 29, min(WIDTH - 35, x + rng.randint(180, 420)), y + 31), fill=(190, 53, 53), width=2)
    draw.ellipse((470, 360, 580, 438), outline=(190, 53, 53), width=3)
    return image.rotate(rng.uniform(-2.3, 2.3), resample=Image.Resampling.BICUBIC, fillcolor=(238, 235, 225))


def _draw_textbook(rng: random.Random) -> Image.Image:
    image = _paper(rng, (252, 250, 244))
    draw = ImageDraw.Draw(image)
    title_font = _load_font(27)
    heading_font = _load_font(20)
    body_font = _load_font(15)
    draw.text((42, 28), rng.choice(TITLES), font=title_font, fill=(20, 33, 48))
    draw.line((40, 68, WIDTH - 40, 68), fill=(72, 101, 122), width=2)
    draw.text((42, 82), f"{rng.randint(1, 9)}.{rng.randint(1, 5)} 基本概念", font=heading_font, fill=(35, 66, 91))
    for column in range(2):
        x = 42 + column * 302
        for row in range(9):
            width = rng.randint(210, 275)
            y = 122 + row * 30
            draw.line((x, y, x + width, y), fill=(70, 70, 70), width=rng.choice((1, 2)))
    draw.rectangle((370, 270, 578, 404), outline=(75, 104, 127), width=2)
    draw.line((390, 380, 550, 295), fill=(63, 112, 166), width=3)
    draw.text((45, 430), "知识点总结与例题解析", font=body_font, fill=(75, 75, 75))
    draw.text((570, 442), str(rng.randint(10, 260)), font=body_font, fill=(90, 90, 90))
    return image


def _draw_board(rng: random.Random) -> Image.Image:
    background = rng.choice(((25, 70, 57), (32, 37, 42), (34, 59, 73)))
    image = Image.new("RGB", (WIDTH, HEIGHT), background)
    draw = ImageDraw.Draw(image)
    chalk = rng.choice(((239, 239, 220), (229, 236, 207), (222, 236, 240)))
    title_font = _load_font(31, handwriting=True)
    body_font = _load_font(22, handwriting=True)
    draw.text((36, 25), rng.choice(TITLES), font=title_font, fill=chalk)
    for index, line in enumerate(rng.sample(BODY_LINES, 4)):
        draw.text((45 + rng.randint(-5, 8), 88 + index * 64), f"• {line}", font=body_font, fill=chalk)
    draw.rectangle((390, 318, 575, 420), outline=(238, 210, 118), width=3)
    draw.line((410, 397, 465, 345, 530, 380, 560, 330), fill=(238, 210, 118), width=3)
    for _ in range(350):
        x, y = rng.randrange(WIDTH), rng.randrange(HEIGHT)
        shade = rng.randint(50, 115)
        draw.point((x, y), fill=tuple(min(255, value + shade // 8) for value in background))
    return image.filter(ImageFilter.GaussianBlur(radius=0.35))


def _draw_exam(rng: random.Random) -> Image.Image:
    image = _paper(rng, (252, 252, 249))
    draw = ImageDraw.Draw(image)
    title_font = _load_font(26)
    body_font = _load_font(17)
    draw.text((170, 20), rng.choice(("期末考试试卷", "阶段测试卷", "模拟练习题")), font=title_font, fill=(20, 20, 20))
    draw.text((48, 62), "姓名：________  学号：________  得分：______", font=body_font, fill=(35, 35, 35))
    y = 105
    for number in range(1, 6):
        question = rng.choice(BODY_LINES)
        draw.text((42, y), f"{number}. {question}（   ）", font=body_font, fill=(30, 30, 30))
        y += 34
        draw.text((70, y), "A. 条件一    B. 条件二    C. 条件三    D. 条件四", font=body_font, fill=(45, 45, 45))
        y += 48
    draw.line((42, 430, WIDTH - 42, 430), fill=(90, 90, 90), width=1)
    draw.text((45, 442), "请在规定时间内独立完成答题", font=_load_font(14), fill=(90, 90, 90))
    return image.rotate(rng.uniform(-1.2, 1.2), resample=Image.Resampling.BICUBIC, fillcolor=(245, 245, 240))


def _draw_code(rng: random.Random) -> Image.Image:
    image = Image.new("RGB", (WIDTH, HEIGHT), rng.choice(((25, 28, 36), (30, 32, 40), (18, 24, 31))))
    draw = ImageDraw.Draw(image)
    font = _load_font(rng.randint(15, 18), monospace=True)
    draw.rectangle((0, 0, WIDTH, 34), fill=(45, 49, 61))
    draw.text((18, 8), rng.choice(("main.py", "algorithm.ts", "review_service.py", "index.tsx")), font=_load_font(15, monospace=True), fill=(220, 220, 220))
    snippets = (
        "def calculate_score(values):",
        "    total = sum(values)",
        "    return total / max(len(values), 1)",
        "",
        "for index, item in enumerate(items):",
        "    if item.is_valid():",
        "        results.append(transform(item))",
        "print(f\"result={results}\")",
        "# 时间复杂度: O(n)",
        "assert len(results) <= len(items)",
    )
    colors = ((201, 209, 217), (198, 120, 221), (97, 175, 239), (152, 195, 121), (229, 192, 123))
    for index, line in enumerate(snippets):
        y = 55 + index * 36
        draw.text((12, y), f"{index + 1:>2}", font=font, fill=(95, 102, 116))
        draw.text((55, y), line, font=font, fill=rng.choice(colors))
    return image


def _draw_ppt(rng: random.Random) -> Image.Image:
    palette = rng.choice(
        (
            ((245, 248, 255), (49, 82, 145), (78, 132, 196)),
            ((252, 247, 240), (120, 62, 74), (207, 124, 83)),
            ((241, 251, 247), (28, 104, 91), (74, 167, 146)),
        )
    )
    image = Image.new("RGB", (WIDTH, HEIGHT), palette[0])
    draw = ImageDraw.Draw(image)
    draw.rectangle((0, 0, 18, HEIGHT), fill=palette[2])
    draw.text((48, 38), rng.choice(TITLES), font=_load_font(34), fill=palette[1])
    draw.line((48, 92, 580, 92), fill=palette[2], width=4)
    for index, line in enumerate(rng.sample(BODY_LINES, 4)):
        y = 125 + index * 62
        draw.ellipse((58, y + 7, 70, y + 19), fill=palette[2])
        draw.text((88, y), line, font=_load_font(20), fill=(45, 53, 62))
    draw.rounded_rectangle((400, 330, 585, 430), radius=16, fill=palette[2])
    draw.text((425, 362), "核心结论", font=_load_font(24), fill=(255, 255, 255))
    draw.text((48, 444), f"课程汇报  ·  {rng.randint(1, 30):02d}", font=_load_font(14), fill=(100, 105, 112))
    return image


def _draw_audio(rng: random.Random) -> Image.Image:
    image = Image.new("RGB", (WIDTH, HEIGHT), rng.choice(((17, 24, 39), (31, 25, 51), (17, 42, 48))))
    draw = ImageDraw.Draw(image)
    accent = rng.choice(((76, 201, 240), (147, 114, 255), (47, 211, 169)))
    draw.rounded_rectangle((210, 62, 430, 282), radius=38, outline=accent, width=7)
    draw.rounded_rectangle((278, 92, 362, 218), radius=38, fill=accent)
    draw.line((250, 205, 250, 225, 265, 250, 320, 270, 375, 250, 390, 225, 390, 205), fill=accent, width=6)
    draw.line((320, 270, 320, 315), fill=accent, width=7)
    draw.line((275, 315, 365, 315), fill=accent, width=7)
    center_y = 365
    points = []
    for x in range(55, 585, 6):
        amplitude = 15 + 45 * abs(math.sin((x + rng.randint(0, 5)) / 35))
        points.append((x, center_y + rng.uniform(-amplitude, amplitude)))
    draw.line(points, fill=accent, width=3)
    draw.text((238, 410), rng.choice(("纯音频课程", "播客学习", "语音讲解")), font=_load_font(24), fill=(230, 236, 242))
    return image


def _draw_other(rng: random.Random) -> Image.Image:
    base = tuple(rng.randint(80, 220) for _ in range(3))
    image = Image.new("RGB", (WIDTH, HEIGHT), base)
    draw = ImageDraw.Draw(image, "RGBA")
    for _ in range(rng.randint(25, 55)):
        x1, y1 = rng.randrange(WIDTH), rng.randrange(HEIGHT)
        x2, y2 = x1 + rng.randint(20, 220), y1 + rng.randint(20, 180)
        color = tuple(rng.randint(0, 255) for _ in range(3)) + (rng.randint(35, 135),)
        if rng.random() < 0.5:
            draw.ellipse((x1, y1, x2, y2), fill=color)
        else:
            draw.rectangle((x1, y1, x2, y2), fill=color)
    if rng.random() < 0.5:
        image = image.filter(ImageFilter.GaussianBlur(radius=rng.uniform(2.0, 6.0)))
    return image


GENERATORS: Final[dict[str, Callable[[random.Random], Image.Image]]] = {
    "手写笔记": _draw_handwritten,
    "打印教材": _draw_textbook,
    "板书": _draw_board,
    "试卷": _draw_exam,
    "代码": _draw_code,
    "PPT": _draw_ppt,
    "纯语音": _draw_audio,
    "other": _draw_other,
}


def _augment(image: Image.Image, rng: random.Random) -> Image.Image:
    if rng.random() < 0.4:
        image = ImageEnhance.Brightness(image).enhance(rng.uniform(0.82, 1.16))
    if rng.random() < 0.35:
        image = ImageEnhance.Contrast(image).enhance(rng.uniform(0.84, 1.18))
    if rng.random() < 0.18:
        image = image.filter(ImageFilter.GaussianBlur(radius=rng.uniform(0.25, 0.9)))
    return image


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="生成八类学习资料图像分类合成基线")
    parser.add_argument(
        "--output",
        type=Path,
        default=Path(__file__).resolve().parents[1] / "dataset" / "classifier",
    )
    parser.add_argument("--per-class", type=int, default=100)
    parser.add_argument("--train-count", type=int, default=80)
    parser.add_argument("--seed", type=int, default=20260919)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    if args.per_class < 2:
        raise ValueError("per-class 至少为 2")
    if not 1 <= args.train_count < args.per_class:
        raise ValueError("train-count 必须在 1 与 per-class-1 之间")

    manifest_rows: list[dict[str, str]] = []
    for label_index, label in enumerate(LABELS):
        generator = GENERATORS[label]
        for item_index in range(args.per_class):
            split = "train" if item_index < args.train_count else "val"
            destination = args.output / split / label / f"synthetic_{item_index:04d}.jpg"
            destination.parent.mkdir(parents=True, exist_ok=True)
            rng = random.Random(args.seed + label_index * 100_000 + item_index)
            image = _augment(generator(rng), rng).convert("RGB")
            image.save(destination, format="JPEG", quality=91, optimize=True)
            manifest_rows.append(
                {
                    "relative_path": destination.relative_to(args.output.parent).as_posix(),
                    "split": split,
                    "task": "classifier",
                    "label": label,
                    "source_url": "generated-locally",
                    "license_or_permission": "project-generated synthetic data; no third-party assets",
                    "contains_personal_data": "no",
                    "review_status": "synthetic-baseline",
                    "notes": f"seed={args.seed}; generator=v1",
                }
            )

    manifest_path = args.output / "synthetic-manifest.csv"
    with manifest_path.open("w", newline="", encoding="utf-8-sig") as stream:
        writer = csv.DictWriter(stream, fieldnames=list(manifest_rows[0]))
        writer.writeheader()
        writer.writerows(manifest_rows)
    print(
        f"generated {len(manifest_rows)} images in {args.output} "
        f"({args.train_count} train + {args.per_class - args.train_count} val per class)"
    )
    print(f"manifest: {manifest_path}")


if __name__ == "__main__":
    main()
