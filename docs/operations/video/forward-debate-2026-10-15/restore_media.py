"""Restore media into --media using inventory paths, then verify every download.
Existing matching files are kept; existing mismatches stop without overwriting.
"""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess

HERE = Path(__file__).resolve().parent

def matches(path, entry):
    if not path.is_file() or path.stat().st_size != entry['bytes']: return False
    with path.open('rb') as f: return hashlib.file_digest(f, 'sha256').hexdigest() == entry['sha256']

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--media', type=Path, required=True)
    parser.add_argument('--remote', default='alethical-drive')
    args = parser.parse_args()
    inv = json.loads((HERE/'INVENTORY.json').read_text())
    for entry in inv['files']:
        if entry['store'] != 'media': continue
        dest = args.media/entry['path']
        if dest.exists():
            if not matches(dest, entry): raise SystemExit(f'Existing file differs; preserve it and choose an empty restore folder: {dest}')
            print('MATCH existing', entry['path']); continue
        dest.parent.mkdir(parents=True, exist_ok=True)
        source = f"{args.remote}:{inv['drive_folder']}/{entry['drive_path']}"
        subprocess.run(['rclone', 'copyto', source, str(dest), '--drive-shared-with-me', '--immutable'], check=True)
        if not matches(dest, entry): raise SystemExit(f'Download differs from inventory: {dest}')
        print('MATCH restored', entry['path'])

if __name__ == '__main__': main()
