"""Check short01's rendered name glyphs at its measured shot boundaries.
This is a visual regression check, not speech attribution or publication approval.
Usage: python check_name_tags.py VIDEO --out REPORT.json (requires numpy, Pillow).
"""
import argparse
import json
from pathlib import Path
import subprocess
import numpy as np
from PIL import Image

ap = argparse.ArgumentParser(description=__doc__)
ap.add_argument('video', type=Path)
ap.add_argument('--out', type=Path, required=True)
a = ap.parse_args()
if a.out.exists(): ap.error('report exists; choose a new output')
# Name text only, excluding roles and background. Independent measured output
# cuts: Trent starts at 280, Angel at 373, Aaron returns at 424; 54 intro frames.
x, y, width, height = 80, 1040, 800, 68
templates = {}
for who in ('aaron', 'trent', 'angel'):
    im = np.asarray(Image.open(Path(__file__).parent/'overlays'/f'name_{who}.png').convert('RGBA'))[y:y+height,x:x+width]
    templates[who] = (im[:,:,:3].min(axis=2)>210)&(im[:,:,3]>245)
cmd = ['ffmpeg','-nostdin','-v','error','-i',str(a.video),'-map','0:v:0','-vf',f'crop={width}:{height}:{x}:{y}', '-pix_fmt','rgb24','-f','rawvideo','-']
p = subprocess.Popen(cmd, stdout=subprocess.PIPE)
rows=[]
n=0
while True:
    raw=p.stdout.read(width*height*3)
    if not raw: break
    if len(raw)!=width*height*3: raise RuntimeError('partial decoded frame')
    # Initial fade makes exact white-glyph detection inappropriate on frames54-59.
    if 60 <= n <= 425:
        pixels=np.frombuffer(raw,dtype=np.uint8).reshape(height,width,3)
        mask=pixels.min(axis=2)>190
        scores={}
        for k,m in templates.items():
            yy,xx=np.where(m)
            region=np.zeros_like(m); region[yy.min():yy.max()+1,xx.min():xx.max()+1]=True
            scores[k]=float(np.logical_and(mask,m).sum()/max(1,np.logical_and(np.logical_or(mask,m),region).sum()))
        best=max(scores,key=scores.get)
        observed=best if scores[best]>=0.65 else None
        expected='aaron' if n<234 else 'trent' if 280<=n<373 else 'angel' if 373<=n<424 else None
        rows.append({'frame':n,'expected':expected,'observed':observed,'match':observed==expected,'scores':scores})
    n+=1
if p.wait()!=0: raise RuntimeError('video decode failed')
report={'frame_count':n,'checked_range':[60,425],'skipped_initial_fade_frames':[54,59], 'method':'white name-glyph intersection/union inside each name bounding box, threshold0.65; independent output cut bounds','failures':[r for r in rows if not r['match']],'checked_frames':len(rows),'results':rows}
a.out.write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps({k:v for k,v in report.items() if k!='results'},indent=2))
raise SystemExit(bool(report['failures']))
