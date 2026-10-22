"""Tiny random-weight reproduction for generation API compatibility, not quality."""
import json
from pathlib import Path
import traceback


def main() -> None:
    import numpy as np
    import mindspore as ms
    from mindformers import LlamaConfig, LlamaForCausalLM
    from mindformers.pet import LoraConfig, get_pet_model
    ms.set_context(mode=ms.PYNATIVE_MODE, device_target='Ascend', max_device_memory='24GB')
    config = LlamaConfig(batch_size=1, seq_length=32, hidden_size=32, num_layers=1,
                         num_heads=4, n_kv_heads=2, vocab_size=128, intermediate_size=64,
                         compute_dtype='float16', param_init_type='float16', use_past=False,
                         use_flash_attention=False, tie_word_embeddings=True,
                         pad_token_id=0, eos_token_id=127, max_decode_length=32)
    model = get_pet_model(LlamaForCausalLM(config), LoraConfig(lora_rank=8, lora_alpha=16,
                          lora_dropout=0.0, target_modules=r'.*wq|.*wk|.*wv|.*wo', compute_dtype='float16'))
    model.set_train(False)
    model.generate(np.array([[1, 2, 3]], dtype=np.int32), max_new_tokens=2, do_sample=False,
                   pad_token_id=0, eos_token_id=[127])
    print(json.dumps({'randomGeneration': 'passed', 'qualityAcceptance': False}), flush=True)


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        # This reproduction has no external requests, source text or credentials.
        print(json.dumps({'randomGeneration': 'failed', 'errorType': type(error).__name__,
                          'message': str(error)[:500], 'stack': [
                              {'file': Path(frame.filename).name, 'line': frame.lineno, 'function': frame.name}
                              for frame in traceback.extract_tb(error.__traceback__)[-8:]]}), flush=True)
        raise SystemExit(1) from None
