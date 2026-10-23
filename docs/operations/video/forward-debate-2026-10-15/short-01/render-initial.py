"""Render short 01, "We disagree. We can still grab a beer." (Forward Debate, October 15, 2026).

Usage:
  python3 render.py --source <ForwardDebate-sound-fixed.mov> --out <output.mp4>
  Defaults: --source $ALETHICAL_MEDIA/ForwardDebate-sound-fixed.mov
--out is required and must name a new file; existing files are never overwritten.
  ALETHICAL_MEDIA defaults to ~/Movies/Alethical/forward-debate-2026.

Every other input (overlays/*.png, intro-frames/*.png, assets/*) is read from this script's own folder.
The overlay PNGs are built from overlays/*.html by make_overlays.sh; the intro frames by intro_frames.py.
Clocks: S0/S1 below are PUBLISHED-video times (the YouTube edition). The source is the sound-fixed
recording, which runs 39.06 s later than the published edition, hence OFF.
"""
import json, subprocess, sys, os, argparse
W = os.path.dirname(os.path.abspath(__file__))
MEDIA = os.environ.get("ALETHICAL_MEDIA", os.path.expanduser("~/Movies/Alethical/forward-debate-2026"))
ap = argparse.ArgumentParser(); ap.add_argument("--source", default=os.path.join(MEDIA, "ForwardDebate-sound-fixed.mov"))
ap.add_argument("--out", required=True); A = ap.parse_args()
A.out = os.path.abspath(A.out)
if os.path.exists(A.out): ap.error("output already exists; choose a new file")
S0, S1 = 6960.65, 6984.65; D = round(S1 - S0, 3); OFF = 39.06; INTRO = 1.8
# (published start, published end, who is on screen, crop x in the 2652-wide source)
segs = [(6960.65, 6968.2, "aaron", 1132), (6968.2, 6971.3, "trent", 1592), (6971.3, 6973.0, "angel", 497), (6973.0, 6984.65, "aaron", 1132)]
caps = json.load(open(f"{W}/caps.json"))
OV = f"{W}/overlays"; AS = f"{W}/assets"
inputs = ["-ss", str(S0 + OFF), "-to", str(S1 + OFF), "-i", A.source]
pngs = ["header"] + [f"name_{k}" for k in ("aaron", "trent", "angel")] + [f"cap{i}" for i in range(len(caps))]
for p in pngs: inputs += ["-i", f"{OV}/{p}.png"]
inputs += ["-loop", "1", "-framerate", "30", "-t", "4.0", "-i", f"{OV}/end_text.png", "-i", f"{AS}/closing-sound-elevenlabs-upbeat-celebratory-1.wav",
           "-loop", "1", "-framerate", "30", "-t", "4.0", "-i", f"{OV}/end_logo.png", "-framerate", "30", "-i", f"{W}/intro-frames/f%03d.png"]
idx = {p: i + 1 for i, p in enumerate(pngs)}; endi = len(pngs) + 1; symi = endi + 3
fc = [f"[0:v]split={len(segs)}" + "".join(f"[s{i}]" for i in range(len(segs)))]
for i, (a, b, k, x) in enumerate(segs):
    fc.append(f"[s{i}]trim={a-S0:.3f}:{b-S0:.3f},setpts=PTS-STARTPTS,crop=506:900:{x}:430,scale=1080:1920:flags=lanczos:in_range=pc:out_range=tv,fps=30,setsar=1[c{i}]")
fc.append("".join(f"[c{i}]" for i in range(len(segs))) + f"concat=n={len(segs)}:v=1:a=0[v0]")
cur = "v0"; n = 0
def ov(src, en):
    global cur, n
    n += 1; fc.append(f"[{cur}][{src}:v]overlay=0:0:enable='{en}'[o{n}]"); cur = f"o{n}"
ov(idx["header"], "gte(t,0)")
seen = set()
for a, b, k, x in segs:                      # a name tag shows once per person, 3 s, or to the cut when the shot is short
    if k in seen: continue
    seen.add(k); end = b if b - a <= 3.6 else a + 3.0
    ov(idx[f"name_{k}"], f"gte(t,{a-S0:.3f})*lt(t,{end-S0:.3f})")
for i, (a, b, t) in enumerate(caps): ov(idx[f"cap{i}"], f"between(t,{a-S0:.3f},{b-S0:.3f})")
fc.append(f"[{cur}]format=yuv420p,fade=in:st=0:d=0.2,fade=out:st={6984.15-S0:.3f}:d=0.5[vm]")
fc.append(f"[{endi+2}:v]fps=30,format=rgba,fade=in:st=0.73:d=0.12:alpha=1[lg];[{endi}:v]fps=30,format=rgba[et];[et][lg]overlay=0:0,format=yuv420p,setsar=1,fade=in:st=0:d=0.3[ve]")
fc.append(f"[0:a]afade=in:d=0.05,afade=out:st={6984.35-S0:.3f}:d=0.3[am];[{endi+1}:a]aresample=48000,volume=-6dB,afade=out:st=3.4:d=0.6[ae]")
fc.append(f"[{symi}:v]format=yuv420p,setsar=1[vi];anullsrc=r=48000:cl=stereo,atrim=0:{INTRO}[ai]")
fc.append("[vi][ai][vm][am][ve][ae]concat=n=3:v=1:a=1[v][a]")
os.makedirs(os.path.dirname(A.out), exist_ok=True)
cmd = ["ffmpeg", "-nostdin", "-loglevel", "error", "-n"] + inputs + ["-filter_complex", ";".join(fc), "-map", "[v]", "-map", "[a]", "-map_metadata", "-1",
       "-c:v", "h264_videotoolbox", "-b:v", "8M", "-profile:v", "high",
       "-bsf:v", "h264_metadata=colour_primaries=1:transfer_characteristics=1:matrix_coefficients=1:video_full_range_flag=0",
       "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", A.out]
subprocess.run(cmd, check=True); print("done", A.out)
