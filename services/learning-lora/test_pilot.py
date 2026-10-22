import unittest
import hashlib
import json
from pathlib import Path
import tempfile

from pilot import assistant_training_record, validate_frozen_inputs, validate_baseline_outputs
from prepare import ROOT, load_cases, messages


class StubTokenizer:
    def __init__(self, full: list[int], prefix: list[int]):
        self.full, self.prefix = full, prefix

    def apply_chat_template(self, wire, *, tokenize: bool, add_generation_prompt: bool) -> list[int]:
        return self.prefix if add_generation_prompt else self.full


class TrainingRecordTests(unittest.TestCase):
    def test_repetitive_token_zero_baseline_cannot_start_training(self) -> None:
        rows = [dict(id=row['id'], content='!' * 192)
                for row in load_cases(ROOT / 'seed-cases.jsonl') if row['split'] == 'heldout']
        with tempfile.TemporaryDirectory() as directory:
            artifacts = Path(directory)
            (artifacts / 'baseline.jsonl').write_text(''.join(json.dumps(row) + '\n' for row in rows), encoding='utf-8')
            with self.assertRaisesRegex(ValueError, '^DEGENERATE_BASELINE$'):
                validate_baseline_outputs(artifacts)

    def test_masks_all_prompt_and_padding_but_keeps_assistant_eos(self) -> None:
        row = {'id': 'test', 'source': 'original source', 'expected': {}}
        value = assistant_training_record(StubTokenizer([1, 2, 3, 4, 151645], [1, 2, 3]), row)
        self.assertEqual(len(value['input_ids']), 257)
        self.assertEqual(value['target_ids'][:6], [-100, -100, -100, 4, 151645, -100])
        self.assertTrue(all(token == -100 for token in value['target_ids'][5:]))
        self.assertEqual(sum(value['attention_mask']), 5)

    def test_no_silent_truncation_prefix_mismatch_or_empty_completion(self) -> None:
        row = {'id': 'test', 'source': 'original source', 'expected': {}}
        for full, prefix in [([1] * 258, [1]), ([1, 2], [3]), ([1, 2], [1, 2])]:
            with self.assertRaisesRegex(ValueError, '^TOKEN_MASK_OR_LENGTH$'):
                assistant_training_record(StubTokenizer(full, prefix), row)

    def test_frozen_messages_are_checked_again_before_later_stages(self) -> None:
        rows = load_cases(ROOT / 'seed-cases.jsonl')
        manifest = {'sourceLock': json.loads((ROOT / 'source-lock.json').read_text()), 'files': {}}
        for split in ['train', 'heldout']:
            raw = ''.join(json.dumps(messages(row), ensure_ascii=False) + '\n'
                          for row in rows if row['split'] == split).encode('utf-8')
            manifest['files'][f'{split}.messages.jsonl'] = hashlib.sha256(raw).hexdigest()
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / 'bundle').mkdir()
            target = root / 'bundle/manifest.json'
            target.write_text(json.dumps(manifest), encoding='utf-8')
            validate_frozen_inputs(root / 'artifacts')
            manifest['files']['heldout.messages.jsonl'] = '0' * 64
            target.write_text(json.dumps(manifest), encoding='utf-8')
            with self.assertRaisesRegex(ValueError, '^EXPERIMENT_INPUTS_CHANGED$'):
                validate_frozen_inputs(root / 'artifacts')


if __name__ == '__main__':
    unittest.main()
