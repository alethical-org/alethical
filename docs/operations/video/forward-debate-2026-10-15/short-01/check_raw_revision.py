"""Compare v2 and current raw filter output without writing media. Requires ffmpeg."""
import runpy,sys,subprocess,json,argparse,tempfile
from pathlib import Path
from unittest.mock import patch
ap=argparse.ArgumentParser(description=__doc__)
ap.add_argument('--source',required=True)
ap.add_argument('--out',type=Path,required=True)
a=ap.parse_args()
if a.out.exists(): ap.error('report exists; choose a new output')
root=Path(__file__).resolve().parent.parent
scratch=tempfile.TemporaryDirectory()
reports={}
for version,script in [('v2','render-v2.py'),('v3','render.py')]:
 commands=[]
 with patch('sys.argv',[script,'--source',a.source,'--out',str(Path(scratch.name)/f'unused-{version}.mp4')]),patch('subprocess.run',lambda cmd,**kwargs:commands.append(cmd)):
  runpy.run_path(str(root/'short-01'/script),run_name='__main__')
 cmd=commands[0];cmd=cmd[:cmd.index('-c:v')]+['-c:v','rawvideo','-c:a','pcm_s16le','-f','framemd5','-']
 out=subprocess.run(cmd,capture_output=True,check=True).stdout.decode()
 lines=[s for s in out.splitlines() if not s.startswith('#')]
 reports[version]=lines
changed=[]
assert len(reports['v2'])==len(reports['v3'])
for before,after in zip(reports['v2'],reports['v3']):
 if before!=after:changed.append({'before':before,'after':after})
r={'method':'Compare raw video frame hashes and PCM audio packet hashes from v2 and v3 filter outputs before lossy encoding','changed':changed,'same_total_records':len(reports['v2']),'scripts':['short-01/render-v2.py','short-01/render.py']}
a.out.write_text(json.dumps(r,indent=2)+'\n')
scratch.cleanup()
print(json.dumps(r,indent=2))
