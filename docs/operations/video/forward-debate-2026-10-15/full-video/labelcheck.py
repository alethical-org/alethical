import json,subprocess,numpy as np,sys,os,argparse
from pathlib import Path
ap=argparse.ArgumentParser()
ap.add_argument("--source",default=os.path.join(os.environ.get("ALETHICAL_MEDIA",os.path.expanduser("~/Movies/Alethical/forward-debate-2026")),"ForwardDebate-sound-fixed.mov"))
ap.add_argument("--out",required=True)
A=ap.parse_args(); O=str(Path(__file__).resolve().parent)
if Path(A.out).exists(): ap.error("output already exists; choose a new path")
Path(A.out).resolve().parent.mkdir(parents=True,exist_ok=True)
e=json.load(open(f"{O}/edit.json")); S=e["trim_start"]; src=A.source
wins=[(0,10)]+[(m,6) for m in e['label_marks'] if m>0]
# region: label boxes plus 60px below (y 345..620), x 470..2240, quarter res
X0,X1,Y0,Y1=500,2100,360,600; W,H=(X1-X0)//4,(Y1-Y0)//4
boxes=[(1,119),(156,274),(281,399)]  # quarter-res x ranges for Angel, Aaron, Trent
rep=[]
for i,(t,d) in enumerate(wins):
    cmd=["ffmpeg","-nostdin","-loglevel","error","-ss",str(S+t),"-t",str(d),"-i",src,"-vf",f"crop={X1-X0}:{Y1-Y0}:{X0}:{Y0},scale={W}:{H},format=gray","-f","rawvideo","-"]
    raw=subprocess.run(cmd,capture_output=True,check=True).stdout
    fr=np.frombuffer(raw,np.uint8).reshape(-1,H,W).astype(np.int16)
    med=np.median(fr,axis=0)
    # lower strip just under the boxes (y 560..620 -> rows 54..68) and inside boxes (rows 0..54)
    worst=[]
    for (a,b) in boxes:
        inside=np.abs(fr[:,0:50,a:b]-med[0:50,a:b]).mean(axis=(1,2))
        worst.append(round(float(inside.max()),1))
    rep.append(dict(win=i+1,start_final=round(t+5,2),secs=d,frames=len(fr),max_change_in_box=worst))
json.dump(rep,open(A.out,"w"),indent=1)
for r in rep: print(r)
