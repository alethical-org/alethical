"""Report reproduction differences, not editorial approval.
Usage: uvx --with numpy python -I compare_rebuild.py REBUILT REFERENCE --out REPORT.json
"""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess
import tempfile
import numpy as np


def run(args):
    return subprocess.run(args, check=True, capture_output=True).stdout


def digest(path):
    with open(path, 'rb') as f:
        return hashlib.file_digest(f, 'sha256').hexdigest()


def probe(path):
    return json.loads(run(['ffprobe', '-v', 'error', '-show_entries',
        'format=duration,size:stream=index,codec_type,codec_name,width,height,r_frame_rate,avg_frame_rate,nb_frames,sample_rate,channels,channel_layout,time_base,start_pts,start_time,duration_ts,duration,color_space,color_transfer,color_primaries,color_range',
        '-of', 'json', str(path)]))


def timing(path):
    return json.loads(run(['ffprobe', '-v', 'error', '-show_packets', '-show_entries',
        'packet=stream_index,pts,dts,duration', '-of', 'json', str(path)]))['packets']


def audio(path, channels):
    raw = run(['ffmpeg', '-nostdin', '-v', 'error', '-i', str(path), '-map', '0:a:0',
        '-ar', '48000', '-f', 'f32le', '-acodec', 'pcm_f32le', '-'])
    return np.frombuffer(raw, dtype='<f4').reshape(-1, channels).astype(np.float64)


def audio_metrics(a, b):
    # Seek +/-50 ms on the same 15-second speech interval; report, never hide the shift.
    exact = bool(a.shape == b.shape and np.array_equal(a, b))
    window_a, window_b = a[240000:960000], b[240000:960000]
    energy_a = np.sum(window_a**2, axis=0)
    energy_b = np.sum(window_b**2, axis=0)
    channel = int(np.argmax(np.minimum(energy_a, energy_b)))
    offset = 0
    alignment = 'exact PCM; no shift'
    if not exact:
        if not len(window_a) or not len(window_b) or min(energy_a[channel], energy_b[channel]) == 0:
            alignment = 'undetermined: no shared signal in comparison window; differences use zero shift'
        else:
            x, y = window_a[:, channel], window_b[:, channel]
            n = len(x) + len(y) - 1
            size = 1 << (n - 1).bit_length()
            corr = np.fft.irfft(np.fft.rfft(x, size) * np.fft.rfft(y[::-1], size), size)[:n]
            centre = len(y) - 1
            offset = int(np.argmax(corr[centre-2400:centre+2401])) - 2400
            alignment = 'estimated from strongest shared channel in speech window'
    count = min(len(a), len(b))
    raw = a[:count] - b[:count]
    if offset >= 0:
        x, y = a[offset:count], b[:count-offset]
    else:
        x, y = a[:count+offset], b[-offset:count]
    diff = x-y
    return {'sample_frames_rebuilt': len(a), 'sample_frames_reference': len(b),
        'channels': a.shape[1], 'sample_rate': 48000,
        'offset_samples_rebuilt_minus_reference': None if alignment.startswith('undetermined') else offset,
        'alignment': alignment, 'alignment_channel': channel,
        'unaligned_peak_full_scale': float(np.abs(raw).max()),
        'unaligned_rms_full_scale': float(np.sqrt(np.mean(raw**2))),
        'aligned_peak_full_scale_by_channel': np.abs(diff).max(axis=0).tolist(),
        'aligned_rms_full_scale_by_channel': np.sqrt(np.mean(diff**2, axis=0)).tolist(),
        'decoded_pcm_exact': exact}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('rebuilt', type=Path)
    parser.add_argument('reference', type=Path)
    parser.add_argument('--out', type=Path, required=True)
    args = parser.parse_args()
    if args.out.exists(): parser.error('report already exists; choose a new path')
    a, b = args.rebuilt.resolve(), args.reference.resolve()
    pa, pb = probe(a), probe(b)
    va = next(s for s in pa['streams'] if s['codec_type'] == 'video')
    vb = next(s for s in pb['streams'] if s['codec_type'] == 'video')
    aa = next(s for s in pa['streams'] if s['codec_type'] == 'audio')
    ab = next(s for s in pb['streams'] if s['codec_type'] == 'audio')
    report = {'sha256_rebuilt': digest(a), 'sha256_reference': digest(b),
        'rebuilt': pa, 'reference': pb,
        'duration_exact': pa['format']['duration'] == pb['format']['duration'],
        'streams_exact': pa['streams'] == pb['streams'],
        'packet_timing_exact': timing(a) == timing(b),
        'meaning_or_listening_certified': False}
    if any(va.get(k) != vb.get(k) for k in ('width', 'height', 'nb_frames', 'r_frame_rate')):
        report['image_comparison'] = 'not run: dimensions, frame count or frame rate differ'
    else:
        with tempfile.TemporaryDirectory(prefix='alethical-compare-') as tmp:
            subprocess.run(['ffmpeg', '-nostdin', '-v', 'error', '-i', str(a), '-i', str(b),
                '-filter_complex', '[0:v:0][1:v:0]psnr=stats_file=psnr.log', '-an', '-f', 'null', '-'],
                cwd=tmp, check=True, capture_output=True)
            frames = []
            for line in Path(tmp, 'psnr.log').read_text().splitlines():
                row = dict(word.split(':', 1) for word in line.split())
                frames.append({k: (None if v == 'inf' else float(v)) for k, v in row.items()})
            finite = [r['psnr_avg'] for r in frames if r['psnr_avg'] is not None]
            report['image_comparison'] = {'compared_frames': len(frames),
                'minimum_psnr_db_all_planes': min(finite) if finite else None,
                'mean_finite_frame_psnr_db_all_planes': float(np.mean(finite)) if finite else None,
                'infinite_psnr_frames': len(frames)-len(finite),
                'note': 'null PSNR means identical pixels; no threshold proves editorial correctness',
                'per_frame': frames}
    if aa['channels'] == ab['channels']:
        report['audio_comparison'] = audio_metrics(audio(a, aa['channels']), audio(b, ab['channels']))
    else: report['audio_comparison'] = 'not run: channel counts differ'
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(report, indent=2, allow_nan=False)+'\n')
    print(args.out)
    print(json.dumps({k:v for k,v in report.items() if k not in ('rebuilt','reference','image_comparison')}, indent=2))
    image = report['image_comparison']
    print({k:v for k,v in image.items() if k != 'per_frame'} if isinstance(image, dict) else image)


if __name__ == '__main__': main()
