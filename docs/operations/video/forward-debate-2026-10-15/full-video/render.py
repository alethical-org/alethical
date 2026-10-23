"""Render the full Forward Debate YouTube edition (2:03:21.85) from the sound-fixed recording.

Usage: python3 render.py --out <output.mp4> [--source <ForwardDebate-sound-fixed.mov>] [--sample SECONDS]
Defaults: --source $ALETHICAL_MEDIA/ForwardDebate-sound-fixed.mov (ALETHICAL_MEDIA defaults to
~/Movies/Alethical/forward-debate-2026). --sample renders only the first SECONDS of the debate, for checks.
Edit points live in edit.json (recording clock): keep 44.06 s to 7420.88 s, 5 s title card before, 20 s end card
after, name labels for the first 10 s and 6 s at each chapter start. Picture: gentle 1.15x zoom (crop 2306x1297 at
147,195) centered on the 3 people. Sound: the recording's track as is, 20 ms fades at the joins.
Rebuild of this edition is UNTESTED from this saved copy (see ../rebuild.md). Takes about 50 minutes on an M-series Mac.
"""
import json,sys,subprocess,os,argparse
O=os.path.dirname(os.path.abspath(__file__)); e=json.load(open(f"{O}/edit.json"))
MEDIA=os.environ.get("ALETHICAL_MEDIA",os.path.expanduser("~/Movies/Alethical/forward-debate-2026"))
ap=argparse.ArgumentParser(); ap.add_argument("--out",required=True); ap.add_argument("--source",default=os.path.join(MEDIA,"ForwardDebate-sound-fixed.mov")); ap.add_argument("--sample",type=float)
A=ap.parse_args(); out=os.path.abspath(A.out); sample=A.sample
if os.path.exists(out): ap.error("output already exists; choose a new file")
os.makedirs(os.path.dirname(out), exist_ok=True)
S=e['trim_start']; E=S+sample if sample else e['trim_end']; D=round(E-S,3)
marks=[m for m in e['label_marks'] if m>0 and m<D]
en="+".join(["lt(t,10)"]+[f"between(t,{m},{m+6})" for m in marks])
C=f"{O}/cards"; src=A.source
fc=(f"[0:v]fps=60,scale=2652:1492:out_range=tv,format=yuv420p,setsar=1,fade=out:st=4.5:d=0.5[t];"
    f"[1:v]crop=2306:1297:147:195,scale=2652:1492:flags=lanczos:in_range=pc:out_range=tv,fps=60,setsar=1[m0];"
    f"[m0][2:v]overlay=0:0:enable='{en}',fade=in:st=0:d=0.5,fade=out:st={D-0.5}:d=0.5,format=yuv420p[m];"
    f"[3:v]fps=60,scale=2652:1492:out_range=tv,format=yuv420p,setsar=1,fade=in:st=0:d=0.5[e];"
    f"[1:a]aresample=48000,afade=in:d=0.02,afade=out:st={D-0.02}:d=0.02[ma];"
    f"anullsrc=r=48000:cl=stereo,atrim=0:5[ta];anullsrc=r=48000:cl=stereo,atrim=0:20[ea];"
    f"[t][ta][m][ma][e][ea]concat=n=3:v=1:a=1[v][a]")
cmd=["ffmpeg","-nostdin","-loglevel","error","-n",
 "-loop","1","-framerate","60","-t","5","-i",f"{C}/title.png",
 "-ss",str(S),"-to",str(E),"-i",src,"-i",f"{C}/labels-z115.png",
 "-loop","1","-framerate","60","-t","20","-i",f"{C}/end.png",
 "-filter_complex",fc,"-map","[v]","-map","[a]",
 "-c:v","h264_videotoolbox","-b:v","35M","-maxrate","45M","-bufsize","70M","-profile:v","high","-bsf:v","h264_metadata=colour_primaries=1:transfer_characteristics=1:matrix_coefficients=1:video_full_range_flag=0",
 "-color_primaries","bt709","-color_trc","bt709","-colorspace","bt709","-color_range","tv",
 "-c:a","aac","-b:a","320k","-movflags","+faststart",out]
subprocess.run(cmd,check=True); print("DONE",out)
