"""One bounded numerical/weight diagnostic. Does not train, modify weights or call APIs."""
import json
from pathlib import Path
import sys

from pilot import build_model, tokenizer, tensor_hash, write
from prepare import ROOT, load_cases, messages


def main() -> None:
    import numpy as np
    import mindspore as ms
    scratch, artifacts = Path(sys.argv[1]), Path(sys.argv[2])
    model = build_model(scratch)
    model.set_train(False)
    nonfinite = []
    maximum = 0.0
    zeros = []
    parameter_hashes = {}
    for param in model.get_parameters():
        value = param.asnumpy()
        parameter_hashes[param.name] = tensor_hash(param)
        if not np.isfinite(value).all():
            nonfinite.append(param.name)
        maximum = max(maximum, float(np.max(np.abs(value))))
        if 'lora_b' in param.name.lower():
            zeros.append(not np.count_nonzero(value))
    row = next(row for row in load_cases(ROOT / 'seed-cases.jsonl') if row['split'] == 'heldout')
    tok = tokenizer(scratch)
    prompt = tok.apply_chat_template(messages(row)['messages'][:-1], tokenize=True, add_generation_prompt=True)
    padded = prompt + [model.config.pad_token_id] * (model.config.seq_length - len(prompt))
    raw = model(ms.Tensor(np.array([padded], dtype=np.int32)),
                batch_valid_length=ms.Tensor(np.array([len(prompt)], dtype=np.int32)))
    logits = raw[0].asnumpy().reshape(-1, model.config.vocab_size)[-1]
    result = {'nonfiniteParameters': nonfinite, 'largestAbsoluteParameter': maximum,
              'initialLoraBAllZero': bool(zeros) and all(zeros), 'initialLoraBTensors': len(zeros),
              'logits': {'finite': bool(np.isfinite(logits).all()), 'nan': int(np.isnan(logits).sum()),
                         'infinite': int(np.isinf(logits).sum()), 'firstArgmax': int(np.argmax(logits))},
              'parameterHashes': parameter_hashes,
              'parameterDtypes': {param.name: str(param.dtype) for param in model.get_parameters()},
              'weightHashVerified': True,
              'trainingExecuted': False, 'semanticAcceptance': False}
    write(artifacts / 'forward-diagnostic.json', result)
    print(json.dumps({key: value for key, value in result.items() if key != 'parameterHashes'}), flush=True)


if __name__ == '__main__':
    main()
