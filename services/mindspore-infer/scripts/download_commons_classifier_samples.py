"""Download auditable Wikimedia Commons candidates for weak classifier labels.

The files are intentionally written to a review-only candidate directory.  A
human must check label fit before copying approved images into ``train/``.
"""

from __future__ import annotations

import argparse
import csv
from dataclasses import dataclass
from html import unescape
import json
from pathlib import Path
import re
import sys
import time
from collections.abc import Iterator
from typing import Any
from urllib.parse import quote, urlencode, urlparse
from urllib.error import HTTPError
from urllib.request import Request, urlopen

from PIL import Image, ImageOps, UnidentifiedImageError


API_URL = "https://commons.wikimedia.org/w/api.php"
USER_AGENT = "WenhaoLearningPlatform/1.0 (educational dataset audit)"
ALLOWED_LICENSE_PREFIXES = ("CC BY", "CC0", "PUBLIC DOMAIN", "PD-")
IMAGE_SUFFIXES = {
    ".jpg", ".jpeg", ".png", ".webp", ".tif", ".tiff",
    # Commons returns a raster first-page thumbnail for these document types.
    ".pdf", ".djvu",
}


@dataclass(frozen=True)
class SourceSpec:
    label: str
    category: str
    target: int
    preferred_words: tuple[str, ...] = ()
    rejected_words: tuple[str, ...] = ()


SOURCES = (
    SourceSpec(
        "手写笔记",
        "Category:Handwriting",
        50,
        ("handwriting", "handwritten", "notes", "diary", "letter", "script", "writing"),
        ("signature", "autograph", "font", "logo", "svg", "tattoo", "graffiti"),
    ),
    SourceSpec("试卷", "Category:Exam papers", 26),
    SourceSpec("打印教材", "Category:Textbooks from Thailand", 30),
)

# The first Handwriting run reached 50 files immediately before Commons rate
# limiting interrupted the process.  Keep the observed source order so those
# already downloaded files can receive complete attribution without re-fetching
# the binaries.
RECOVERED_HANDWRITING_TITLES = (
    'File:"+arya+" Javanese script handwriting without spaces 2019.jpg',
    "File:Yossef Arixa's handwriting.jpg",
    "File:Writings-bab-handwriting-mulla-husayn.jpg",
    "File:WHC participant handwriting.png",
    "File:Vishwanath Datta (father of Swami Vivekananda) handwriting.png",
    "File:Vayalar handwriting DSCN0058.JPG",
    "File:Tiny handwriting by ana.jpg",
    "File:The mystery of handwriting, a handbook of graphology by J. Harington Keene ... - Archie Gunn. LCCN2014649615.jpg",
    "File:Tagore handwriting Bengali.jpg",
    "File:RenaissanceLatinHandwriting2.jpg",
    "File:PSM V44 D099 Example of vertical handwriting.jpg",
    "File:PSM V44 D098 Example of handwriting 1893.jpg",
    "File:PSM V44 D097 Results of improved handwriting after four weeks of practice.jpg",
    "File:PSM V44 D096 Handwriting prior to practice.jpg",
    "File:Pen-writing-notes-studying.jpg",
    "File:Notebook with english handwriting.jpg",
    "File:Nachum Sokolov's handwriting.jpg",
    "File:Murkoth Handwriting DSCN0048.JPG",
    "File:John Calvin's handwriting 01.jpg",
    "File:Image handwriting español.jpg",
    "File:Icelandic handwriting.JPG",
    "File:Herschel's handwriting.jpg",
    "File:Hazlitt handwriting samples.png",
    "File:Handwritten manuscript by Fabre.jpg",
    "File:Handwriting.jpg",
    "File:Handwriting-Marlowe-Massacre-1.png",
    "File:Handwriting-Marlowe-Massacre-1.JPG",
    "File:Handwriting with pen.jpg",
    "File:Handwriting of William Ick.jpg",
    "File:Handwriting of Wilhelm Dunker in mollusc collection in Museum für Naturkunde Berlin - ZooKeys-279-001-g006.jpg",
    "File:Handwriting of the Countess of Home in an inventory.jpg",
    "File:Handwriting of Rodolfo Amando Philippi in mollusc collection in Museum für Naturkunde Berlin - ZooKeys-279-001-g005.jpg",
    "File:Handwriting of Raghuji Bhonsle.jpg",
    "File:Handwriting of labels in mollusc collection in Museum für Naturkunde Berlin - ZooKeys-279-001-g002.jpg",
    "File:Handwriting of labels in mollusc collection in Museum für Naturkunde Berlin - ZooKeys-279-001-g001.jpg",
    "File:Handwriting of Karl Theodor Menke in mollusc collection in Museum für Naturkunde Berlin - ZooKeys-279-001-g004.jpg",
    "File:Handwriting of Hermann Strebel in mollusc collection in Museum für Naturkunde Berlin - ZooKeys-279-001-g003.jpg",
    "File:Handwriting of E. Paravicini in mollusc collection in Museum für Naturkunde Berlin - ZooKeys-279-001-g007.jpg",
    "File:Handwriting at Starbucks.jpg",
    "File:Handwriting 3.jpg",
    "File:Handwriting (38263428696).jpg",
    "File:Handwriting (183429635).jpeg",
    "File:General paresis handwriting.jpg",
    "File:Gandhi handwriting2.jpg",
    "File:Fyodor Mikahailovich Dostoyevsky's Handwriting 1838.jpg",
    "File:Facsimile of the handwriting of Junius... LCCN2004670523.tif",
    "File:Facsimile of the handwriting of Junius... LCCN2004670523.jpg",
    "File:Burke's handwriting.jpg",
    "File:A B Yehoshua Handwriting.jpg",
    "File:Written Scripts.jpg",
)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="下载带许可台账的 Commons 分类候选图片")
    parser.add_argument(
        "--output",
        type=Path,
        default=Path("dataset/classifier-candidates/wikimedia"),
    )
    parser.add_argument("--max-width", type=int, default=1280)
    return parser.parse_args()


def api_request(params: dict[str, str], retries: int = 3) -> dict[str, Any]:
    url = f"{API_URL}?{urlencode(params)}"
    request = Request(url, headers={"User-Agent": USER_AGENT})
    for attempt in range(retries):
        try:
            with urlopen(request, timeout=30) as response:
                payload = json.load(response)
            time.sleep(1.0)
            return payload
        except Exception:
            if attempt + 1 == retries:
                raise
            time.sleep(1.5 * (attempt + 1))
    raise RuntimeError("unreachable")


def category_titles(category: str) -> list[str]:
    titles: list[str] = []
    continuation: str | None = None
    while True:
        params = {
            "action": "query",
            "format": "json",
            "list": "categorymembers",
            "cmtitle": category,
            "cmtype": "file",
            "cmlimit": "500",
        }
        if continuation:
            params["cmcontinue"] = continuation
        payload = api_request(params)
        titles.extend(item["title"] for item in payload["query"]["categorymembers"])
        continuation = payload.get("continue", {}).get("cmcontinue")
        if not continuation:
            return titles


def ranked_titles(spec: SourceSpec, titles: list[str]) -> list[str]:
    def score(title: str) -> tuple[int, str]:
        lowered = title.lower()
        preferred = sum(word in lowered for word in spec.preferred_words)
        rejected = sum(word in lowered for word in spec.rejected_words)
        return (preferred * 10 - rejected * 100, lowered)

    return sorted(titles, key=score, reverse=True)


def iter_image_info(titles: list[str], max_width: int) -> Iterator[dict[str, Any]]:
    # Commons file names can be very long; small batches avoid HTTP 414.
    for start in range(0, len(titles), 8):
        batch = titles[start : start + 8]
        payload = api_request(
            {
                "action": "query",
                "format": "json",
                "prop": "imageinfo",
                "titles": "|".join(batch),
                "iiprop": "url|size|mime|extmetadata",
                "iiurlwidth": str(max_width),
            }
        )
        title_order = {title: index for index, title in enumerate(batch)}
        pages = sorted(
            payload["query"]["pages"].values(),
            key=lambda page: title_order.get(page.get("title", ""), 10**9),
        )
        yield from pages


def metadata_value(metadata: dict[str, Any], key: str) -> str:
    value = metadata.get(key, {}).get("value", "")
    clean = re.sub(r"<[^>]+>", " ", unescape(str(value)))
    return " ".join(clean.split())


def acceptable(page: dict[str, Any]) -> bool:
    info = (page.get("imageinfo") or [{}])[0]
    suffix = Path(urlparse(info.get("url", "")).path).suffix.lower()
    license_name = metadata_value(info.get("extmetadata", {}), "LicenseShortName").upper()
    has_raster_source = bool(info.get("thumburl")) or suffix not in {".pdf", ".djvu"}
    return suffix in IMAGE_SUFFIXES and has_raster_source and any(
        license_name.startswith(prefix) for prefix in ALLOWED_LICENSE_PREFIXES
    )


def download_image(url: str, destination: Path) -> tuple[int, int]:
    request = Request(url, headers={"User-Agent": USER_AGENT})
    data: bytes | None = None
    for attempt in range(3):
        try:
            with urlopen(request, timeout=45) as response:
                data = response.read(12 * 1024 * 1024 + 1)
            break
        except HTTPError as error:
            if error.code != 429 or attempt == 2:
                raise
            time.sleep(5.0 * (attempt + 1))
    if data is None:
        raise RuntimeError("download returned no data")
    if len(data) > 12 * 1024 * 1024:
        raise ValueError("download exceeds 12 MiB limit")
    temporary = destination.with_suffix(".download")
    temporary.write_bytes(data)
    try:
        with Image.open(temporary) as image:
            image = ImageOps.exif_transpose(image).convert("RGB")
            if min(image.size) < 300:
                raise ValueError(f"image too small: {image.size}")
            image.thumbnail((1280, 1280), Image.Resampling.LANCZOS)
            size = image.size
            image.save(destination, "JPEG", quality=90, optimize=True)
            return size
    finally:
        temporary.unlink(missing_ok=True)


def manifest_row(
    output: Path,
    destination: Path,
    spec: SourceSpec,
    page: dict[str, Any],
    width: int,
    height: int,
) -> dict[str, str | int]:
    info = page["imageinfo"][0]
    metadata = info.get("extmetadata", {})
    title = page["title"]
    return {
        "relative_path": destination.relative_to(output).as_posix(),
        "label": spec.label,
        "source_category": spec.category,
        "source_title": title,
        "source_page_url": "https://commons.wikimedia.org/wiki/"
        + quote(title.replace(" ", "_"), safe=":()/,_-"),
        "author": metadata_value(metadata, "Artist"),
        "license": metadata_value(metadata, "LicenseShortName"),
        "license_url": metadata_value(metadata, "LicenseUrl"),
        "credit": metadata_value(metadata, "Credit"),
        "width": width,
        "height": height,
        "review_status": "pending",
    }


def save_manifest(path: Path, rows: list[dict[str, str | int]]) -> None:
    if not rows:
        return
    with path.open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=list(rows[0]))
        writer.writeheader()
        writer.writerows(rows)


def main() -> None:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    args = parse_args()
    if args.max_width < 640:
        raise ValueError("max-width 至少为 640")
    args.output.mkdir(parents=True, exist_ok=True)
    manifest_path = args.output / "commons-manifest.csv"
    manifest_rows: list[dict[str, str | int]] = []
    if manifest_path.is_file():
        with manifest_path.open("r", encoding="utf-8-sig", newline="") as handle:
            manifest_rows.extend(dict(row) for row in csv.DictReader(handle))

    for spec in SOURCES:
        destination_dir = args.output / spec.label
        destination_dir.mkdir(parents=True, exist_ok=True)
        existing = sorted(destination_dir.glob("commons_*.jpg"))
        existing_rows = [row for row in manifest_rows if row["label"] == spec.label]
        if len(existing) >= spec.target and len(existing_rows) >= spec.target:
            print(f"{spec.label}: resume found {len(existing)} completed files")
            continue
        if (
            spec.label == "手写笔记"
            and len(existing) == len(RECOVERED_HANDWRITING_TITLES)
            and not existing_rows
        ):
            recovered_pages = list(
                iter_image_info(list(RECOVERED_HANDWRITING_TITLES), args.max_width)
            )
            pages_by_title = {page["title"]: page for page in recovered_pages}
            for index, title in enumerate(RECOVERED_HANDWRITING_TITLES):
                page = pages_by_title[title]
                with Image.open(existing[index]) as image:
                    width, height = image.size
                manifest_rows.append(
                    manifest_row(args.output, existing[index], spec, page, width, height)
                )
            save_manifest(manifest_path, manifest_rows)
            print(f"{spec.label}: recovered attribution for {len(existing)} existing files")
            continue
        titles = ranked_titles(spec, category_titles(spec.category))
        # Query enough fallbacks for rejected licenses, tiny files and decode failures
        # without requesting metadata for an entire 600-file category up front.
        downloaded = len(existing)
        used_titles = {str(row["source_title"]) for row in existing_rows}
        for page in iter_image_info(titles[: spec.target * 5], args.max_width):
            if downloaded >= spec.target:
                break
            if page.get("title") in used_titles or not acceptable(page):
                continue
            info = page["imageinfo"][0]
            metadata = info.get("extmetadata", {})
            image_url = info.get("thumburl") or info.get("url")
            if not image_url:
                continue
            destination = destination_dir / f"commons_{downloaded:04d}.jpg"
            try:
                width, height = download_image(image_url, destination)
            except (OSError, ValueError, UnidentifiedImageError) as error:
                print(f"skip {page.get('title')}: {error}")
                continue
            title = page["title"]
            manifest_rows.append(
                manifest_row(args.output, destination, spec, page, width, height)
            )
            save_manifest(manifest_path, manifest_rows)
            downloaded += 1
            print(f"{spec.label}: {downloaded}/{spec.target} {title}")
            time.sleep(1.5)
        if downloaded < spec.target:
            print(f"warning: {spec.label} only downloaded {downloaded}/{spec.target}")

    save_manifest(manifest_path, manifest_rows)
    print(f"saved {len(manifest_rows)} candidates and manifest to {args.output}")


if __name__ == "__main__":
    main()
