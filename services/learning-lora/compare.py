"""Score frozen heldout outputs without another model call or output repair."""
import argparse
import hashlib
import json
from pathlib import Path

from evaluate import score, summarize
from prepare import ROOT, load_cases


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--run', type=Path, required=True)
    args = parser.parse_args()
    cases = {row['id']: row for row in load_cases(ROOT / 'seed-cases.jsonl') if row['split'] == 'heldout'}
    report = {'seedCasesSha256': hashlib.sha256((ROOT / 'seed-cases.jsonl').read_bytes()).hexdigest(),
              'requiredSamples': len(cases), 'models': {}, 'humanSemanticAcceptance': False,
              'generalSuperiorityEstablished': False, 'productRoutingChanged': False}
    diagnostic = args.run / 'artifacts/forward-diagnostic.json'
    numerical_failure = diagnostic.exists() and not json.loads(diagnostic.read_text())['logits']['finite']
    for name, path in [('baseline', args.run / 'artifacts/baseline.jsonl'),
                       ('adapted', args.run / 'artifacts/adapted.jsonl'),
                       ('reloaded', args.run / 'artifacts/reloaded.jsonl'),
                       ('spark', args.run / 'spark/spark.jsonl')]:
        if not path.exists():
            report['models'][name] = {'status': 'not-completed', 'samples': 0}
            continue
        rows = [json.loads(line) for line in path.read_text(encoding='utf-8').splitlines() if line.strip()]
        ids = [row['id'] for row in rows]
        if len(set(ids)) != len(ids) or any(identifier not in cases for identifier in ids):
            raise ValueError('EVALUATION_IDS_CHANGED')
        for row in rows:
            if 'content' in row:
                row['scores'] = score(cases[row['id']], row['content'])
        report['models'][name] = {'status': 'completed' if set(ids) == set(cases) else 'partial',
                                  **summarize(rows), 'results': rows}
        if name == 'baseline' and numerical_failure:
            report['models'][name].update({'status': 'invalid-runtime', 'validForCapabilityComparison': False})
    with (args.run / 'comparison.json').open('x', encoding='utf-8') as handle:
        json.dump(report, handle, ensure_ascii=False, indent=2)
    print(json.dumps({name: {key: value for key, value in summary.items() if key != 'results'}
                      for name, summary in report['models'].items()}, ensure_ascii=False))


if __name__ == '__main__':
    main()
