"""Download pinned official weights into ignored runtime storage, with SHA256 checks."""
import hashlib
import json
import sys
import urllib.request
from pathlib import Path


def download(destination: Path) -> None:
    destination.mkdir(parents=True, exist_ok=True)
    entries = json.loads((Path(__file__).parent / 'models-manifest.json').read_text())
    for entry in entries:
        target = destination / entry['name']
        if target.exists() and target.stat().st_size == entry['size'] and hashlib.sha256(target.read_bytes()).hexdigest() == entry['sha256']:
            print(entry['name'], 'verified')
            continue
        temporary = target.with_suffix(target.suffix + '.part')
        digest = hashlib.sha256()
        size = 0
        try:
            request = urllib.request.Request(entry['url'], headers={'User-Agent': 'taskbook-face-infer'})
            with urllib.request.urlopen(request, timeout=120) as response, temporary.open('wb') as output:
                while True:
                    chunk = response.read(1024 * 1024)
                    if not chunk:
                        break
                    size += len(chunk)
                    if size > entry['size']:
                        raise RuntimeError('model exceeds expected size')
                    digest.update(chunk)
                    output.write(chunk)
            if size != entry['size'] or digest.hexdigest() != entry['sha256']:
                raise RuntimeError('model integrity check failed')
            temporary.replace(target)
            print(entry['name'], 'downloaded and verified')
        finally:
            temporary.unlink(missing_ok=True)


if __name__ == '__main__':
    download(Path(sys.argv[1]))
