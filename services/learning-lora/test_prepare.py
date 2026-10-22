import copy
import json
from pathlib import Path
import unittest

from prepare import PreparationError, build_config, load_cases, messages, validate_cases

ROOT = Path(__file__).resolve().parent


class PreparationTests(unittest.TestCase):
    def setUp(self) -> None:
        self.rows = load_cases(ROOT / 'seed-cases.jsonl')

    def test_original_seed_is_split_without_heldout_training_messages(self) -> None:
        self.assertEqual(validate_cases(self.rows), {'train': 12, 'heldout': 6})
        train = [messages(row) for row in self.rows if row['split'] == 'train']
        for row in self.rows:
            if row['split'] == 'heldout':
                self.assertNotIn(row['source'], json.dumps(train, ensure_ascii=False))

    def test_foreign_quote_and_rewritten_subject_fail(self) -> None:
        for change in [{'quote': '这是一条根本没有出现在原文中的句子'}, {'text': '把一个元素映射到多个元素'}]:
            rows = copy.deepcopy(self.rows)
            rows[0]['expected']['key_points'][0].update(change)
            with self.assertRaisesRegex(PreparationError, '^UNSUPPORTED_QUOTE$'):
                validate_cases(rows)

    def test_source_group_cannot_cross_splits(self) -> None:
        self.rows[-1]['source_group'] = self.rows[0]['source_group']
        with self.assertRaisesRegex(PreparationError, '^SOURCE_GROUP_LEAKAGE$'):
            validate_cases(self.rows)

    def test_duplicated_id_or_source_fails(self) -> None:
        for field, code in [('id', 'DUPLICATE_OR_INVALID_ID'), ('source', 'REPEATED_SOURCE')]:
            rows = copy.deepcopy(self.rows)
            rows[1][field] = rows[0][field]
            with self.assertRaisesRegex(PreparationError, f'^{code}$'):
                validate_cases(rows)

    def test_missing_heldout_and_empty_answers_fail(self) -> None:
        with self.assertRaisesRegex(PreparationError, '^MISSING_SPLIT$'):
            validate_cases([row for row in self.rows if row['split'] == 'train'])
        self.rows[0]['expected']['key_points'] = []
        with self.assertRaisesRegex(PreparationError, '^EMPTY_ANSWER$'):
            validate_cases(self.rows)

    def test_abstention_does_not_allow_a_fabricated_answer(self) -> None:
        self.rows[-1]['expected']['key_points'] = [{'text': '一个编造的解释', 'quote': '一个编造的解释'}]
        with self.assertRaisesRegex(PreparationError, '^ABSTENTION_CONFLICT$'):
            validate_cases(self.rows)

    def test_unapproved_private_source_or_invalid_split_fails(self) -> None:
        self.rows[0]['source_author'] = 'private-user-course'
        with self.assertRaisesRegex(PreparationError, '^SOURCE_PERMISSION_NOT_DECLARED$'):
            validate_cases(self.rows)
        self.rows[0]['source_author'] = 'project-original-synthetic'
        self.rows[0]['split'] = {}
        with self.assertRaisesRegex(PreparationError, '^INVALID_SPLIT_OR_GROUP$'):
            validate_cases(self.rows)

    def test_context_is_data_not_executable_instruction(self) -> None:
        row = next(row for row in self.rows if '广告' in row['source'])
        wire = messages(row)
        self.assertEqual(len(wire['messages']), 3)
        self.assertEqual(wire['messages'][0]['role'], 'system')
        self.assertEqual(json.loads(wire['messages'][1]['content'])['source'], row['source'])
        self.assertNotIn('广告', wire['messages'][2]['content'])

    def template(self) -> dict:
        return {'runner_config': {}, 'parallel_config': {}, 'parallel': {}, 'context': {},
                'model': {'model_config': {}}, 'train_dataset': {'data_loader': {}},
                'train_dataset_task': {}, 'optimizer': {}, 'lr_schedule': {}}

    def test_single_card_memory_and_lora_overrides_without_mutating_source(self) -> None:
        source = self.template()
        before = copy.deepcopy(source)
        value = build_config(source, '/home/ma-user/.cache/taskbook-learning-lora/pilot')
        self.assertEqual(source, before)
        self.assertFalse(value['use_parallel'])
        self.assertEqual(value['parallel_config']['data_parallel'], 1)
        self.assertEqual(value['context']['max_device_memory'], '24GB')
        self.assertEqual(value['model']['model_config']['seq_length'], 1024)
        self.assertEqual(value['model']['model_config']['pet_config']['lora_rank'], 8)
        self.assertFalse(value['runner_config']['sink_mode'])
        self.assertEqual(value['callbacks'], [{'type': 'MFLossMonitor'}])
        self.assertNotIn('heldout', value['train_dataset']['data_loader']['dataset_dir'])

    def test_rejects_root_traversal_and_shell_content(self) -> None:
        for path in ['/', '/home/ma-user/work/../old', '/home/ma-user/work/x;touch secret', '/tmp/model']:
            with self.assertRaisesRegex(PreparationError, '^REMOTE_ROOT$'):
                build_config(self.template(), path)


if __name__ == '__main__':
    unittest.main()
