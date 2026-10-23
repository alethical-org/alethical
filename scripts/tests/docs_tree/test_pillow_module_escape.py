"""A new caller cannot reach Pillow through the reviewed service's globals."""

import ast
import importlib.util
from pathlib import Path
import subprocess

import pytest

ROOT = Path(__file__).resolve().parents[3]
SPEC = importlib.util.spec_from_file_location(
    "pillow_module_escape_guard", ROOT / "scripts/pillow_source_guard.py"
)
guard = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(guard)
SERVICE_IMPORT = "from alethical.api.services import tv_ad_review as svc\n"


@pytest.mark.parametrize(
    "source",
    [
        SERVICE_IMPORT + "svc.tv_ad_redaction.Image.fromarrow(value)\n",
        "from alethical.api.services.tv_ad_review import *\ntv_ad_redaction.Image.fromarrow(value)\n",
        "import alethical.api.services.tv_ad_review\nfrom alethical.api.services import *\ntv_ad_review.tv_ad_redaction.Image.fromarrow(value)\n",
        "from alethical.api.services.tv_ad_review import prepare_copy\nprepare_copy.__globals__['tv_ad_redaction'].Image.fromarrow(value)\n",
        SERVICE_IMPORT
        + "svc.prepare_copy.__globals__['tv_ad_redaction'].Image.fromarrow(value)\n",
        "from alethical.api.services.tv_ad_review import prepare_copy\ngetattr(prepare_copy, '__globals__')['tv_ad_redaction'].Image.fromarrow(value)\n",
        "from alethical.api.services.tv_ad_review import prepare_copy\nprepare_copy.__getattribute__('__globals__')['tv_ad_redaction'].Image.fromarrow(value)\n",
        SERVICE_IMPORT
        + "getattr(svc.prepare_copy, '__getattribute__')('__globals__')['tv_ad_redaction'].Image.fromarrow(value)\n",
        SERVICE_IMPORT
        + "renderer = getattr(svc, 'tv_ad_redaction')\nrenderer.Image.fromarrow(value)\n",
        SERVICE_IMPORT
        + "lookup = getattr\nrenderer = lookup(svc, 'tv_ad_'+'redaction')\nrenderer.Image.fromarrow(value)\n",
        SERVICE_IMPORT
        + "getattr(getattr(svc, 'tv_ad_redaction'), 'Image').fromarrow(value)\n",
        "from alethical.api.services.tv_ad_review import tv_ad_redaction as renderer\nrenderer.Image.fromarrow(value)\n",
        SERVICE_IMPORT
        + "renderer = svc.__dict__['tv_ad_redaction']\nrenderer.Image.fromarrow(value)\n",
        SERVICE_IMPORT
        + "renderer = vars(svc)['tv_ad_redaction']\nrenderer.Image.fromarrow(value)\n",
        SERVICE_IMPORT + "def expose():\n    return svc\n",
        SERVICE_IMPORT + "def expose():\n    return svc.tv_ad_redaction\n",
        SERVICE_IMPORT + "def expose(name):\n    return getattr(svc, name)\n",
        "import importlib\nsvc = importlib.import_module('alethical.api.services.tv_ad_review')\nsvc.tv_ad_redaction.Image.fromarrow(value)\n",
        "import importlib\nsvc = importlib.import_module('.tv_ad_review', 'alethical.api.services')\nsvc.tv_ad_redaction.Image.fromarrow(value)\n",
        "import importlib\nservices = importlib.import_module('.services', 'alethical.api')\nservices.tv_ad_review.tv_ad_redaction.Image.fromarrow(value)\n",
        "import importlib\nsvc = importlib.import_module('alethical.api.services.' + name)\nsvc.tv_ad_redaction.Image.fromarrow(value)\n",
        "import importlib\nsvc = importlib.import_module('alethical.api.' + name)\nsvc.tv_ad_redaction.Image.fromarrow(value)\n",
        "import sys\nsvc = sys.modules['alethical.api.services.tv_ad_review']\nsvc.tv_ad_redaction.Image.fromarrow(value)\n",
    ],
)
def test_new_service_namespace_access_requires_review(source):
    assert guard.source_errors("alethical/api/new_consumer.py", ast.parse(source))


@pytest.mark.parametrize(
    "addition",
    [
        "\ndef added():\n    return tv_ad_redaction\n",
        "\nexported_renderer = tv_ad_redaction\n",
        "\ndef added():\n    return tv_ad_redaction.Image.frombytes('RGB',(1,1),b'abc')\n",
        "\ndef added():\n    return globals()['tv_ad_redaction']\n",
        "\ndef added():\n    return globals().get('tv_ad_redaction')\n",
        "\nimport sys\ndef added():\n    return sys.modules[__name__].tv_ad_redaction\n",
        "\ndef added():\n    return prepare_copy.__globals__['tv_ad_redaction']\n",
        "\ndef added():\n    def prepare_copy():\n        return tv_ad_redaction\n    return prepare_copy()\n",
        "\nclass Added:\n    def prepare_copy(self):\n        return tv_ad_redaction.render_redacted(value,[])\n",
    ],
)
def test_new_unpinned_service_helpers_cannot_export_renderer(addition):
    source = (ROOT / guard.SERVICE).read_text() + addition
    assert guard.source_errors(guard.SERVICE, ast.parse(source))


@pytest.mark.parametrize(
    "source",
    [
        SERVICE_IMPORT + "svc.original_page_count(record)\n",
        SERVICE_IMPORT + "getattr(svc, 'original_page_count')(record)\n",
        SERVICE_IMPORT
        + "monkeypatch.setattr(svc, 'raw_file_store_from_env', lambda: store)\n",
        "from alethical.api.services.tv_ad_review import original_page_count\noriginal_page_count(record)\n",
        "dataframe.to_arrow()\n",
        "getattr(dataframe, 'from_arrow')(value)\n",
        "vars(unrelated_module)\n",
        "import importlib\nmodule = importlib.import_module('alethical.db.' + name)\nmodule.to_arrow(value)\n",
    ],
)
def test_public_service_api_and_unrelated_arrow_stay_allowed(source):
    assert guard.source_errors("alethical/api/ordinary.py", ast.parse(source)) == []


def test_unrelated_service_edit_keeps_existing_pinned_functions():
    source = (
        ROOT / guard.SERVICE
    ).read_text() + "\ndef unrelated_helper():\n    return 42\n"
    assert guard.source_errors(guard.SERVICE, ast.parse(source)) == []


def test_full_source_check_rejects_cross_module_renderer_escape(tmp_path):
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
    service = tmp_path / guard.SERVICE
    service.write_text(
        service.read_text() + "\ndef expose_renderer():\n    return tv_ad_redaction\n"
    )
    consumer = tmp_path / "alethical/api/new_consumer.py"
    consumer.write_text(
        "from alethical.api.services.tv_ad_review import expose_renderer\nexpose_renderer().Image.fromarrow(value)\n"
    )
    subprocess.run(
        ["git", "init", "--quiet", str(tmp_path)], check=True, capture_output=True
    )
    subprocess.run(
        ["git", "-C", str(tmp_path), "add", "--", "."], check=True, capture_output=True
    )
    assert any("module escape" in finding for finding in guard.validate(tmp_path))


def test_current_source_boundary_remains_valid():
    assert guard.validate(ROOT) == []
