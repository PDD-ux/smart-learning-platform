"""Private local PCM worker. Load pinned models once; never connect to a network."""
import argparse
import contextlib
import hashlib
import json
from pathlib import Path
import socket
import sys
import wave
import assets
import timing


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--model-root', type=Path, required=True)
    args = parser.parse_args()
    for name, digest in assets.FILES.items():
        if hashlib.sha256((args.model_root / name).read_bytes()).hexdigest() != digest:
            raise ValueError('Model mismatch')

    def deny(*_args, **_kwargs):
        raise RuntimeError('Network disabled')
    socket.create_connection = deny
    socket.socket.connect = deny
    with contextlib.redirect_stdout(sys.stderr):
        import numpy as np
        from funasr_onnx import Paraformer, Fsmn_vad
        vad = Fsmn_vad(str(args.model_root / 'vad'), quantize=True, device_id='-1', intra_op_num_threads=4)
        model = Paraformer(str(args.model_root), quantize=True, device_id='-1', intra_op_num_threads=4)
    print(json.dumps({'ready': True}), flush=True)
    for line in sys.stdin:
        request_id = None
        try:
            request = json.loads(line)
            request_id = request['id']
            with wave.open(request['audioPath'], 'rb') as audio:
                if (audio.getframerate(), audio.getnchannels(), audio.getsampwidth()) != (16000, 1, 2):
                    raise ValueError('Invalid PCM')
                duration = round(audio.getnframes() / 16)
                if not 100 <= duration <= 5000:
                    raise ValueError('Invalid window')
                pcm = audio.readframes(audio.getnframes())
            segments = []
            with contextlib.redirect_stdout(sys.stderr):
                waveform = np.frombuffer(pcm, dtype='<i2').astype(np.float32) / 32768
                regions = vad(waveform)
                if not regions or regions == [[]]:
                    intervals = []
                elif isinstance(regions, list) and len(regions) == 1:
                    intervals = timing.validate_timestamps(regions[0], duration, 0)
                else:
                    raise ValueError('Invalid VAD output')
                for begin, end in timing.merge_short_intervals(intervals):
                    output = model(waveform[begin * 16:end * 16])[0]['preds']
                    text = output if isinstance(output, str) else output[0]
                    if text.strip():
                        segments.append({'seq': len(segments), 'startMs': begin, 'endMs': end, 'text': text.strip()})
            print(json.dumps({'id': request_id, 'result': {'durationMs': duration, 'segments': segments}}, ensure_ascii=False), flush=True)
        except Exception:
            print(json.dumps({'id': request_id, 'error': 'Local ASR failed'}), flush=True)


if __name__ == '__main__':
    try:
        main()
    except Exception:
        print('Live ASR startup failed', file=sys.stderr)
        sys.exit(1)
