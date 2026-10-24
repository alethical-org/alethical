import ast
import importlib.util
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[3]
SPEC = importlib.util.spec_from_file_location(
    "pillow_source_scope_guard", ROOT / "scripts/pillow_source_guard.py"
)
g = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(g)

allow = [
    "bitmap.burn_pixels(data)\n",
    "def convert(dataframe):\n return dataframe.to_arrow()\n",
    "getattr(dataframe, 'from_arrow')(value)\n",
    "import importlib\nimportlib.import_module('alethical.db.'+plugin)\n",
    "import importlib\nimportlib.import_module(f'alethical.db.{plugin}')\n",
    "from importlib import import_module as load\nprefix='alethical.db.'\nload(prefix+plugin)\n",
    "from importlib import import_module as load\nload('.path','os')\n",
    "fixture={'PILLOW_ALIGNMENT':'64'}\n",
    "fixture=dict(PILLOW_ALIGNMENT='64')\nfixture['PILLOW_ALIGNMENT']='32'\n",
    "import os\npresent='PILLOW_ALIGNMENT' in os.environ\n",
    "import subprocess\nsubprocess.run(['test'],env={'SAFE':'x'})\n",
]
hold = [
    "from alethical.pipeline.tv_ad_redaction import burn_pixels as paint\npaint(value)\n",
    "from PIL import Image\nImage.fromarrow(value)\n",
    "from PIL import Image\ngetattr(Image, 'fromarrow')(value)\n",
    "from PIL import Image\nImage.new('RGB',(1,1)).__arrow_c_array__()\n",
    "import importlib\nimportlib.import_module('PIL.'+plugin)\n",
    "import importlib\nimportlib.import_module(f'PIL.{plugin}')\n",
    "import importlib\nimportlib.import_module(runtime_name)\n",
    "import importlib\nimportlib.import_module('.Image','PIL')\n",
    "import importlib\nimportlib.import_module(name='.Image',package='PIL')\n",
    "import importlib\nimportlib.import_module('.pipeline.tv_ad_redaction','alethical')\n",
    "import importlib\nimportlib.import_module('alethical.pipeline.'+plugin)\n",
    "import importlib\nimportlib.__import__('PIL')\n",
    "__import__('Image',globals={'__package__':'PIL'},level=1)\n",
    "import os\nos.environ['PILLOW_ALIGNMENT']='64'\n",
    "import os\ne=os.environ\ne['PILLOW_ALIGNMENT']='64'\n",
    "import os\nfrom operator import setitem\nsetitem(os.environ,'PILLOW_ALIGNMENT','64')\n",
    "import os\nos.environ=dict(PILLOW_ALIGNMENT='64')\n",
    "import os\nos.environ |= {'PILLOW_ALIGNMENT':'64'}\n",
    "import os\ndict_env={'PILLOW_ALIGNMENT':'64'}\nos.environ.update(dict_env)\n",
    "import os\ndict_env={'PILLOW_ALIGNMENT':'64'}\nos.environ.update(**dict_env)\n",
    "import subprocess\ndict_env={'PILLOW_ALIGNMENT':'64'}\nsubprocess.run(['test'],env=dict_env)\n",
    "import subprocess\ndict_env={'PILLOW_ALIGNMENT':'64'}\nsubprocess.run(['test'],env={**dict_env})\n",
    "import os\nos.execve('x',[],{'PILLOW_ALIGNMENT':'64'})\n",
]


@pytest.mark.parametrize("source", allow)
def test_unrelated_code_releases(source):
    assert g.source_errors("alethical/new.py", ast.parse(source)) == []


@pytest.mark.parametrize("source", hold)
def test_new_sensitive_access_is_held(source):
    assert g.source_errors("alethical/new.py", ast.parse(source))
