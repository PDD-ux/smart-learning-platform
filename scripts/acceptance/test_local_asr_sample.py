"""Reject unavailable, fabricated or out-of-range model timing in the diagnostic."""
from __future__ import annotations

import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location("sample", Path(__file__).with_name("local-asr-sample.py"))
assert spec and spec.loader
sample = importlib.util.module_from_spec(spec)
spec.loader.exec_module(sample)


class TimingTests(unittest.TestCase):
    def test_short_intervals_keep_real_boundaries_with_context(self) -> None:
        self.assertEqual(sample._timing.merge_short_intervals([[0, 20000], [20000, 20390]]), [[0, 20390]])
        self.assertEqual(sample._timing.merge_short_intervals([[0, 390], [600, 4000]]), [[0, 4000]])

    def test_separate_utterances_and_isolated_short_intervals_stay_separate(self) -> None:
        values = [[0, 4000], [5001, 5500], [8000, 12000]]
        self.assertEqual(sample._timing.merge_short_intervals(values), values)

    def test_merging_does_not_change_original_interval_evidence(self) -> None:
        values = [[0, 4000], [4100, 4500]]
        sample._timing.merge_short_intervals(values)
        self.assertEqual(values, [[0, 4000], [4100, 4500]])

    def test_context_merge_never_exceeds_thirty_seconds(self) -> None:
        values = [[0, 29800], [29800, 30500]]
        self.assertEqual(sample._timing.merge_short_intervals(values), values)

    def test_real_model_ranges_get_source_offset(self) -> None:
        self.assertEqual(sample.validate_timestamps([[0, 100], [150, 300]], 30000, 535000),
                         [[535000, 535100], [535150, 535300]])

    def test_missing_timing_is_not_replaced_with_uniform_spacing(self) -> None:
        for value in (None, [], "text"):
            with self.assertRaises(ValueError):
                sample.validate_timestamps(value, 30000, 0)

    def test_bad_timing_rejected(self) -> None:
        for value in ([[0, 30001]], [[-1, 50]], [[100, 50]], [[0, float("nan")]],
                      [[True, 100]], [[0, 100], [90, 150]], [[0, 0]], [[0, 1, 2]]):
            with self.assertRaises(ValueError):
                sample.validate_timestamps(value, 30000, 0)


if __name__ == "__main__":
    unittest.main()
