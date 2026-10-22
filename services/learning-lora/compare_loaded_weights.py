"""CPU-only hash comparison of forward diagnostic tensors against fixed official weights."""
import hashlib
import json
from pathlib import Path
import sys


def main() -> None:
    import numpy as np
    from safetensors import safe_open
    from mindformers import LlamaForCausalLM
    scratch, artifacts = Path(sys.argv[1]), Path(sys.argv[2])
    reference = json.loads((artifacts / 'forward-diagnostic.json').read_text())['parameterHashes']
    matched, missing, different = 0, [], []
    matched_dtypes = {'float16': 0, 'float32': 0}
    with safe_open(str(scratch / 'base-model/model.safetensors'), framework='pt', device='cpu') as source:
        for name in source.keys():
            target = LlamaForCausalLM.convert_name(name)
            value = source.get_tensor(name).float().numpy().astype(np.float16)
            checksum = hashlib.sha256(value.tobytes()).hexdigest()
            if target not in reference:
                missing.append(target)
            else:
                if reference[target] == checksum:
                    matched += 1
                    matched_dtypes['float16'] += 1
                elif reference[target] == hashlib.sha256(value.astype(np.float32).tobytes()).hexdigest():
                    # MindFormers RMSNorm parameters remain float32 despite float16 param_init_type.
                    matched += 1
                    matched_dtypes['float32'] += 1
                else:
                    different.append(target)
    result = {'matchedBaseTensors': matched, 'missing': missing, 'different': different,
              'allBaseTensorsExact': bool(matched) and not missing and not different,
              'matchedRuntimeDtypes': matched_dtypes, 'trainingExecuted': False}
    with (artifacts / 'loaded-weight-comparison-typed.json').open('x', encoding='utf-8') as handle:
        json.dump(result, handle, indent=2)
    print(json.dumps(result), flush=True)


if __name__ == '__main__':
    main()
