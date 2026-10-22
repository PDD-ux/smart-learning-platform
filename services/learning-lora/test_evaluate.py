import copy
import json
from pathlib import Path
import unittest

from evaluate import score, summarize
from prepare import load_cases


class EvaluationTests(unittest.TestCase):
    def setUp(self) -> None:
        self.rows = [row for row in load_cases(Path(__file__).with_name('seed-cases.jsonl'))
                     if row['split'] == 'heldout']

    def test_all_reference_answers_pass(self) -> None:
        for row in self.rows:
            self.assertTrue(score(row, json.dumps(row['expected']))['passed'])

    def test_rewritten_subject_or_negation_cannot_pass(self) -> None:
        row = next(row for row in self.rows if row['expected']['key_points'])
        for replacement in ['函数把值域中的元素映射到定义域中的元素。', '这个结论始终成立，不需要满足任何条件。']:
            answer = copy.deepcopy(row['expected'])
            answer['key_points'][0] = {'text': replacement, 'quote': replacement}
            self.assertFalse(score(row, json.dumps(answer))['grounded'])
            self.assertFalse(score(row, json.dumps(answer))['passed'])

    def test_only_partial_quote_cannot_pass_complete_quote_check(self) -> None:
        row = next(row for row in self.rows if row['expected']['key_points'])
        answer = copy.deepcopy(row['expected'])
        quote = answer['key_points'][0]['quote'][:8]
        answer['key_points'][0] = {'text': quote, 'quote': quote}
        result = score(row, json.dumps(answer))
        self.assertTrue(result['grounded'])
        self.assertFalse(result['completeQuote'])
        self.assertFalse(result['passed'])

    def test_false_abstention_and_fabricated_answer_fail(self) -> None:
        supported = next(row for row in self.rows if row['expected']['key_points'])
        abstain = next(row for row in self.rows if row['expected']['needs_more_context'])
        self.assertFalse(score(supported, json.dumps(abstain['expected']))['passed'])
        self.assertFalse(score(abstain, json.dumps(supported['expected']))['passed'])

    def test_fenced_json_extra_fields_and_invalid_boolean_fail(self) -> None:
        row = self.rows[0]
        for content in ['', '```json\n{}\n```', '[]', 'null', '{"title": "x"}']:
            self.assertFalse(score(row, content)['passed'])
        for field, value in [('extra', 'unexpected'), ('needs_more_context', 0)]:
            answer = copy.deepcopy(row['expected'])
            answer[field] = value
            self.assertFalse(score(row, json.dumps(answer))['schema'])

    def test_network_failure_is_not_a_completed_model_answer(self) -> None:
        result = summarize([{'id': 'failed', 'error': 'TIMEOUT'}])
        self.assertEqual(result['completed'], 0)
        self.assertEqual(result['counts']['passed'], 0)
        self.assertFalse(result['generalSuperiorityEstablished'])


if __name__ == '__main__':
    unittest.main()
