"""Local, key-free reproduction from pinned public tools and supplied Git history.

Writes only a new supplied scratch folder. Does not modify Alethical or its refs.
"""

import argparse
import io
import json
import os
import pathlib
import shutil
import subprocess
import sys
import tarfile
import time

p = argparse.ArgumentParser(description=__doc__)
p.add_argument("--alethical-root", required=True, type=pathlib.Path)
p.add_argument("--scratch", required=True, type=pathlib.Path)
a = p.parse_args()
source = a.alethical_root.resolve()
scratch = a.scratch.resolve()
bundle = pathlib.Path(__file__).resolve().parent
if scratch == source or source in scratch.parents:
    p.error("Scratch must be outside the Alethical folder")
if scratch.exists() and any(scratch.iterdir()):
    p.error("Use a new or empty scratch folder")
scratch.mkdir(parents=True, exist_ok=True)
output = scratch / "outputs"
output.mkdir()
env = {k: os.environ[k] for k in ("PATH", "TMPDIR", "LANG") if k in os.environ}
env.update(PYTHONNOUSERSITE="1", PIP_CONFIG_FILE=os.devnull)
runs = []


def run(name, args, cwd=scratch):
    start = time.perf_counter()
    r = subprocess.run(
        args, cwd=cwd, env=env, capture_output=True, text=True, timeout=180
    )
    (output / (name + ".stdout")).write_text(r.stdout)
    (output / (name + ".stderr")).write_text(r.stderr)
    # Portable records deliberately omit the command's local absolute paths.
    runs.append(
        {
            "name": name,
            "wall_seconds": time.perf_counter() - start,
            "exit_code": r.returncode,
        }
    )
    (output / "timings.json").write_text(json.dumps(runs, indent=2))
    print(name, r.returncode, round(runs[-1]["wall_seconds"], 3), flush=True)
    return r


venv = scratch / "venv"
if run("create-environment", [sys.executable, "-m", "venv", str(venv)]).returncode:
    sys.exit(1)
python = str(venv / "bin/python")
# Upgrade the installer before it handles the public Git-pinned tool packages.
# The original measured installer belongs only to historical-environment.json.
pip_pin = next(
    line
    for line in (bundle / "requirements.txt").read_text().splitlines()
    if line.startswith("pip==")
)
if run(
    "upgrade-installer",
    [python, "-m", "pip", "install", "--only-binary=:all:", pip_pin],
).returncode:
    sys.exit(1)
if run(
    "install-pinned-tools",
    [python, "-m", "pip", "install", "-r", str(bundle / "requirements.txt")],
).returncode:
    sys.exit(1)
if run("check-installed-tools", [python, "-m", "pip", "check"]).returncode:
    sys.exit(1)
if run("record-installed-tools", [python, "-m", "pip", "freeze", "--all"]).returncode:
    sys.exit(1)
blast = str(venv / "bin/blast-radius")
governance = str(venv / "bin/governance-ast")
for name, revision in [
    ("2477", "63c7a1dfd0729f65d6871eeb70b789cbcd9e879a"),
    ("2368", "2aa30d3fb06377361dd10decf9d3397e8c93a8aa"),
]:
    dest = scratch / name
    dest.mkdir()
    archive = subprocess.check_output(
        [
            "git",
            "archive",
            revision,
            "alethical",
            "apps/frontend/src",
            "apps/frontend/scripts",
            "apps/frontend/tsconfig.json",
            "scripts",
            "docs",
            ".gitignore",
            "pyproject.toml",
        ],
        cwd=source,
        env=env,
    )
    with tarfile.open(fileobj=io.BytesIO(archive)) as tf:
        tf.extractall(dest, filter="data")
    patch = scratch / (name + ".patch")
    patch.write_bytes(
        subprocess.check_output(
            ["git", "diff", revision + "^", revision], cwd=source, env=env
        )
    )
    run(
        "blast-" + name,
        [
            blast,
            "--repo",
            str(dest),
            "--diff",
            str(patch),
            "--no-ai",
            "--format",
            "json",
            "--verbose",
        ],
    )
    sub = dest / ("apps/frontend/src" if name == "2477" else "alethical")
    run("governance-" + name, [governance, "--auto", str(sub), "--format", "json"])
    if name == "2477":
        run(
            "graph-2477",
            [governance, "--graph", str(sub), "--format", "json", "--no-sources"],
        )
for name in ["python-alias", "tsx-jsx", "negative-comment"]:
    dest = scratch / name
    shutil.copytree(bundle / "fixtures" / name, dest)
    run(
        "blast-" + name,
        [
            blast,
            "--repo",
            str(dest),
            "--diff",
            str(bundle / "fixtures" / (name + ".patch")),
            "--no-ai",
            "--format",
            "json",
            "--verbose",
        ],
    )
for name in ["2477", "2368", "python-alias", "tsx-jsx", "negative-comment"]:
    result = json.loads((output / ("blast-" + name + ".stdout")).read_text() or "[]")
    names = sorted({c["function"]["name"] for c in result})
    if names:
        run(
            "rg-symbols-" + name,
            [
                "rg",
                "-n",
                "--glob",
                "*.py",
                "--glob",
                "*.ts",
                "--glob",
                "*.tsx",
                "--glob",
                "*.js",
                "--glob",
                "*.mjs",
                r"\b(" + "|".join(names) + r")\b",
                str(scratch / name),
            ],
        )
for name in ["python", "typescript"]:
    dest = scratch / ("boundary-" + name)
    shutil.copytree(bundle / "fixtures" / ("boundary-" + name), dest)
    config = dest / "governance.toml"
    run(
        "boundary-" + name,
        [governance, "--config", str(config), "--format", "json"],
        dest,
    )
    route = dest / "api" / ("route.py" if name == "python" else "route.tsx")
    route.write_text(
        "def route():\n    return 1\n"
        if name == "python"
        else "export function Route() { return <span>1</span>; }\n"
    )
    run(
        "boundary-negative-" + name,
        [governance, "--config", str(config), "--format", "json"],
        dest,
    )
dest = scratch / "external-name-collision"
shutil.copytree(bundle / "fixtures/boundary-alethical", dest)
# Preserve the supplied package-prefix name that the observed auto-scan used.
renamed = scratch / "alethical"
dest.rename(renamed)
run("external-name-collision", [governance, "--auto", str(renamed), "--format", "json"])
