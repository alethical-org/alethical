import subprocess,json
from pathlib import Path
import numpy as np
M=Path('/Users/eug/Movies/Alethical/forward-debate-2026');W=Path(__file__).resolve().parent
def read(p,start,dur):
 return np.frombuffer(subprocess.check_output(['ffmpeg','-nostdin','-loglevel','error','-ss',str(start),'-t',str(dur),'-i',str(p),'-vn','-ar','48000','-ac','2','-f','f32le','-']),dtype=np.float32).reshape(-1,2)
s=read(M/'ForwardDebate-sound-fixed.mov',3100.64,84.6);v=read(M/'shorts/02-Both-Candidates-Oppose-Flock-Cameras-draft-v2.mp4',1.8,84.6)
# Decode comparison establishes preservation/timing, not heard words.
n=min(len(s),len(v));start=48000;end=n-48000;a=s[start:end,0].astype(float);b=v[start:end,0].astype(float)
r=float(np.corrcoef(a,b)[0,1]);ratio=float(np.sqrt(np.mean(b*b))/np.sqrt(np.mean(a*a)))
checks=[]
for label,x,y in [('question',.5,3.0),('Trent',10,40),('Aaron',50,75),('concession',74.94,76.78),('last_words',82.44,83.88)]:
 a=s[int(x*48000):int(y*48000)].astype(float);b=v[int(x*48000):int(y*48000)].astype(float);m=min(len(a),len(b));a=a[:m];b=b[:m];checks.append({'section':label,'body_seconds':[x,y],'correlation':float(np.corrcoef(a.flatten(),b.flatten())[0,1]),'rms_ratio':float(np.sqrt(np.mean(b*b))/np.sqrt(np.mean(a*a)))})
c=read(M/'shorts/02-Both-Candidates-Oppose-Flock-Cameras-draft-v2.mp4',86.4,4)
rpt={'source_frames_stereo':len(s),'output_body_frames_stereo':len(v),'same_length':len(s)==len(v),'zero_offset_correlation_excluding_fades':r,'rms_ratio_excluding_fades':ratio,'sections':checks,'speech_peak_dbfs':float(20*np.log10(np.max(np.abs(v)))),'closing_peak_dbfs':float(20*np.log10(np.max(np.abs(c)))),'closing_rms_dbfs':float(20*np.log10(np.sqrt(np.mean(c*c)))),'speech_rms_dbfs':float(20*np.log10(np.sqrt(np.mean(v*v)))),'listening':'Not performed; no supported listening tool in preparing helper. Measurements do not settle disputed words.','timing':'Final retained word anchor source3184.52; audio fade begins3185.19, 0.67seconds later. Next question source3185.82 is outside clip.'}
(W/'audio-checks.json').write_text(json.dumps(rpt,indent=2)+'\n');print(json.dumps(rpt,indent=2))
