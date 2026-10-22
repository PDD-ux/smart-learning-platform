"""Fetch only pinned public config/tokenizer assets. No pretrained weights or API calls."""
import argparse
import hashlib
import json
from pathlib import Path
import urllib.request

ROOT = Path(__file__).resolve().parent


def fetch(output: Path) -> None:
    lock = json.loads((ROOT / 'source-lock.json').read_text(encoding='utf-8'))
    config_name = 'research/qwen2_5/finetune_qwen2_5_1_5b_8k.yaml'
    tasks = [('template.yaml', 'https://raw.githubusercontent.com/mindspore-ai/mindformers/'
              + lock['mindformersRevision'] + '/' + config_name, lock['files'][config_name])]
    for name, detail in lock['tokenizerAssets'].items():
        tasks.append(('tokenizer/' + name, 'https://huggingface.co/' + lock['baseModel']['id']
                      + '/resolve/' + lock['baseModel']['revision'] + '/' + name, detail))
    output.mkdir(exist_ok=False)
    (output / 'tokenizer').mkdir()
    for name, url, detail in tasks:
        request = urllib.request.Request(url, headers={'User-Agent': 'taskbook-lora-preparation'})
        with urllib.request.urlopen(request, timeout=30) as response:
            data = response.read(16 * 1024 * 1024 + 1)
        if len(data) != detail['bytes'] or hashlib.sha256(data).hexdigest() != detail['sha256']:
            raise ValueError('ASSET_HASH_OR_SIZE')
        (output / name).write_bytes(data)
    (output / 'source-lock.json').write_text(json.dumps(lock, indent=2), encoding='utf-8')


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    try:
        fetch(args.output)
        print(json.dumps({'assetsVerified': True, 'pretrainedWeightsDownloaded': False}))
    except Exception as error:
        print(json.dumps({'assetsVerified': False, 'code': 'FETCH_OR_HASH_FAILED', 'failureType': type(error).__name__}))
        raise SystemExit(1) from None


if __name__ == '__main__':
    main()
