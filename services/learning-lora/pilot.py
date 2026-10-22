"""Explicit bounded real-model pilot phases. Run each with the documented external timeout."""
import argparse
import gc
import hashlib
import json
import os
from pathlib import Path
import shutil
import time
import traceback
import urllib.request

from evaluate import score, summarize
from prepare import ROOT, load_cases, messages


def sha(path: Path) -> str:
    value = hashlib.sha256()
    with path.open('rb') as handle:
        for chunk in iter(lambda: handle.read(8 * 1024 * 1024), b''):
            value.update(chunk)
    return value.hexdigest()


def write(path: Path, value: dict) -> None:
    with path.open('x', encoding='utf-8') as handle:
        json.dump(value, handle, ensure_ascii=False, indent=2)


def validate_frozen_inputs(artifacts: Path) -> None:
    manifest = json.loads((artifacts.parent / 'bundle/manifest.json').read_text(encoding='utf-8'))
    lock = json.loads((ROOT / 'source-lock.json').read_text(encoding='utf-8'))
    if manifest['sourceLock'] != lock:
        raise ValueError('EXPERIMENT_INPUTS_CHANGED')
    rows = load_cases(ROOT / 'seed-cases.jsonl')
    for split in ['train', 'heldout']:
        raw = ''.join(json.dumps(messages(row), ensure_ascii=False) + '\n'
                      for row in rows if row['split'] == split).encode('utf-8')
        if hashlib.sha256(raw).hexdigest() != manifest['files'][f'{split}.messages.jsonl']:
            raise ValueError('EXPERIMENT_INPUTS_CHANGED')


def validate_baseline_outputs(artifacts: Path) -> None:
    rows = [json.loads(line) for line in (artifacts / 'baseline.jsonl').read_text(encoding='utf-8').splitlines()]
    expected = {row['id'] for row in load_cases(ROOT / 'seed-cases.jsonl') if row['split'] == 'heldout'}
    if len(rows) != 6 or {row['id'] for row in rows} != expected:
        raise ValueError('PREVIOUS_STAGE_INCOMPLETE')
    if any(len(row.get('content', '').strip()) >= 32 and len(set(row['content'].strip())) == 1 for row in rows):
        raise ValueError('DEGENERATE_BASELINE')


def download(scratch: Path, artifacts: Path, tokenizer_dir: Path) -> None:
    lock = json.loads((ROOT / 'source-lock.json').read_text())
    if shutil.disk_usage(scratch).free < 10 * 1024**3:
        raise ValueError('SCRATCH_SPACE')
    directory = scratch / 'base-model'
    directory.mkdir()
    for name, detail in lock['tokenizerAssets'].items():
        source = tokenizer_dir / name
        if sha(source) != detail['sha256']:
            raise ValueError('TOKENIZER_HASH')
        shutil.copyfile(source, directory / name)
    expected = lock['weightAssets']['model.safetensors']
    url = f"https://huggingface.co/{lock['baseModel']['id']}/resolve/{lock['baseModel']['revision']}/model.safetensors?download=true"
    request = urllib.request.Request(url, headers={'User-Agent': 'taskbook-bounded-lora-pilot'})
    partial = directory / 'model.safetensors.partial'
    total, checksum, start = 0, hashlib.sha256(), time.monotonic()
    with urllib.request.urlopen(request, timeout=30) as response, partial.open('xb') as handle:
        while True:
            data = response.read(8 * 1024 * 1024)
            if not data:
                break
            total += len(data)
            if total > expected['bytes'] or time.monotonic() - start > 570:
                raise ValueError('DOWNLOAD_BUDGET')
            checksum.update(data)
            handle.write(data)
    if total != expected['bytes'] or checksum.hexdigest() != expected['sha256']:
        raise ValueError('WEIGHT_HASH')
    partial.rename(directory / 'model.safetensors')
    write(artifacts / 'download.json', {'verified': True, 'weight': expected, 'baseModel': lock['baseModel'],
          'scratchPersistenceVerified': False, 'seconds': round(time.monotonic() - start, 3)})


def tokenizer(scratch: Path):
    os.environ['HF_HUB_OFFLINE'] = '1'
    from transformers import AutoTokenizer
    return AutoTokenizer.from_pretrained(str(scratch / 'base-model'), local_files_only=True, trust_remote_code=False)


def build_model(scratch: Path, sequence_length: int = 512):
    import numpy as np
    import mindspore as ms
    from safetensors import safe_open
    from mindformers import LlamaConfig, LlamaForCausalLM
    from mindformers.pet import LoraConfig, get_pet_model
    import yaml

    ms.set_seed(42)
    ms.set_context(mode=ms.PYNATIVE_MODE, device_target='Ascend', max_device_memory='24GB')
    lock = json.loads((ROOT / 'source-lock.json').read_text())
    if sha(scratch / 'base-model/model.safetensors') != lock['weightAssets']['model.safetensors']['sha256']:
        raise ValueError('WEIGHT_HASH')
    raw = yaml.safe_load((scratch / 'candidate.yaml').read_text())['model']['model_config']
    raw.pop('type', None)
    raw.pop('pet_config', None)
    raw.update({'seq_length': sequence_length, 'use_past': False, 'checkpoint_name_or_path': ''})
    model = LlamaForCausalLM(LlamaConfig(**raw))
    print(json.dumps({'stage': 'model-created'}), flush=True)
    expected = model.parameters_dict()
    weights = {}
    converted_hashes = {}
    with safe_open(str(scratch / 'base-model/model.safetensors'), framework='pt', device='cpu') as source:
        for name in source.keys():
            target = LlamaForCausalLM.convert_name(name)
            if target not in expected:
                raise ValueError('UNEXPECTED_BASE_WEIGHT')
            tensor = source.get_tensor(name).float().numpy().astype(np.float16)
            if tuple(tensor.shape) != tuple(expected[target].shape):
                raise ValueError('BASE_WEIGHT_SHAPE')
            if not np.isfinite(tensor).all():
                raise ValueError('NONFINITE_BASE_WEIGHT')
            weights[target] = ms.Parameter(ms.Tensor(tensor, expected[target].dtype), name=target)
            converted_hashes[target] = tensor_hash(weights[target])
    missing, unused = ms.load_param_into_net(model, weights, strict_load=True)
    if missing or unused:
        raise ValueError('BASE_WEIGHT_LOAD_INCOMPLETE')
    if any(tensor_hash(expected[name]) != value for name, value in converted_hashes.items()):
        raise ValueError('BASE_WEIGHT_VALUES')
    print(json.dumps({'stage': 'base-loaded', 'tensors': len(weights)}), flush=True)
    del weights
    gc.collect()
    model = get_pet_model(model, LoraConfig(lora_rank=8, lora_alpha=16, lora_dropout=0.0,
                          target_modules=r'.*wq|.*wk|.*wv|.*wo', compute_dtype='float16'))
    if not model.trainable_params() or any('lora' not in param.name.lower() for param in model.trainable_params()):
        raise ValueError('ADAPTER_FREEZE')
    current = model.parameters_dict()
    if any(name not in current or tensor_hash(current[name]) != value for name, value in converted_hashes.items()):
        raise ValueError('ADAPTER_CHANGED_BASE_VALUES')
    return model


def evaluate(model, tok, artifacts: Path, name: str) -> dict:
    import numpy as np
    model.set_train(False)
    results = []
    output = artifacts / f'{name}.jsonl'
    with output.open('x', encoding='utf-8') as handle:
        for row in load_cases(ROOT / 'seed-cases.jsonl'):
            if row['split'] != 'heldout':
                continue
            prompt = tok.apply_chat_template(messages(row)['messages'][:-1], tokenize=True, add_generation_prompt=True)
            checked_prefill(model, prompt)
            start = time.monotonic()
            generated = model.generate(np.array([prompt], dtype=np.int32), max_new_tokens=192, do_sample=False,
                                       pad_token_id=151643, eos_token_id=[151645])
            tokens = list(generated[0])[len(prompt):]
            content = tok.decode(tokens, skip_special_tokens=True)
            result = {'id': row['id'], 'content': content, 'scores': score(row, content),
                      'outputTokens': len(tokens), 'seconds': round(time.monotonic() - start, 3)}
            handle.write(json.dumps(result, ensure_ascii=False) + '\n')
            handle.flush()
            results.append(result)
            print(json.dumps({'stage': name, 'completed': len(results), 'passed': result['scores']['passed']}), flush=True)
    summary = summarize(results)
    write(artifacts / f'{name}-summary.json', summary)
    return summary


def tensor_hash(param) -> str:
    return hashlib.sha256(param.asnumpy().tobytes()).hexdigest()


def checked_prefill(model, prompt: list[int]):
    import numpy as np
    import mindspore as ms
    padded = prompt + [model.config.pad_token_id] * (model.config.seq_length - len(prompt))
    if len(padded) != model.config.seq_length:
        raise ValueError('TOKEN_MASK_OR_LENGTH')
    logits = model(ms.Tensor(np.array([padded], dtype=np.int32)),
                   batch_valid_length=ms.Tensor(np.array([len(prompt)], dtype=np.int32)))[0]
    if not np.isfinite(logits.asnumpy()).all():
        raise ValueError('NONFINITE_PREFILL')
    return logits


def assistant_training_record(tok, row: dict) -> dict:
    wire = messages(row)['messages']
    ids = tok.apply_chat_template(wire, tokenize=True, add_generation_prompt=False)
    prefix = tok.apply_chat_template(wire[:-1], tokenize=True, add_generation_prompt=True)
    if len(ids) > 257 or ids[:len(prefix)] != prefix or len(ids) <= len(prefix):
        raise ValueError('TOKEN_MASK_OR_LENGTH')
    return {'input_ids': ids + [151643] * (257 - len(ids)),
            'target_ids': [-100] * len(prefix) + ids[len(prefix):] + [-100] * (257 - len(ids)),
            'attention_mask': [1] * len(ids) + [0] * (257 - len(ids))}


def train(scratch: Path, artifacts: Path) -> None:
    import numpy as np
    import mindspore as ms
    from mindspore import nn
    from mindspore.mindrecord import FileWriter
    from mindspore.dataset import MindDataset

    tok = tokenizer(scratch)
    data = []
    for row in load_cases(ROOT / 'seed-cases.jsonl'):
        if row['split'] != 'train':
            continue
        data.append({name: np.array(value, dtype=np.int32)
                     for name, value in assistant_training_record(tok, row).items()})
    if len(data) != 12:
        raise ValueError('TRAINING_SET_CHANGED')
    record = scratch / 'train.mindrecord'
    writer = FileWriter(str(record), shard_num=1)
    writer.add_schema({name: {'type': 'int32', 'shape': [-1]} for name in data[0]})
    writer.write_raw_data(data)
    writer.commit()
    write(artifacts / 'dataset.json', {'trainRecords': len(data), 'heldoutRecords': 6,
         'mindrecordSha256': sha(record), 'assistantOnlyLoss': True, 'sequenceLength': 256,
         'seedCasesSha256': sha(ROOT / 'seed-cases.jsonl')})
    model = build_model(scratch, sequence_length=256)
    model.set_train(False)
    first = next(row for row in load_cases(ROOT / 'seed-cases.jsonl') if row['split'] == 'train')
    checked_prefill(model, tok.apply_chat_template(messages(first)['messages'][:-1],
                    tokenize=True, add_generation_prompt=True))
    model.set_train(True)
    before = {param.name: tensor_hash(param) for param in model.get_parameters()}
    trainable = model.trainable_params()
    optimizer = nn.AdamWeightDecay(trainable, learning_rate=0.0001)
    gradient = ms.value_and_grad(lambda ids, labels: model(ids, labels=labels), None, optimizer.parameters)
    dataset = MindDataset(str(record), columns_list=['input_ids', 'target_ids'], shuffle=False, num_parallel_workers=1)
    losses = []
    for epoch in range(2):
        for item in dataset.create_dict_iterator(output_numpy=True):
            loss, grads = gradient(ms.Tensor(item['input_ids'][None, :]), ms.Tensor(item['target_ids'][None, :]))
            value = float(loss.asnumpy())
            if not np.isfinite(value) or any(not np.isfinite(param.asnumpy()).all() for param in grads):
                raise ValueError('NONFINITE_TRAINING')
            optimizer(grads)
            losses.append(value)
            print(json.dumps({'stage': 'train', 'epoch': epoch + 1, 'step': len(losses), 'loss': value}), flush=True)
    changed = [param for param in model.get_parameters() if tensor_hash(param) != before[param.name]]
    if len(losses) != 24 or not changed or any(not param.requires_grad for param in changed):
        raise ValueError('BASE_CHANGED_OR_NO_ADAPTER_UPDATE')
    adapter = artifacts / 'adapter.ckpt'
    ms.save_checkpoint([{'name': param.name, 'data': param} for param in trainable], str(adapter))
    saved = ms.load_checkpoint(str(adapter))
    if set(saved) != {param.name for param in trainable}:
        raise ValueError('ADAPTER_EXPORT_KEYS')
    for param in trainable:
        if tensor_hash(saved[param.name]) != tensor_hash(param):
            raise ValueError('ADAPTER_EXPORT_VALUES')
    write(artifacts / 'training.json', {'steps': len(losses), 'losses': losses, 'frozenBaseUnchanged': True,
         'adapterSha256': sha(adapter), 'adapterBytes': adapter.stat().st_size,
         'trainableParameters': sum(int(param.size) for param in trainable), 'changedAdapterTensors': len(changed),
         'baseParameterHashes': {param.name: before[param.name] for param in model.get_parameters() if not param.requires_grad},
         'sourceLock': json.loads((ROOT / 'source-lock.json').read_text()), 'semanticAcceptance': False})
    del optimizer, gradient, grads, saved
    gc.collect()
    evaluate(model, tok, artifacts, 'adapted')


def reload_evaluate(scratch: Path, artifacts: Path) -> None:
    import mindspore as ms
    training = json.loads((artifacts / 'training.json').read_text())
    adapter = artifacts / 'adapter.ckpt'
    if sha(adapter) != training['adapterSha256']:
        raise ValueError('ADAPTER_HASH')
    model = build_model(scratch)
    for param in model.get_parameters():
        if not param.requires_grad and tensor_hash(param) != training['baseParameterHashes'][param.name]:
            raise ValueError('RELOAD_BASE_DIFFERENT')
    parameters = {param.name: param for param in model.trainable_params()}
    saved = ms.load_checkpoint(str(adapter))
    if set(saved) != set(parameters):
        raise ValueError('RELOAD_ADAPTER_KEYS')
    for name, value in saved.items():
        parameters[name].set_data(value.data)
    evaluate(model, tokenizer(scratch), artifacts, 'reloaded')
    original = [json.loads(line) for line in (artifacts / 'adapted.jsonl').read_text().splitlines()]
    reloaded = [json.loads(line) for line in (artifacts / 'reloaded.jsonl').read_text().splitlines()]
    if [(row['id'], row['content'], row['scores']) for row in original] != [(row['id'], row['content'], row['scores']) for row in reloaded]:
        raise ValueError('RELOAD_OUTPUT_DIFFERENT')
    write(artifacts / 'reload.json', {'verified': True, 'allHeldoutOutputsIdentical': True,
         'samples': len(reloaded), 'adapterSha256': training['adapterSha256'], 'semanticAcceptance': False})


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('phase', choices=['download', 'baseline', 'train', 'reload'])
    parser.add_argument('--scratch', type=Path, required=True)
    parser.add_argument('--artifacts', type=Path, required=True)
    parser.add_argument('--tokenizer', type=Path)
    parser.add_argument('--attempt', type=int, choices=[1, 2, 3], default=1)
    args = parser.parse_args()
    if args.artifacts.resolve().is_relative_to(args.scratch.resolve()):
        raise ValueError('ARTIFACTS_REQUIRE_SEPARATE_PERSISTENT_PATH')
    start = time.monotonic()
    try:
        validate_frozen_inputs(args.artifacts)
        required = 'baseline-summary.json' if args.phase == 'train' else 'adapted-summary.json' if args.phase == 'reload' else None
        if required:
            completed = json.loads((args.artifacts / required).read_text())
            if completed['samples'] != 6 or completed['completed'] != 6:
                raise ValueError('PREVIOUS_STAGE_INCOMPLETE')
        if args.phase == 'train':
            validate_baseline_outputs(args.artifacts)
        if args.attempt > 1:
            previous = args.artifacts / f'{args.phase}.jsonl'
            if (args.phase != 'baseline' or not previous.exists() or previous.stat().st_size != 0
                    or not list(args.artifacts.glob(f'{args.phase}-failure-*.json'))):
                raise ValueError('RETRY_REQUIRES_EMPTY_FAILED_BASELINE')
            previous.rename(args.artifacts / f'{args.phase}-empty-attempt{args.attempt - 1}.jsonl')
        if args.phase == 'download':
            download(args.scratch, args.artifacts, args.tokenizer)
        elif args.phase == 'baseline':
            evaluate(build_model(args.scratch), tokenizer(args.scratch), args.artifacts, 'baseline')
        elif args.phase == 'train':
            train(args.scratch, args.artifacts)
        else:
            reload_evaluate(args.scratch, args.artifacts)
        print(json.dumps({'stage': args.phase, 'completed': True, 'seconds': round(time.monotonic() - start, 3)}), flush=True)
    except Exception as error:
        allowed = {'SCRATCH_SPACE', 'TOKENIZER_HASH', 'DOWNLOAD_BUDGET', 'WEIGHT_HASH', 'UNEXPECTED_BASE_WEIGHT',
                   'BASE_WEIGHT_SHAPE', 'BASE_WEIGHT_LOAD_INCOMPLETE', 'ADAPTER_FREEZE', 'TOKEN_MASK_OR_LENGTH',
                   'TRAINING_SET_CHANGED', 'NONFINITE_TRAINING', 'BASE_CHANGED_OR_NO_ADAPTER_UPDATE',
                   'ADAPTER_EXPORT_KEYS', 'ADAPTER_EXPORT_VALUES', 'ADAPTER_HASH', 'RELOAD_BASE_DIFFERENT',
                   'RELOAD_ADAPTER_KEYS', 'RELOAD_OUTPUT_DIFFERENT', 'EXPERIMENT_INPUTS_CHANGED',
                   'PREVIOUS_STAGE_INCOMPLETE', 'RETRY_REQUIRES_EMPTY_FAILED_BASELINE', 'DEGENERATE_BASELINE'}
        allowed.update({'NONFINITE_BASE_WEIGHT', 'BASE_WEIGHT_VALUES', 'ADAPTER_CHANGED_BASE_VALUES', 'NONFINITE_PREFILL'})
        report = {'phase': args.phase, 'passed': False, 'errorType': type(error).__name__,
                  'code': str(error) if isinstance(error, ValueError) and str(error) in allowed else 'RUNTIME_ERROR',
                  'seconds': round(time.monotonic() - start, 3)}
        # Only source locations, never exception text/locals/upstream response bodies.
        report['stack'] = [{'file': Path(frame.filename).name, 'line': frame.lineno, 'function': frame.name}
                           for frame in traceback.extract_tb(error.__traceback__)[-4:]]
        write(args.artifacts / f'{args.phase}-failure-{int(time.time())}.json', report)
        print(json.dumps(report), flush=True)
        raise SystemExit(1) from None


if __name__ == '__main__':
    main()
