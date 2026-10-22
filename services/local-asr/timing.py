"""Validate actual VAD intervals before adding any source offset."""
from __future__ import annotations
import math


def merge_short_intervals(intervals: list[list[int]]) -> list[list[int]]:
    """Give subsecond VAD regions adjacent context without dropping audio or inventing boundaries."""
    result = []
    for begin, end in intervals:
        if result and end - result[-1][0] <= 30000 and begin - result[-1][1] <= 1000 and (
            end - begin < 1000 or result[-1][1] - result[-1][0] < 1000
        ):
            result[-1][1] = end
        else:
            result.append([begin, end])
    return result

def validate_timestamps(value: object, duration_ms: int, offset_ms: int) -> list[list[int]]:
    if not isinstance(value, list) or not value:
        raise ValueError("Model did not provide timestamps")
    result = []
    previous = 0
    for pair in value:
        if not isinstance(pair, list) or len(pair) != 2:
            raise ValueError("Invalid timestamp pair")
        start, end = pair
        if any(isinstance(item, bool) or not isinstance(item, (int, float)) or not math.isfinite(item)
               for item in pair) or not 0 <= start < end <= duration_ms or start < previous:
            raise ValueError("Timestamp outside audio or unordered")
        result.append([round(start) + offset_ms, round(end) + offset_ms])
        previous = end
    return result

