from __future__ import annotations

import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location("ocr_quality", Path(__file__).with_name("accept-ocr-quality.py"))
assert spec is not None and spec.loader is not None
quality = importlib.util.module_from_spec(spec)
spec.loader.exec_module(quality)


class OcrQualityTests(unittest.TestCase):
    def test_edit_distance_counts_substitution_insertion_and_deletion(self) -> None:
        self.assertEqual(quality.distance("打赏", "打发"), 1)
        self.assertEqual(quality.distance("打赏", "打赏赏"), 1)
        self.assertEqual(quality.distance("打赏", "打"), 1)
        self.assertEqual(quality.distance("打赏", ""), 2)

    def test_punctuation_is_ignored_without_substituting_words_or_case(self) -> None:
        self.assertEqual(quality.normalized('fmt.Println("Working!")'), "fmtPrintlnWorking")
        self.assertNotEqual(quality.normalized("诱骗"), quality.normalized("锈骗"))

    def test_regions_exclude_ui_and_join_split_blocks_by_source_x(self) -> None:
        rows = [{"frame": "sample.jpg", "round": 1, "blocks": [
            {"bbox": [30, 20, 10, 10], "text": "赏"},
            {"bbox": [200, 20, 10, 10], "text": "界面噪声"},
            {"bbox": [10, 20, 10, 10], "text": "打"},
        ]}]
        result = quality.evaluate(rows, {"regions": [{"frame": "sample.jpg", "roi": [0, 0, 100, 100], "text": "打赏"}]})
        self.assertEqual(result[0]["actual"], "打赏")
        self.assertEqual(result[0]["errors"], 0)

    def test_missing_blocks_count_as_deletions(self) -> None:
        result = quality.evaluate([{"frame": "sample.jpg", "round": 1, "blocks": []}],
                                  {"regions": [{"frame": "sample.jpg", "roi": [0, 0, 100, 100], "text": "打赏"}]})
        self.assertEqual(result[0]["cer"], 1)


if __name__ == "__main__":
    unittest.main()
