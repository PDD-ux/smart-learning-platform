"""Frozen short-source evaluation rules; no model/network calls or answer repair."""
import json
from typing import Any


def score(row: dict[str, Any], content: str) -> dict[str, bool]:
    result = dict.fromkeys(['json', 'schema', 'grounded', 'expectedOutcome', 'completeQuote', 'passed'], False)
    try:
        value = json.loads(content)
    except (ValueError, TypeError):
        return result
    result['json'] = True
    if (not isinstance(value, dict) or set(value) != {'title', 'key_points', 'needs_more_context'}
            or not isinstance(value['title'], str) or not 1 <= len(value['title'].strip()) <= 50
            or type(value['needs_more_context']) is not bool or not isinstance(value['key_points'], list)
            or len(value['key_points']) > 3):
        return result
    points = value['key_points']
    if any(not isinstance(point, dict) or set(point) != {'text', 'quote'}
           or not isinstance(point['quote'], str) or not 8 <= len(point['quote']) <= 500
           or point['text'] != point['quote'] for point in points):
        return result
    result['schema'] = True
    result['grounded'] = all(point['quote'] in row['source'] for point in points)
    if value['needs_more_context']:
        result['grounded'] = result['grounded'] and not points and value['title'] == '资料不足'
    else:
        result['grounded'] = result['grounded'] and bool(points)
    result['expectedOutcome'] = value['needs_more_context'] == row['expected']['needs_more_context']
    result['completeQuote'] = all(expected['quote'] in [point['quote'] for point in points]
                                  for expected in row['expected']['key_points'])
    result['passed'] = all(result[key] for key in ['schema', 'grounded', 'expectedOutcome', 'completeQuote'])
    return result


def summarize(rows: list[dict[str, Any]]) -> dict[str, Any]:
    counts = {key: sum(bool(row.get('scores', {}).get(key)) for row in rows)
              for key in ['json', 'schema', 'grounded', 'expectedOutcome', 'completeQuote', 'passed']}
    return {'samples': len(rows), 'completed': sum('content' in row for row in rows),
            'counts': counts, 'humanSemanticAcceptance': False, 'generalSuperiorityEstablished': False}
