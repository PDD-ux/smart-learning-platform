"""Check complete dialogs offline before official preprocessing can truncate them."""
import argparse
import hashlib
import json
import os
from pathlib import Path


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--bundle', type=Path, required=True)
    parser.add_argument('--tokenizer', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    with args.output.open('x', encoding='utf-8') as handle:
        report = {'passed': False, 'maxSequenceLength': 1025, 'semanticAcceptance': False}
        try:
            lock = json.loads((Path(__file__).parent / 'source-lock.json').read_text(encoding='utf-8'))
            for name, detail in lock['tokenizerAssets'].items():
                if hashlib.sha256((args.tokenizer / name).read_bytes()).hexdigest() != detail['sha256']:
                    raise ValueError('TOKENIZER_HASH')
            os.environ['HF_HUB_OFFLINE'] = '1'
            from transformers import AutoTokenizer
            tokenizer = AutoTokenizer.from_pretrained(str(args.tokenizer), local_files_only=True, trust_remote_code=False)
            manifest = json.loads((args.bundle / 'manifest.json').read_text(encoding='utf-8'))
            counts = {}
            for split in ['train', 'heldout']:
                name = f'{split}.messages.jsonl'
                data = (args.bundle / name).read_bytes()
                if hashlib.sha256(data).hexdigest() != manifest['files'][name]:
                    raise ValueError('DATASET_HASH')
                lengths = [len(tokenizer.apply_chat_template(json.loads(line)['messages'], tokenize=True,
                           add_generation_prompt=False, truncation=False)) for line in data.decode('utf-8').splitlines()]
                if not lengths or max(lengths) > 1025:
                    raise ValueError('WOULD_TRUNCATE')
                counts[split] = {'count': len(lengths), 'maxTokens': max(lengths)}
            report.update({'passed': True, 'splits': counts, 'truncation': False,
                           'modelWeightsLoaded': False, 'readyForRealTraining': False})
        except Exception as error:
            allowed = {'TOKENIZER_HASH', 'DATASET_HASH', 'WOULD_TRUNCATE'}
            report['code'] = str(error) if isinstance(error, ValueError) and str(error) in allowed else 'LOCAL_TOKENIZER_CHECK_FAILED'
            report['failureType'] = type(error).__name__
        json.dump(report, handle, ensure_ascii=False, indent=2)
    print(json.dumps({'tokenCheckPassed': report['passed'], 'semanticAcceptance': False}))
    if not report['passed']:
        raise SystemExit(1)


if __name__ == '__main__':
    main()
