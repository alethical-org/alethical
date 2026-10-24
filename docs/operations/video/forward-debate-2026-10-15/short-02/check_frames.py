from pathlib import Path
import json,subprocess,math
from PIL import Image,ImageDraw
B=Path(__file__).resolve().parent.parent;W=B/'short-02';S=Path('/Users/eug/.codex/visualizations/2026/10/20/01a1598f-7b36-7e61-b635-60cf370b9538/scratch/short02-v2-review');V=Path('/Users/eug/Movies/Alethical/forward-debate-2026/shorts/02-Both-Candidates-Oppose-Flock-Cameras-draft-v2.mp4')
S.mkdir(exist_ok=True)
caps=json.loads((W/'caps.json').read_text());times=[0,0.35,1,1.6,1.8,2,5.8,9.8,49.8,55.8,85.9,86.4,86.7,88,90.3]
for a,b,t in caps:times.extend([a-3061.58+1.8,b-3061.58+1.8])
frames=sorted({max(0,round(t*30)+d) for t in times for d in [-1,0,1] if round(t*30)+d<2712})
sel='+'.join(f'eq(n,{n})' for n in frames)
subprocess.run(['ffmpeg','-nostdin','-loglevel','error','-n','-i',str(V),'-vf',f"select='{sel}',scale=270:480",'-fps_mode','vfr','-q:v','3',str(S/'out-%03d.jpg')],check=True)
fs=sorted(S.glob('out-*.jpg'))
for start in range(0,len(fs),12):
 im=Image.new('RGB',(1080,3*505),'#222');dr=ImageDraw.Draw(im)
 for k,f in enumerate(fs[start:start+12]):
  x=k%4*270;y=k//4*505;im.paste(Image.open(f),(x,y));dr.text((x+4,y+483),f'frame {frames[start+k]} | {frames[start+k]/30:.3f}s',fill='white')
 im.save(S/f'output-sheet-{start//12:02}.jpg')
probe=json.loads(subprocess.check_output(['ffprobe','-v','error','-show_format','-show_streams','-of','json',str(V)]))
bounds=[]
for p in sorted((W/'overlays').glob('cap*.png')):
 im=Image.open(p);bb=im.getchannel('A').getbbox();bounds.append({'name':p.name,'bounds':bb})
report={'probe':probe,'sampled_output_frames':frames,'frame_count_sampled':len(frames),'caption_overlay_bounds':bounds,'caption_bounds_fit':all(b['bounds'][0]>=70 and b['bounds'][2]<=900 and b['bounds'][1]>=1290 and b['bounds'][3]<=1476 for b in bounds),'native_control_checks':'not performed; preparation only'}
(W/'checks.json').write_text(json.dumps(report,indent=2)+'\n');print(len(frames),'frames',len(fs),'images; caption fit',report['caption_bounds_fit'])
subprocess.run(['ffmpeg','-nostdin','-loglevel','error','-n','-ss','3.0','-i',str(V),'-frames:v','1','-q:v','2',str(V.parent/'02-cover-draft-v2.jpg')],check=True)
