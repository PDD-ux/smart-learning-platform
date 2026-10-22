"""Random tiny-model LoRA check, never pretrained weights or real classroom training.

Run with an external timeout (documented 120s) in an isolated working directory.
Only a fixed numerical summary is written; a passing smoke is NOT model quality acceptance.
"""
import argparse
import hashlib
import importlib.metadata
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import time


def static_report() -> dict:
    packages = {}
    for name in ['mindspore', 'mindformers', 'transformers', 'PyYAML']:
        try:
            packages[name] = importlib.metadata.version(name)
        except importlib.metadata.PackageNotFoundError:
            packages[name] = None
    paths = {}
    for path in ['/home/ma-user/work', '/home/ma-user', '/tmp', '/cache']:
        if os.path.isdir(path):
            paths[path] = {'freeGiB': round(shutil.disk_usage(path).free / 1024 ** 3, 1),
                           'persistenceVerified': False}
    device = subprocess.run(['npu-smi', 'info'], capture_output=True, text=True, timeout=15, check=False)
    cann_info = Path('/usr/local/Ascend/ascend-toolkit/latest/aarch64-linux/ascend_toolkit_install.info')
    match = re.search(r'^version=([A-Za-z0-9.]+)', cann_info.read_text(), re.MULTILINE) if cann_info.is_file() else None
    cann = match.group(1) if match else None
    smi_match = re.search(r'npu-smi\s+([0-9.]+)', device.stdout)
    return {'packages': packages, 'storage': paths,
            'cann': cann, 'npuSmiVersion': smi_match.group(1) if smi_match else None,
            'npu910B4Observed': '910B4' in device.stdout and device.returncode == 0,
            'environmentVersionMatches': packages['mindspore'] == '2.7.1' and packages['mindformers'] == '1.7.0' and cann == '8.3.RC1',
            'pretrainedWeightsDownloaded': False, 'semanticAcceptance': False}


def tiny_lora() -> dict:
    import numpy as np
    import mindspore as ms
    from mindspore import nn
    from mindformers import LlamaConfig, LlamaForCausalLM
    from mindformers.pet import LoraConfig, get_pet_model

    ms.set_seed(42)
    ms.set_context(mode=ms.PYNATIVE_MODE, device_target='Ascend', max_device_memory='24GB')
    config = LlamaConfig(batch_size=1, seq_length=32, hidden_size=64, num_layers=1,
                         num_heads=4, n_kv_heads=2, intermediate_size=128, vocab_size=128,
                         compute_dtype='float16', param_init_type='float32',
                         use_flash_attention=False, use_past=False, qkv_concat=False)
    model = get_pet_model(LlamaForCausalLM(config), LoraConfig(
        lora_rank=4, lora_alpha=8, lora_dropout=0.0,
        target_modules=r'.*wq|.*wk|.*wv|.*wo', compute_dtype='float16'))
    model.set_train(True)
    trainable = model.trainable_params()
    if not trainable or any('lora' not in parameter.name.lower() for parameter in trainable):
        raise ValueError('ADAPTER_FREEZE_FAILED')
    def fingerprint(parameter) -> str:
        return hashlib.sha256(parameter.asnumpy().tobytes()).hexdigest()
    before = {parameter.name: fingerprint(parameter) for parameter in model.get_parameters()}
    optimizer = nn.AdamWeightDecay(trainable, learning_rate=0.001)
    ids = ms.Tensor(np.arange(1, 34, dtype=np.int32).reshape(1, 33) % 128)
    grad = ms.value_and_grad(lambda: model(ids), None, optimizer.parameters)
    losses = []
    for _ in range(2):
        loss, gradients = grad()
        value = float(loss.asnumpy())
        if not np.isfinite(value) or any(not np.isfinite(item.asnumpy()).all() for item in gradients):
            raise ValueError('NONFINITE_LOSS_OR_GRADIENT')
        optimizer(gradients)
        losses.append(value)
    changed = [parameter for parameter in model.get_parameters() if fingerprint(parameter) != before[parameter.name]]
    if not changed or any(not parameter.requires_grad for parameter in changed):
        raise ValueError('PARAMETER_UPDATE_FAILED')
    return {'scope': 'random-tiny-llama-lora-only', 'steps': 2, 'losses': losses,
            'trainableParameters': sum(int(parameter.size) for parameter in trainable),
            'changedAdapterTensors': len(changed), 'frozenBaseUnchanged': True,
            'pretrainedModelTrained': False, 'semanticAcceptance': False}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--tiny-lora', action='store_true')
    args = parser.parse_args()
    started = time.monotonic()
    # Reserve evidence before imports/compute. Existing results must never be overwritten.
    with args.output.open('x', encoding='utf-8') as handle:
        report = {'passed': False, 'semanticAcceptance': False}
        try:
            report.update(static_report())
            if not report['environmentVersionMatches'] or not report['npu910B4Observed']:
                raise ValueError('ENVIRONMENT_MISMATCH')
            if args.tiny_lora:
                report['tinyLora'] = tiny_lora()
            report['passed'] = True
        except Exception as error:  # Do not expose tracebacks, environment or private upstream text.
            report['failureType'] = type(error).__name__
            report['failureStage'] = 'runtime-smoke'
            allowed = {'ENVIRONMENT_MISMATCH', 'ADAPTER_FREEZE_FAILED', 'NONFINITE_LOSS_OR_GRADIENT', 'PARAMETER_UPDATE_FAILED'}
            report['failureCode'] = str(error) if isinstance(error, ValueError) and str(error) in allowed else 'RUNTIME_ERROR'
        report['elapsedSeconds'] = round(time.monotonic() - started, 3)
        json.dump(report, handle, ensure_ascii=False, indent=2)
    print(json.dumps({'passed': report['passed'], 'semanticAcceptance': False}))
    if not report['passed']:
        raise SystemExit(1)


if __name__ == '__main__':
    main()
