"""Inventory tracked package inputs and explicit media backups. Missing files fail closed.
Stage newly added package files before running. INVENTORY.json excludes its own hash.
Drive listing and matching hashes are evidence of backup, not a restore test.
"""
import argparse
import datetime
import hashlib
import json
from pathlib import Path
import subprocess
import os

HERE = Path(__file__).resolve().parent
PACKAGE = HERE.parent
DRIVE = 'Alethical Team/Media/Forward Debate 2026-10-15'
# Local path, Drive path relative to folder, purpose. Never infer a backup from a basename.
MEDIA = [
    ('ForwardDebate-sound-fixed.mov', 'ForwardDebate-sound-fixed.mov', 'Sound-fixed editing source; copied original picture stream'),
    ('ForwardDebate-original-audio-stereo.m4a', 'ForwardDebate-original-audio-stereo.m4a', 'Original stereo audio, copied without re-encoding'),
    ('ForwardDebate-original-audio-spatial-4ch.mov', 'ForwardDebate-original-audio-spatial-4ch.mov', 'Original 4-channel APAC audio, copied without re-encoding'),
    ('references/short-01-33cae638.mp4', '01-We-Disagree-We-Can-Still-Grab-a-Beer-v2.mp4', 'Current short 01 reference; Aaron first tag 6 seconds'),
]


def sha(path):
    with path.open('rb') as f: return hashlib.file_digest(f, 'sha256').hexdigest()


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--media', type=Path, default=Path(os.environ.get('ALETHICAL_MEDIA', '~/Movies/Alethical/forward-debate-2026')).expanduser())
    ap.add_argument('--remote', default='alethical-drive')
    args = ap.parse_args()
    root = Path(subprocess.check_output(['git', 'rev-parse', '--show-toplevel'], cwd=HERE, text=True).strip())
    tracked = subprocess.check_output(['git', 'ls-files', '-z', '--', str(PACKAGE)], cwd=root).decode().split('\0')
    files = []
    for rel in sorted(filter(None, tracked)):
        path = root/rel
        if path == HERE/'INVENTORY.json': continue
        files.append({'path': os.path.relpath(path, HERE), 'store': 'repo', 'purpose': 'Saved package input or record',
            'bytes': path.stat().st_size, 'sha256': sha(path), 'restore': 'git clone'})
    remote = json.loads(subprocess.check_output(['rclone', 'lsjson', '-R', '--hash',
        f'{args.remote}:{DRIVE}', '--drive-shared-with-me'], text=True))
    by_path = {r['Path']: r for r in remote if not r['IsDir']}
    for local, remote_path, purpose in MEDIA:
        path = args.media/local
        expected = sha(path)  # Missing required local inputs are errors, not silent omissions.
        obj = by_path.get(remote_path)
        verified = bool(obj and obj['Size'] == path.stat().st_size and obj.get('Hashes', {}).get('sha256') == expected)
        files.append({'path': local, 'store': 'media', 'purpose': purpose, 'bytes': path.stat().st_size,
            'sha256': expected, 'drive_path': remote_path, 'drive_id': obj['ID'] if obj else None,
            'backup_status': 'hash-matched' if verified else 'not-verified',
            'restore': 'restore_media.py downloads the explicit Drive path and verifies SHA-256'})
    archived = by_path.get('01-We-Disagree-We-Can-Still-Grab-a-Beer.mp4')
    archive_hash = '0c6df832e41ae610cfcf46dde703344f8d4cd3f1f1bb54a05297f95f254f2698'
    archive_ok = bool(archived and archived['Size'] == 27018433 and archived.get('Hashes', {}).get('sha256') == archive_hash)
    files.append({'path': 'references/short-01-0c6df832.mp4', 'store': 'archive',
        'purpose': 'Prior 3-second-tag version; user removed old Mac copies, retained on Drive only',
        'bytes': 27018433, 'sha256': archive_hash,
        'drive_path': '01-We-Disagree-We-Can-Still-Grab-a-Beer.mp4', 'drive_id': archived['ID'] if archived else None,
        'backup_status': 'hash-matched' if archive_ok else 'not-verified',
        'restore': 'Historical archive only; default restore does not download it'})
    known = {e['path'] for e in files if e['store'] == 'media'}
    by_hash = {e['sha256']: e for e in files if e['store'] in ('repo', 'media')}
    for path in sorted(args.media.rglob('*')):
        if not path.is_file(): continue
        rel = path.relative_to(args.media).as_posix()
        if rel in known or path.name == '.DS_Store': continue
        entry = by_hash.get(sha(path))
        if entry is None: raise SystemExit(f'Unmapped local media file: {rel}; preserve and inventory it explicitly')
        entry.setdefault('local_copies', []).append(rel)
    drive_known = {e.get('drive_path') for e in files}
    all_by_hash = {e['sha256']: e for e in files}
    for remote_path, obj in sorted(by_path.items()):
        if remote_path in drive_known: continue
        entry = all_by_hash.get(obj.get('Hashes', {}).get('sha256'))
        if entry and obj['Size'] == entry['bytes']:
            entry.setdefault('drive_copies', []).append({'path': remote_path, 'id': obj['ID'], 'backup_status': 'hash-matched'})
    result = {'event': 'The Forward Debate, October 15, 2026',
        'generated': datetime.datetime.now(datetime.timezone.utc).isoformat(timespec='seconds'),
        'media_env': 'ALETHICAL_MEDIA', 'drive_folder': DRIVE, 'drive_account': 'authorized team Drive account',
        'inventory_note': 'Inventory excludes its own hash; Git commit covers it. Local-only generated test outputs are not recovery inputs.',
        'files': files}
    (HERE/'INVENTORY.json').write_text(json.dumps(result, indent=2)+'\n')
    pending = [e['path'] for e in files if e.get('backup_status') == 'not-verified']
    print(f'{len(files)} files recorded; unverified backups: {pending}')
    if pending: raise SystemExit(1)


if __name__ == '__main__': main()
