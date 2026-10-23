"""Only exact archived media sources are allowed; production use needs review."""

import ast
import hashlib
import importlib.util
from pathlib import Path
import subprocess

import pytest

ROOT = Path(__file__).resolve().parents[3]
SPEC = importlib.util.spec_from_file_location(
    "pillow_offline_guard", ROOT / "scripts/pillow_source_guard.py"
)
guard = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(guard)

# Reviewed source bytes are inert test fixtures. Never import or execute them.
SOURCES = {
    "docs/operations/video/forward-debate-2026-10-15/short-01/check_name_tags.py": "\"\"\"Check short01's rendered name glyphs at its measured shot boundaries.\nThis is a visual regression check, not speech attribution or publication approval.\nUsage: python check_name_tags.py VIDEO --out REPORT.json (requires numpy, Pillow).\n\"\"\"\nimport argparse\nimport json\nfrom pathlib import Path\nimport subprocess\nimport numpy as np\nfrom PIL import Image\n\nap = argparse.ArgumentParser(description=__doc__)\nap.add_argument('video', type=Path)\nap.add_argument('--out', type=Path, required=True)\na = ap.parse_args()\nif a.out.exists(): ap.error('report exists; choose a new output')\n# Name text only, excluding roles and background. Independent measured output\n# cuts: Trent starts at 280, Angel at 373, Aaron returns at 424; 54 intro frames.\nx, y, width, height = 80, 1040, 800, 68\ntemplates = {}\nfor who in ('aaron', 'trent', 'angel'):\n    im = np.asarray(Image.open(Path(__file__).parent/'overlays'/f'name_{who}.png').convert('RGBA'))[y:y+height,x:x+width]\n    templates[who] = (im[:,:,:3].min(axis=2)>210)&(im[:,:,3]>245)\ncmd = ['ffmpeg','-nostdin','-v','error','-i',str(a.video),'-map','0:v:0','-vf',f'crop={width}:{height}:{x}:{y}', '-pix_fmt','rgb24','-f','rawvideo','-']\np = subprocess.Popen(cmd, stdout=subprocess.PIPE)\nrows=[]\nn=0\nwhile True:\n    raw=p.stdout.read(width*height*3)\n    if not raw: break\n    if len(raw)!=width*height*3: raise RuntimeError('partial decoded frame')\n    # Initial fade makes exact white-glyph detection inappropriate on frames54-59.\n    if 60 <= n <= 425:\n        pixels=np.frombuffer(raw,dtype=np.uint8).reshape(height,width,3)\n        mask=pixels.min(axis=2)>190\n        scores={}\n        for k,m in templates.items():\n            yy,xx=np.where(m)\n            region=np.zeros_like(m); region[yy.min():yy.max()+1,xx.min():xx.max()+1]=True\n            scores[k]=float(np.logical_and(mask,m).sum()/max(1,np.logical_and(np.logical_or(mask,m),region).sum()))\n        best=max(scores,key=scores.get)\n        observed=best if scores[best]>=0.65 else None\n        expected='aaron' if n<234 else 'trent' if 280<=n<373 else 'angel' if 373<=n<424 else None\n        rows.append({'frame':n,'expected':expected,'observed':observed,'match':observed==expected,'scores':scores})\n    n+=1\nif p.wait()!=0: raise RuntimeError('video decode failed')\nreport={'frame_count':n,'checked_range':[60,425],'skipped_initial_fade_frames':[54,59], 'method':'white name-glyph intersection/union inside each name bounding box, threshold0.65; independent output cut bounds','failures':[r for r in rows if not r['match']],'checked_frames':len(rows),'results':rows}\na.out.write_text(json.dumps(report,indent=2)+'\\n')\nprint(json.dumps({k:v for k,v in report.items() if k!='results'},indent=2))\nraise SystemExit(bool(report['failures']))\n",
    "docs/operations/video/forward-debate-2026-10-15/short-01/intro_frames.py": '"""Draw the 54 intro frames (1.8 s at 30 fps): the Alethical symbol growing from 496 to 570 px wide on #0a0a0a.\nRun: uvx --with pillow python -I intro_frames.py   (writes intro-frames/f000.png ... f053.png next to this file)\nEach frame is drawn 8x larger and shrunk with Lanczos so the growth is smooth; whole-pixel scaling shook."""\nimport sys\nfrom PIL import Image\nimport os; W=os.path.dirname(os.path.abspath(__file__)); os.makedirs(f"{W}/intro-frames",exist_ok=True)\nsym=Image.open(f"{W}/assets/alethical-symbol-transparent.png").convert("RGBA"); sw,sh=sym.size\nFPS=30; DUR=1.8; N=int(FPS*DUR); SS=8; BOX=800            # 800x800 output box around the logo, drawn 4x\nbx,by=540-BOX//2,900-BOX//2\nfor k in range(N):\n    t=k/FPS; w=496+74*(t/DUR); s=w*SS/sw\n    a=1/s; c=sw/2-(BOX*SS/2)*a                              # map 4x box pixels to source pixels, centered\n    big=sym.transform((BOX*SS,BOX*SS),Image.AFFINE,(a,0,c,0,a,sh/2-(BOX*SS/2)*a),resample=Image.BICUBIC,fillcolor=(0,0,0,0))\n    small=big.resize((BOX,BOX),Image.LANCZOS)               # smooth shrink, no skipped pixels\n    alpha=min(1,t/0.35); fo=min(1,(DUR-t)/0.2); g=alpha*fo\n    if g<1:\n        r,gg,b,al=small.split(); small=Image.merge("RGBA",(r,gg,b,al.point(lambda v:int(v*g))))\n    frame=Image.new("RGBA",(1080,1920),(10,10,10,255)); frame.alpha_composite(small,(bx,by))\n    frame.convert("RGB").save(f"{W}/intro-frames/f{k:03d}.png")\nprint(N,"frames")\n',
    "docs/operations/video/forward-debate-2026-10-15/short-02/check_frames.py": "from pathlib import Path\nimport json,subprocess,math\nfrom PIL import Image,ImageDraw\nB=Path(__file__).resolve().parent.parent;W=B/'short-02';S=Path('/Users/eug/.codex/visualizations/2026/10/20/01a1598f-7b36-7e61-b635-60cf370b9538/scratch/short02-v2-review');V=Path('/Users/eug/Movies/Alethical/forward-debate-2026/shorts/02-Both-Candidates-Oppose-Flock-Cameras-draft-v2.mp4')\nS.mkdir(exist_ok=True)\ncaps=json.loads((W/'caps.json').read_text());times=[0,0.35,1,1.6,1.8,2,5.8,9.8,49.8,55.8,85.9,86.4,86.7,88,90.3]\nfor a,b,t in caps:times.extend([a-3061.58+1.8,b-3061.58+1.8])\nframes=sorted({max(0,round(t*30)+d) for t in times for d in [-1,0,1] if round(t*30)+d<2712})\nsel='+'.join(f'eq(n,{n})' for n in frames)\nsubprocess.run(['ffmpeg','-nostdin','-loglevel','error','-n','-i',str(V),'-vf',f\"select='{sel}',scale=270:480\",'-fps_mode','vfr','-q:v','3',str(S/'out-%03d.jpg')],check=True)\nfs=sorted(S.glob('out-*.jpg'))\nfor start in range(0,len(fs),12):\n im=Image.new('RGB',(1080,3*505),'#222');dr=ImageDraw.Draw(im)\n for k,f in enumerate(fs[start:start+12]):\n  x=k%4*270;y=k//4*505;im.paste(Image.open(f),(x,y));dr.text((x+4,y+483),f'frame {frames[start+k]} | {frames[start+k]/30:.3f}s',fill='white')\n im.save(S/f'output-sheet-{start//12:02}.jpg')\nprobe=json.loads(subprocess.check_output(['ffprobe','-v','error','-show_format','-show_streams','-of','json',str(V)]))\nbounds=[]\nfor p in sorted((W/'overlays').glob('cap*.png')):\n im=Image.open(p);bb=im.getchannel('A').getbbox();bounds.append({'name':p.name,'bounds':bb})\nreport={'probe':probe,'sampled_output_frames':frames,'frame_count_sampled':len(frames),'caption_overlay_bounds':bounds,'caption_bounds_fit':all(b['bounds'][0]>=70 and b['bounds'][2]<=900 and b['bounds'][1]>=1290 and b['bounds'][3]<=1476 for b in bounds),'native_control_checks':'not performed; preparation only'}\n(W/'checks.json').write_text(json.dumps(report,indent=2)+'\\n');print(len(frames),'frames',len(fs),'images; caption fit',report['caption_bounds_fit'])\nsubprocess.run(['ffmpeg','-nostdin','-loglevel','error','-n','-ss','3.0','-i',str(V),'-frames:v','1','-q:v','2',str(V.parent/'02-cover-draft-v2.jpg')],check=True)\n",
}


@pytest.fixture
def boundary(tmp_path):
    for relative in (
        "uv.lock",
        "pyproject.toml",
        guard.RENDERER,
        guard.PIL_TEST,
        guard.SERVICE,
    ):
        target = tmp_path / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes((ROOT / relative).read_bytes())
    subprocess.run(
        ["git", "init", "--quiet", str(tmp_path)], check=True, capture_output=True
    )
    subprocess.run(
        ["git", "-C", str(tmp_path), "add", "--", "."], check=True, capture_output=True
    )
    return tmp_path


def add_source(root, path, source):
    target = root / path
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(source)
    subprocess.run(
        ["git", "-C", str(root), "add", "--", path], check=True, capture_output=True
    )


def test_exact_reviewed_offline_source_registry():
    assert set(SOURCES) == set(guard.OFFLINE_TOOLS)
    for path, source in SOURCES.items():
        assert (
            hashlib.sha256(source.encode()).hexdigest() == guard.OFFLINE_TOOLS[path][0]
        )
        assert guard.source_errors(path, ast.parse(source)) == []


def test_absent_offline_sources_do_not_change_production_boundary(boundary):
    assert guard.validate(boundary) == []
    assert set(guard.PINNED_FILES) == {guard.RENDERER, guard.PIL_TEST}


@pytest.mark.parametrize("path", list(SOURCES))
def test_exact_single_offline_source_is_optional(boundary, path):
    add_source(boundary, path, SOURCES[path])
    assert guard.validate(boundary) == []


def test_all_exact_offline_sources_pass(boundary):
    for path, source in SOURCES.items():
        add_source(boundary, path, source)
    assert guard.validate(boundary) == []


@pytest.mark.parametrize(
    "change",
    [
        "\n# new comment\n",
        "\nfrom PIL import ImageFont\n",
        "\nImage.fromarrow(data)\n",
        "\nimport os\nos.environ['PILLOW_ALIGNMENT']='64'\n",
    ],
)
def test_any_offline_source_drift_fails(boundary, change):
    path = next(iter(SOURCES))
    add_source(boundary, path, SOURCES[path] + change)
    assert any(
        "offline Pillow tool fingerprint changed" in error
        for error in guard.validate(boundary)
    )


def test_fourth_docs_pillow_source_is_not_exempt(boundary):
    fixture_path = Path("docs") / "operations" / "video" / "new-tool.py"
    add_source(boundary, fixture_path, "from PIL import Image\n")
    assert any("import boundary changed" in error for error in guard.validate(boundary))


@pytest.mark.parametrize(
    "source",
    [
        "import intro_frames\n",
        "from check_name_tags import templates\n",
        "import importlib\nimportlib.import_module('docs.operations.video.forward-debate-2026-10-15.short-01.intro_frames')\n",
        "import importlib\nimportlib.import_module('docs.operations.video.' + suffix)\n",
        "from runpy import run_module\nrun_module('intro_frames')\n",
        "from runpy import run_path as load\nload('docs/operations/video/forward-debate-2026-10-15/short-01/intro_frames.py')\n",
        "from pathlib import Path\nimport runpy\ntarget=Path('docs')/'intro_frames.py'\nrunpy.run_path(target)\n",
        "import runpy\nrunpy.run_path(path_name='intro_frames.py')\n",
        "import importlib.util\nimportlib.util.spec_from_file_location('media','check_frames.py')\n",
        "from importlib.util import spec_from_file_location as spec\nspec('media',location='check_frames.py')\n",
        "from importlib.machinery import SourceFileLoader\nSourceFileLoader('media','check_name_tags.py')\n",
        "exec(open('intro_frames.py').read())\n",
        "compile(open('intro_frames.py').read(),'tool','exec')\n",
        "import subprocess,sys\nsubprocess.run([sys.executable,'intro_frames.py'])\n",
        "import subprocess\ncmd=['uv','run','python','intro_frames.py']\nsubprocess.run(cmd)\n",
        "import subprocess\nsubprocess.Popen(['sh','-c','python intro_frames.py --flag'])\n",
        "import subprocess\nsubprocess.run(args=['python3','check_frames.py'])\n",
        "import os\nos.execv('/usr/bin/python3',['python3','intro_frames.py'])\n",
        "import os\nos.system('python intro_frames.py')\n",
    ],
)
def test_new_production_execution_of_offline_tools_fails(source):
    assert guard.source_errors("alethical/api/new_tool.py", ast.parse(source))


@pytest.mark.parametrize(
    "source",
    [
        "note='docs/operations/video/forward-debate-2026-10-15/short-01/intro_frames.py'\n",
        "import subprocess\nfrom pathlib import Path\nfixture_path=Path('docs')/'intro_frames.py'\nsubprocess.run(['git','show','branch:'+str(fixture_path)])\n",
        "import runpy\nrunpy.run_path('unrelated.py')\n",
        "import importlib.util\nimportlib.util.spec_from_file_location('unrelated','unrelated.py')\n",
        "import subprocess\nsubprocess.run(['python','unrelated.py'])\n",
        "import importlib\nimportlib.import_module('docs.other.'+name)\n",
    ],
)
def test_unrelated_loads_and_inert_source_references_stay_allowed(source):
    assert guard.source_errors("alethical/api/unrelated.py", ast.parse(source)) == []
