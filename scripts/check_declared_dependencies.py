"""Fail when our own code imports a package that pyproject.toml does not declare.

Why this exists (#701, Jul 2026). `alethical/eval/retrieval_eval.py`,
`scripts/retrieval_eval.py` and `alethical/tests/test_retrieval_eval.py` all
imported numpy, but numpy was never in pyproject.toml. It reached us only because
supabase happened to require it. supabase 2.31.0 dropped that requirement, so an
unrelated version bump (#693) deleted numpy from the lockfile and the test suite
stopped collecting with `ModuleNotFoundError: No module named 'numpy'`.

A sweep at the time found two more of the same shape, psycopg-pool and starlette,
both imported directly and neither declared. Nothing had ever checked, so the
gap was invisible until some other package's requirements changed.

The failure mode is nasty precisely because it is silent: our code keeps working
for as long as the accident holds, our lockfile shows nothing wrong, and the
break lands in whatever unrelated pull request happens to disturb it.

Import name and distribution name are often different (psycopg_pool ships as
psycopg-pool, jwt ships as PyJWT), so this resolves the mapping from the
installed environment via importlib.metadata rather than a hand-written table
that would quietly rot.
"""

from __future__ import annotations

import ast
import pathlib
import sys
import tomllib
from importlib.metadata import packages_distributions

# Directories holding our own code. Anything imported here must be declared.
SOURCE_ROOTS = ("alethical", "scripts")

# Our own top-level package, which is never a declared dependency of itself.
FIRST_PARTY = {"alethical", "scripts"}

REPO_ROOT = pathlib.Path(__file__).resolve().parent.parent


def normalize(name: str) -> str:
    """Normalize a distribution name per PEP 503, so Mako, mako and PyJWT match."""
    return name.lower().replace("_", "-").replace(".", "-")


def declared_distributions() -> set[str]:
    """The direct dependencies named in pyproject.toml, normalized.

    Strips extras and version specifiers, so `psycopg[binary]>=3.2.6` reduces to
    `psycopg`.
    """
    data = tomllib.loads((REPO_ROOT / "pyproject.toml").read_text())
    declared = set()
    for entry in data["project"]["dependencies"]:
        name = entry.split("[")[0]
        for separator in (">=", "<=", "==", "!=", "~=", ">", "<", ";"):
            name = name.split(separator)[0]
        declared.add(normalize(name.strip()))
    return declared


def imported_modules() -> dict[str, set[pathlib.Path]]:
    """Every top-level module imported anywhere under SOURCE_ROOTS."""
    found: dict[str, set[pathlib.Path]] = {}
    for root in SOURCE_ROOTS:
        for path in sorted((REPO_ROOT / root).rglob("*.py")):
            tree = ast.parse(path.read_text(), filename=str(path))
            for node in ast.walk(tree):
                if isinstance(node, ast.Import):
                    names = [alias.name for alias in node.names]
                elif isinstance(node, ast.ImportFrom):
                    # level > 0 is a relative import, always first-party.
                    if node.level or not node.module:
                        continue
                    names = [node.module]
                else:
                    continue
                for name in names:
                    top = name.split(".")[0]
                    found.setdefault(top, set()).add(path.relative_to(REPO_ROOT))
    return found


def main() -> int:
    declared = declared_distributions()
    stdlib = sys.stdlib_module_names
    module_to_dists = packages_distributions()

    undeclared: list[tuple[str, str, set[pathlib.Path]]] = []
    unresolved: list[tuple[str, set[pathlib.Path]]] = []

    for module, files in sorted(imported_modules().items()):
        if module in stdlib or module in FIRST_PARTY or module.startswith("_"):
            continue

        dists = module_to_dists.get(module)
        if not dists:
            # Not installed, so it cannot be mapped to a distribution. Report
            # rather than skip: an import of something absent from the lockfile
            # is exactly the breakage this check exists to catch.
            unresolved.append((module, files))
            continue

        if not any(normalize(dist) in declared for dist in dists):
            undeclared.append((module, sorted(dists)[0], files))

    if not undeclared and not unresolved:
        print(
            f"All third-party imports across {'/, '.join(SOURCE_ROOTS)}/ are "
            f"declared in pyproject.toml ({len(declared)} direct dependencies)."
        )
        return 0

    for module, files in unresolved:
        print(f"::error::`import {module}` is not installed at all.")
        print(f"  imported by: {', '.join(str(f) for f in sorted(files))}")
        print(
            "  Either add it to [project.dependencies] in pyproject.toml and run "
            "`uv lock`, or remove the import."
        )

    for module, dist, files in undeclared:
        print(
            f"::error::`import {module}` relies on `{dist}`, which pyproject.toml "
            "does not declare."
        )
        print(f"  imported by: {', '.join(str(f) for f in sorted(files))}")
        print(
            f'  Fix: add "{dist}>=<installed version>" to [project.dependencies] '
            "in pyproject.toml, then run `uv lock`."
        )

    print(
        f"\n{len(undeclared) + len(unresolved)} undeclared import(s). "
        "Each one works today only because some other dependency happens to "
        "pull it in, and breaks the moment that dependency stops needing it "
        "(#701)."
    )
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
