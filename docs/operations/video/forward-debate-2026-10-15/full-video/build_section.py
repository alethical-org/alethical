"""Build the full-video captions (SRT), readable transcript (Markdown) and speaker-turn list (JSON) from the
2 retained word-timed transcripts plus the other session's ForwardDebate.srt, reconciled 2-of-3 with [unclear] marks.
Run: python3 -I build_section.py full_cfg.json   (writes into out/ next to the config; never re-transcribes)
"""
import json,re,sys,difflib,os
O=None; cfg=json.load(open(sys.argv[1]))
HERE=os.path.dirname(os.path.abspath(sys.argv[1]))
def P(p): return p if os.path.isabs(p) else os.path.join(HERE,p)
os.makedirs(os.path.join(HERE,'out'),exist_ok=True)
A,B=cfg['start'],cfg['end']; OFF=cfg['offset']; TURNS=cfg['turns']; L3=cfg['large']; L3OFF=cfg['large_offset']
FILL={"uh","um","uhm","er","ah","mm","hmm"}
def norm(w): return re.sub(r"[^a-z0-9$%']","",w.lower().replace("’","'"))
d=json.load(open(P(cfg.get("turbo","transcripts/whisper-large-v3-turbo-words.json"))))
mine=[dict(s=w['start'],e=w['end'],w=w['word'].strip()) for s in d['segments'] for w in s.get('words',[]) if A<=w['start']<B]
l=json.load(open(P(L3)))
big=[dict(s=w['start']+L3OFF,e=w['end']+L3OFF,w=w['word'].strip()) for s in l['segments'] for w in s.get('words',[]) if A<=w['start']+L3OFF<B]
oth=[]
for b in open(P(cfg.get("other_srt","../text/ForwardDebate.srt")),encoding='utf-8').read().strip().split("\n\n"):
    ln=b.split("\n")
    if len(ln)<3: continue
    t=[int(h)*3600+int(m)*60+int(s)+int(ms)/1000 for h,m,s,ms in re.findall(r"(\d+):(\d+):(\d+),(\d+)",ln[1])]
    ws=" ".join(ln[2:]).split()
    for k,w in enumerate(ws):
        st=t[0]+(t[1]-t[0])*k/max(1,len(ws))
        if A<=st<B: oth.append(dict(s=st,e=st,w=w))
for L in (mine,big,oth):
    for x in L: x['n']=norm(x['w'])
    L[:]=[x for x in L if x['n'] and x['n'] not in FILL]
def spk_at(t):
    cur=TURNS[0][1]
    for ts,sp in TURNS:
        if t>=ts: cur=sp
    return cur
def turn_idx(t): return sum(1 for ts,_ in TURNS if t>=ts)
def collapse(ws):
    o=[]
    for w in ws:
        if not o or o[-1]!=w: o.append(w)
    return " ".join(o)
def agree(a,b): return difflib.SequenceMatcher(None,a,b).ratio()>=0.85 if (a or b) else True
smo=difflib.SequenceMatcher(None,[x['n'] for x in mine],[x['n'] for x in oth],autojunk=False)
smb=difflib.SequenceMatcher(None,[x['n'] for x in mine],[x['n'] for x in big],autojunk=False)
def eqmap(sm):
    d={}
    for tag,a1,a2,b1,b2 in sm.get_opcodes():
        if tag=='equal':
            for k in range(a2-a1): d[a1+k]=b1+k
    return d
mo=eqmap(smo); mb=eqmap(smb)
anch=sorted(set(mo)&set(mb))
# keep anchors monotonic in both
A2=[];lo=lb=-1
for a in anch:
    if mo[a]>lo and mb[a]>lb: A2.append(a); lo=mo[a]; lb=mb[a]
anch=A2
PREV=NEXT=None
out=[]; unclear=[]; named=[]
def resolve(mw,ow,bw):
    ms,os_,bs=[collapse([x['n'] for x in g]) for g in (mw,ow,bw)]
    if not (ms or os_ or bs): return
    def trim(t):
        w=t.split()
        while w and NEXT and w[-1]==NEXT: w=w[:-1]
        while w and PREV and w[0]==PREV: w=w[1:]
        return " ".join(w)
    ms,os_,bs=trim(ms),trim(os_),trim(bs)
    if not (ms or os_ or bs): return
    if agree(ms,os_) or agree(ms,bs): out.extend(mw); return
    if not os_ and not bs and len(ms.split())>=3:
        out.append(dict(s=mw[0]['s'],e=mw[-1]['e'],w='[unclear]',n='[unclear]')); unclear.append(dict(t=round(mw[0]['s'],2),mine=ms,other='',large='',note='heard by 1 of 3')); return
    if agree(os_,bs):
        if mw: t0,t1=mw[0]['s'],mw[-1]['e']
        else: t0=bw[0]['s'] if bw else ow[0]['s']; t1=bw[-1]['e'] if bw else t0+0.3*len(ow)
        n=max(1,len(ow))
        for k,x in enumerate(ow): out.append(dict(s=t0+(t1-t0)*k/n,e=t0+(t1-t0)*(k+1)/n,w=x['w'],n=x['n']))
        return
    KN=set(cfg.get('known_names',[]))
    for g,gs in ((ow,os_),(mw,ms),(bw,bs)):
        if g and mw and KN & set(gs.split()) and len(gs.split())<=len(ms.split())+1:
            t0=(mw or bw or ow)[0]['s']; t1=(mw or bw or ow)[-1]['e']; n=len(g)
            keep=set(gs.split()); g=[x for x in g if x['n'] in keep] or g; n=len(g)
            for k,x in enumerate(g): out.append(dict(s=t0+(t1-t0)*k/n,e=t0+(t1-t0)*(k+1)/n,w=x['w'],n=x['n']))
            named.append(dict(t=round(t0,2),used=" ".join(x['w'] for x in g),mine=ms,other=os_,large=bs)); return
    if not ow and not bw and len(mw)<3: return
    ref=mw or bw or ow
    t0,t1=ref[0]['s'],ref[-1]['e']
    # keep words other and large share, mark the rest
    if ow and bw:
        sm=difflib.SequenceMatcher(None,[x['n'] for x in ow],[x['n'] for x in bw],autojunk=False)
        pieces=[]
        for tag,a1,a2,b1,b2 in sm.get_opcodes():
            if tag=='equal': pieces+= [x['w'] for x in ow[a1:a2]]
            elif not pieces or pieces[-1]!="[unclear]": pieces.append("[unclear]")
        if any(w!="[unclear]" for w in pieces):
            n=len(pieces)
            for k,w in enumerate(pieces): out.append(dict(s=t0+(t1-t0)*k/n,e=t0+(t1-t0)*(k+1)/n,w=w,n=norm(w) or w))
            unclear.append(dict(t=round(t0,2),mine=ms,other=os_,large=bs,partial=" ".join(pieces)))
            return
    out.append(dict(s=t0,e=t1,w="[unclear]",n="[unclear]"))
    unclear.append(dict(t=round(t0,2),mine=ms,other=os_,large=bs))
def split_turn(ws):
    g={}
    for x in ws: g.setdefault(turn_idx(x['s']),[]).append(x)
    return g
pm=po=pb=-1
for a in anch+[None]:
    am=a if a is not None else len(mine); ao=mo[a] if a is not None else len(oth); ab=mb[a] if a is not None else len(big)
    mw,ow,bw=mine[pm+1:am],oth[po+1:ao],big[pb+1:ab]
    PREV=mine[pm]['n'] if pm>=0 else None; NEXT=mine[am]['n'] if am<len(mine) else None
    gm,go,gb=split_turn(mw),split_turn(ow),split_turn(bw)
    keys=sorted(set(gm)|set(go)|set(gb))
    if len(keys)<=1: resolve(mw,ow,bw)
    else:
        for k in keys: resolve(gm.get(k,[]),go.get(k,[]),gb.get(k,[]))
    if a is not None: out.append(mine[a]); pm,po,pb=a,ao,ab
# merge adjacent [unclear]
m2=[]
for x in out:
    if m2 and x['w']=="[unclear]" and m2[-1]['w']=="[unclear]": m2[-1]['e']=x['e']; continue
    m2.append(x)
out=[x for x in m2 if cfg['emit_from']<=x['s']]
for a,b in cfg.get('force_unclear',[]):
    ins=[x for x in out if a<=x['s']<b]
    if ins:
        i=out.index(ins[0]); out=[x for x in out if not (a<=x['s']<b)]
        out.insert(i,dict(s=ins[0]['s'],e=ins[-1]['e'],w="[unclear]",n="[unclear]"))
        unclear.append(dict(t=round(ins[0]['s'],2),forced=True,mine=" ".join(x['w'] for x in ins)))
for src,dst in cfg.get('phrase_fixes',[]):
    sw=[norm(w) for w in src.split()]; i=0
    while i<=len(out)-len(sw):
        if [out[i+k]['n'] for k in range(len(sw))]==sw:
            tail=out[i+len(sw)-1]['w']; punct=tail[len(tail.rstrip('.,?!')):]
            dw=dst.split(); t0,t1=out[i]['s'],out[i+len(sw)-1]['e']; n=len(dw)
            new=[dict(s=t0+(t1-t0)*k/n,e=t0+(t1-t0)*(k+1)/n,w=w,n=norm(w)) for k,w in enumerate(dw)]
            new[-1]['w']+=punct
            out[i:i+len(sw)]=new; i+=n
        else: i+=1
j=[]
for x in out:
    if j and x['w'].startswith('-') and len(x['w'])>1 and not j[-1]['w'].endswith(('.','?','!',',')): j[-1]=dict(j[-1],w=j[-1]['w']+x['w'],e=x['e'])
    else: j.append(x)
out=j
for i in range(1,len(out)):
    if out[i-1]['w'].endswith(('.','?','!')) and out[i]['w'][:1].islower(): out[i]['w']=out[i]['w'][0].upper()+out[i]['w'][1:]
LOW={"When","And","But","So","The","It","That","We","You","They","If","Then","Or","Because"}
for i in range(1,len(out)):
    if out[i-1]['w'].endswith(',') and out[i]['w'].strip('.,?!') in LOW: out[i]['w']=out[i]['w'][0].lower()+out[i]['w'][1:]
# apply fixes
FIX=cfg.get('fixes',{})
for x in out:
    for a,b in FIX.items():
        if x['w'].strip(".,?!").lower()==a.lower(): x['w']=x['w'].replace(x['w'].strip(".,?!"),b)
# ---- captions
def fmt(t):
    t=max(0,t);h=int(t//3600);m=int(t%3600//60);s=t%60
    return f"{h:02d}:{m:02d}:{int(s):02d},{int(round((s-int(s))*1000))%1000:03d}"
def wrap(text,w=42):
    words=text.split(); 
    if len(text)<=w: return text
    best=None
    for i in range(1,len(words)):
        a=" ".join(words[:i]); b=" ".join(words[i:])
        if len(a)<=w and len(b)<=w:
            sc=abs(len(a)-len(b))
            if best is None or sc<best[0]: best=(sc,a+"\n"+b)
    return best[1] if best else text
def fits(t):
    if len(t)<=42: return True
    w=t.split()
    return any(len(" ".join(w[:i]))<=42 and len(" ".join(w[i:]))<=42 for i in range(1,len(w)))
cues=[]; cur=[]; cur_spk=None
def flush():
    global cur
    if not cur: return
    cues.append(dict(s=cur[0]['s'],e=cur[-1]['e'],spk=cur_spk,label=cur_label,words=[x['w'] for x in cur])); cur=[]
cur_label=False
for i,x in enumerate(out):
    sp=spk_at(x['s'])
    newturn = sp!=cur_spk
    if newturn: flush(); cur_spk=sp; cur_label=True
    text=(" ".join([y['w'] for y in cur]+[x['w']]))
    lab=f">> {sp}: " if cur_label else ""
    gap = cur and x['s']-cur[-1]['e']>0.7
    if cur and ((not fits(lab+text)) or x['e']-cur[0]['s']>6.8 or gap):
        cut=None
        if not gap:
            for j in range(len(cur)-1,0,-1):
                if cur[j-1]['w'].endswith((',','.','?','!')) and j>=len(cur)*0.5: cut=j; break
        if cut:
            tail=cur[cut:]; cur=cur[:cut]; flush(); cur_label=False; cur=tail
        else:
            flush(); cur_label=False
        lab=""
    cur.append(x)
    if x['w'].endswith(('.', '?', '!')) and len(lab+" ".join(y['w'] for y in cur))>40: flush(); cur_label=False
flush()
# merge tiny cues into a neighbour of the same speaker when the result still fits
mc=[]
for c in cues:
    if mc and not c['label'] and mc[-1]['spk']==c['spk'] and (len(mc[-1]['words'])<=2 or len(c['words'])<=2):
        cand=(f">> {mc[-1]['spk']}: " if mc[-1]['label'] else "")+" ".join(mc[-1]['words']+c['words'])
        if fits(cand) and c['e']-mc[-1]['s']<=7.0:
            mc[-1]=dict(mc[-1],e=c['e'],words=mc[-1]['words']+c['words']); continue
    mc.append(c)
cues=mc
srt=[]
for k,c in enumerate(cues):
    s=c['s']-OFF; e=max(c['e']-OFF,s+1.0)
    if k+1<len(cues): e=min(e,cues[k+1]['s']-OFF-0.04)
    e=max(e,s+0.3)
    if k+1<len(cues): e=min(e,cues[k+1]['s']-OFF-0.02)
    txt=(f">> {c['spk']}: " if c['label'] else "")+" ".join(c['words'])
    srt.append(f"{k+1}\n{fmt(s)} --> {fmt(e)}\n{wrap(txt)}\n")
open(P(cfg['srt_out']),"w",encoding='utf-8').write("\n".join(srt))
# ---- transcript md
def mmss(t):
    t=int(t-OFF);h=t//3600;m=t%3600//60;s=t%60
    return f"{h}:{m:02d}:{s:02d}" if h else f"{m}:{s:02d}"
md=([cfg["preamble"],""] if cfg.get("preamble") else [])+[f"## {cfg['heading']}",""]
para=[];spk=None;tstart=None;lastend=None
def endpara(final=False):
    global para
    if para: md.append(" ".join(para)); md.append("")
    para=[]
CH=list(cfg.get('chapters',[])); turns_out=[]
md=([cfg["preamble"],""] if cfg.get("preamble") else [])
for x in out:
    sp=spk_at(x['s'])
    if CH and x['s']>=CH[0][0]-0.01 and (not para or para[-1].endswith(('.','?','!')) or x['s']>=CH[0][0]+20 or sp!=spk):
        endpara(); t,title=CH.pop(0)
        while CH and x['s']>=CH[0][0]-0.01: t,title=CH.pop(0)
        md.append(f"## {title}"); md.append(""); spk=None
    if sp!=spk:
        endpara(); spk=sp; md.append(f"**{sp}** ({mmss(x['s'])})"); md.append("")
        if x['w'][:1].islower(): x['w']=x['w'][0].upper()+x['w'][1:]
        turns_out.append(dict(start_seconds=round(x['s']-OFF,2),start_time=mmss(x['s']),speaker=sp,words=[]))
    elif lastend and x['s']-lastend>1.8 and para and para[-1].endswith(('.','?','!')) and len(" ".join(para))>350:
        endpara()
    para.append(x['w']); lastend=x['e']
    if turns_out: turns_out[-1]['words'].append(x['w'])
endpara()
open(P(cfg['md_out']),"w",encoding='utf-8').write("\n".join(md))
json.dump(unclear,open(P(cfg['unclear_out']),"w"),indent=1)
json.dump(named,open(P(cfg['unclear_out']).replace('.json','_names.json'),'w'),indent=1)
if cfg.get('turns_out'):
    for t in turns_out: t['text']=" ".join(t.pop('words'))
    json.dump(turns_out,open(P(cfg['turns_out']),"w"),indent=1,ensure_ascii=False)
print("cues",len(cues),"unclear",len(unclear))
