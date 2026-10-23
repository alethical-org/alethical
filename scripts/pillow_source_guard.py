"""Read-only drift guard for the reviewed Pillow 13.0.0 exception boundary.

This is not a proof against arbitrary generated, obfuscated, native, or dependency
code. It pins reviewed callers and artifacts and rejects normal Python import,
reflection, Arrow, and alignment drift. Runtime and upstream checks are separate.
"""

from __future__ import annotations

import ast
import hashlib
import json
from pathlib import Path, PurePosixPath
import re
import stat
import subprocess
import tomllib

RENDERER = "alethical/pipeline/tv_ad_redaction.py"
PIL_TEST = "alethical/tests/test_tv_ad_review.py"
SERVICE = "alethical/api/services/tv_ad_review.py"
RENDER_MODULE = "alethical.pipeline.tv_ad_redaction"
PILLOW_ENTRY_SHA256 = "2694a2f9055a37e8285bf6e1af4ff7fb575e01a541ca13be29d2b1a7bac45f59"
PINNED_FILES = {
    RENDERER: "33a2f50db0ddd2bda981a131a8e6d4d2c27e9b0ebfcd04f03d10201b32533e92",
    PIL_TEST: "ef3c6e5e90db7e86289d32ddb82551fe097b681a51d5f315aa643d55e2734f44",
}
# Archived media tools are optional source artifacts, not production callers.
# Their exact bytes and imports are reviewed separately; every other file keeps
# the normal source checks, and loading these tools from code requires review.
OFFLINE_TOOLS = {
    "docs/operations/video/forward-debate-2026-10-15/short-01/check_name_tags.py": (
        "b38dcae1173127c4d77e63aa9a9669abf951d98bfcee00b539eb70b52b2737e6",
        [("Image", "PIL.Image")],
    ),
    "docs/operations/video/forward-debate-2026-10-15/short-01/intro_frames.py": (
        "b266136fdc8e40c9019c7c64cf736d05b5bde998b0906d6cd0fc4f9a520fedc8",
        [("Image", "PIL.Image")],
    ),
    "docs/operations/video/forward-debate-2026-10-15/short-02/check_frames.py": (
        "c4967c234d71bbf8808b7276ee71ed6875b709dd2cf3d8750e51c96ca214ebaf",
        [("Image", "PIL.Image"), ("ImageDraw", "PIL.ImageDraw")],
    ),
}
OFFLINE_MODULES = {
    name
    for path in OFFLINE_TOOLS
    for name in (path.removesuffix(".py").replace("/", "."), PurePosixPath(path).stem)
}
OFFLINE_FILENAMES = {PurePosixPath(path).name for path in OFFLINE_TOOLS}
PINNED_FUNCTIONS = {
    "prepare_copy": "f8c331b1f9f341588fe4425f70e2ef8cbaed1a741931476fb45f1ae0248fc991",
    "render_original_page": "5d96d518905a7c362c369b58086ded8afcee8f3b0ca8e271c4c049c3b89a7790",
}
EXPECTED_IMPORTS = {
    RENDERER: [
        ("Image", "PIL.Image"),
        ("ImageDraw", "PIL.ImageDraw"),
        ("ImageFont", "PIL.ImageFont"),
    ],
    PIL_TEST: [("Image", "PIL.Image"), ("tv_ad_redaction", RENDER_MODULE)],
    SERVICE: [("tv_ad_redaction", RENDER_MODULE)],
    **{path: imports for path, (_, imports) in OFFLINE_TOOLS.items()},
}
ARROW_NAMES = {
    "fromarrow",
    "toarrow",
    "from_arrow",
    "to_arrow",
    "new_arrow",
    "__arrow_c_array__",
    "__arrow_c_schema__",
    "__arrow_array__",
    "__arrow_c_stream__",
}
IMPORT_FUNCTIONS = {
    "__import__",
    "builtins.__import__",
    "__builtins__.__import__",
    "importlib.import_module",
    "importlib.__import__",
}


def digest(value):
    return hashlib.sha256(
        json.dumps(value, sort_keys=True, separators=(",", ":")).encode()
    ).hexdigest()


def canonical_ast(node):
    # Python 3.13 changed ast.dump's empty-field output. This representation is
    # stable across 3.12/3.14 while keeping all substantive syntax and literals.
    if isinstance(node, ast.AST):
        return {
            "node": type(node).__name__,
            **{
                key: canonical_ast(value)
                for key, value in ast.iter_fields(node)
                if value is not None and value != []
            },
        }
    if isinstance(node, list):
        return [canonical_ast(value) for value in node]
    if isinstance(node, bytes):
        return {"bytes": node.hex()}
    if isinstance(node, complex):
        return {"complex": repr(node)}
    if node is Ellipsis:
        return {"ellipsis": True}
    return node


def normalized(name):
    return re.sub(r"[-_.]+", "-", name).lower()


def read_regular(root, relative):
    parts = PurePosixPath(relative).parts
    if not parts or parts[0] == "/" or ".." in parts:
        raise ValueError("unsafe tracked path")
    path = root
    for part in parts:
        path = path / part
        if path.is_symlink():
            raise ValueError("symlink in tracked source path")
    if not stat.S_ISREG(path.stat().st_mode):
        raise ValueError("tracked source is not a regular file")
    return path.read_bytes()


def tracked_paths(root):
    result = subprocess.run(
        [
            "git",
            "-C",
            str(root),
            "ls-files",
            "--stage",
            "-z",
            "--",
            "*.py",
            "uv.lock",
            "pyproject.toml",
        ],
        check=True,
        capture_output=True,
        timeout=15,
    )
    paths = set()
    for record in result.stdout.split(b"\0"):
        if not record:
            continue
        header, raw_path = record.split(b"\t", 1)
        mode, _, stage = header.decode("ascii").split()
        path = raw_path.decode("utf-8")
        if not (path.endswith(".py") or path in {"uv.lock", "pyproject.toml"}):
            continue
        if mode not in {"100644", "100755"} or stage != "0" or path in paths:
            raise ValueError("unmerged or nonregular tracked source")
        paths.add(path)
    required = {"uv.lock", "pyproject.toml", RENDERER, PIL_TEST, SERVICE}
    if not required <= paths:
        raise ValueError("reviewed source or lock is not tracked")
    return sorted(paths)


def dependency_errors(lock, project):
    errors = []
    packages = lock.get("package")
    if not isinstance(packages, list) or not packages:
        return ["uv.lock: missing package records"]
    pillow = []
    edges = []

    def walk(value, owner, location):
        if isinstance(value, dict):
            name = value.get("name")
            if isinstance(name, str) and normalized(name) == "pyarrow":
                errors.append("uv.lock: pyarrow package or requirement is present")
            if isinstance(name, str) and normalized(name) == "pillow" and location:
                edges.append((owner, location, value))
            for key, child in value.items():
                walk(child, owner, f"{location}.{key}" if location else key)
        elif isinstance(value, list):
            for child in value:
                walk(child, owner, location)

    for package in packages:
        if not isinstance(package, dict) or not isinstance(package.get("name"), str):
            return ["uv.lock: malformed package record"]
        name = package["name"]
        if normalized(name) == "pillow":
            pillow.append(package)
        walk(package, name, "")
    if (
        len(pillow) != 1
        or pillow[0].get("version") != "13.0.0"
        or digest(pillow[0]) != PILLOW_ENTRY_SHA256
    ):
        errors.append("uv.lock: reviewed Pillow 13.0.0 artifact fingerprint changed")
    expected = [
        ("alethical", "dependencies", {"name": "pillow"}),
        (
            "alethical",
            "metadata.requires-dist",
            {"name": "pillow", "specifier": ">=13.0.0"},
        ),
    ]
    if sorted(edges, key=repr) != sorted(expected, key=repr):
        errors.append("uv.lock: reviewed alethical -> Pillow dependency path changed")
    requirements = project.get("project", {}).get("dependencies", [])
    if not isinstance(requirements, list) or any(
        not isinstance(value, str) for value in requirements
    ):
        errors.append("pyproject.toml: malformed project requirements")
    else:
        relevant = [
            value for value in requirements if re.match(r"(?i)^pillow(?:\b|\[)", value)
        ]
        if relevant != ["pillow>=13.0.0"]:
            errors.append("pyproject.toml: reviewed Pillow requirement changed")
    return errors


def source_errors(relative, tree):
    errors = []
    aliases = {}
    strings = {}
    imports = []
    nodes = list(ast.walk(tree))
    parents = {
        child: parent for parent in nodes for child in ast.iter_child_nodes(parent)
    }

    def report(node, reason):
        errors.append(f"{relative}:{getattr(node, 'lineno', 1)}: {reason}")

    def literal(node):
        if isinstance(node, ast.Constant) and isinstance(node.value, str):
            return node.value
        if isinstance(node, ast.Name):
            return strings.get(node.id)
        if isinstance(node, ast.BinOp) and isinstance(node.op, ast.Add):
            left, right = literal(node.left), literal(node.right)
            if left is not None and right is not None and len(left) + len(right) < 4096:
                return left + right
        return None

    def qualified(node):
        if isinstance(node, ast.Name):
            return aliases.get(node.id, node.id)
        if isinstance(node, ast.Attribute):
            return f"{qualified(node.value)}.{node.attr}"
        if isinstance(node, ast.Subscript) and qualified(node.value) == "__builtins__":
            member = literal(node.slice)
            if member is not None:
                return f"__builtins__.{member}"
        if (
            isinstance(node, ast.Call)
            and qualified(node.func) in {"getattr", "builtins.getattr"}
            and len(node.args) >= 2
        ):
            name = literal(node.args[1])
            if name is not None:
                return f"{qualified(node.args[0])}.{name}"
        return ""

    def sensitive_module(name):
        return (
            name == "PIL"
            or name.startswith("PIL.")
            or name == "pyarrow"
            or name.startswith("pyarrow.")
            or name == RENDER_MODULE
            or name.startswith(RENDER_MODULE + ".")
            or any(
                name == module or name.startswith(module + ".")
                for module in OFFLINE_MODULES
            )
        )

    for node in nodes:
        bindings = []
        if isinstance(node, ast.Import):
            bindings = [
                (
                    item.asname or item.name.split(".")[0],
                    item.name if item.asname else item.name.split(".")[0],
                    item.name,
                )
                for item in node.names
            ]
        elif isinstance(node, ast.ImportFrom):
            module = node.module or ""
            if node.level:
                base = list(PurePosixPath(relative).parent.parts)
                module = ".".join(
                    base[: len(base) - node.level + 1] + ([module] if module else [])
                )
            bindings = [
                (
                    item.asname or item.name,
                    f"{module}.{item.name}",
                    f"{module}.{item.name}",
                )
                for item in node.names
            ]
            if any(item.name == "*" for item in node.names) and (
                module.startswith("alethical.pipeline") or sensitive_module(module)
            ):
                report(node, "wildcard import can widen the reviewed Pillow boundary")
        for local, resolved, imported in bindings:
            aliases[local] = resolved
            if sensitive_module(imported):
                imports.append((local, imported))
    if sorted(imports) != sorted(EXPECTED_IMPORTS.get(relative, [])):
        report(tree, "Pillow, pyarrow, or renderer import boundary changed")

    # Resolve ordinary aliases and literal concatenation without executing code.
    for _ in range(8):
        changed = False
        for node in nodes:
            if not isinstance(node, (ast.Assign, ast.AnnAssign)) or node.value is None:
                continue
            targets = node.targets if isinstance(node, ast.Assign) else [node.target]
            for target in targets:
                if not isinstance(target, ast.Name):
                    continue
                value = literal(node.value)
                if value is not None and strings.get(target.id) != value:
                    strings[target.id] = value
                    changed = True
                name = qualified(node.value)
                if name and aliases.get(target.id) != name and name != target.id:
                    aliases[target.id] = name
                    changed = True
        if not changed:
            break

    def known_prefix(node):
        """Only prove a dynamic import unrelated from its fixed leading text."""
        value = literal(node)
        if value is not None:
            return value
        if isinstance(node, ast.BinOp) and isinstance(node.op, ast.Add):
            left = literal(node.left)
            if left is not None:
                return left + known_prefix(node.right)
            return known_prefix(node.left)
        if isinstance(node, ast.JoinedStr):
            parts = []
            for value in node.values:
                if not isinstance(value, ast.Constant) or not isinstance(
                    value.value, str
                ):
                    break
                parts.append(value.value)
            return "".join(parts)
        return ""

    def sensitive_reference(node):
        if sensitive_module(qualified(node)):
            return True
        if isinstance(node, ast.Call):
            return sensitive_reference(node.func)
        if isinstance(node, (ast.Attribute, ast.Subscript)):
            return sensitive_reference(node.value)
        return False

    def dynamic_import_requires_review(node, function):
        target_node = (
            node.args[0]
            if node.args
            else next(
                (keyword.value for keyword in node.keywords if keyword.arg == "name"),
                None,
            )
        )
        target = literal(target_node)
        prefix = known_prefix(target_node)
        if prefix.startswith("."):
            # import_module('.Image', 'PIL') is as sensitive as a direct import.
            package_node = (
                node.args[1]
                if len(node.args) > 1
                else next(
                    (
                        keyword.value
                        for keyword in node.keywords
                        if keyword.arg == "package"
                    ),
                    None,
                )
            )
            package = literal(package_node)
            if (
                function != "importlib.import_module"
                or package is None
                or target is None
            ):
                return True
            level = len(target) - len(target.lstrip("."))
            parts = package.split(".")
            if level > len(parts):
                return True
            target = ".".join(parts[: len(parts) - level + 1]) + target[level - 1 :]
            prefix = target
        # Builtin relative imports can resolve against caller-provided globals.
        if function != "importlib.import_module":
            level_node = (
                node.args[4]
                if len(node.args) > 4
                else next(
                    (
                        keyword.value
                        for keyword in node.keywords
                        if keyword.arg == "level"
                    ),
                    None,
                )
            )
            if level_node is not None and not (
                isinstance(level_node, ast.Constant)
                and type(level_node.value) is int
                and level_node.value == 0
            ):
                return True
        if target is not None:
            return sensitive_module(target) or "tv_ad_redaction" in target
        # A whole module component rules out PIL/pyarrow and the renderer path.
        # Wholly unknown names still require review; no general dataflow proof is claimed.
        if "." not in prefix:
            return True
        first = prefix.split(".", 1)[0]
        if first in {"PIL", "pyarrow"}:
            return True
        if any(
            module.startswith(prefix) or prefix.startswith(module + ".")
            for module in OFFLINE_MODULES
        ):
            return True
        if first != "alethical":
            return False
        return prefix.startswith(RENDER_MODULE) or RENDER_MODULE.startswith(prefix)

    assigned_values = {}
    for assignment in nodes:
        if (
            isinstance(assignment, (ast.Assign, ast.AnnAssign))
            and assignment.value is not None
        ):
            targets = (
                assignment.targets
                if isinstance(assignment, ast.Assign)
                else [assignment.target]
            )
            for target in targets:
                if isinstance(target, ast.Name):
                    assigned_values.setdefault(target.id, []).append(assignment.value)

    def contains_alignment(node, seen=frozenset()):
        if node is None:
            return False
        if isinstance(node, ast.Name) and node.id not in seen:
            return any(
                contains_alignment(value, seen | {node.id})
                for value in assigned_values.get(node.id, [])
            )
        if isinstance(node, ast.Dict):
            return any(literal(key) == "PILLOW_ALIGNMENT" for key in node.keys) or any(
                key is None and contains_alignment(value, seen)
                for key, value in zip(node.keys, node.values)
            )
        if isinstance(node, ast.Call) and qualified(node.func) in {
            "dict",
            "builtins.dict",
        }:
            return any(
                keyword.arg == "PILLOW_ALIGNMENT"
                or keyword.arg is None
                and contains_alignment(keyword.value, seen)
                for keyword in node.keywords
            ) or any(contains_alignment(arg, seen) for arg in node.args)
        if isinstance(node, ast.BinOp) and isinstance(node.op, ast.BitOr):
            return contains_alignment(node.left, seen) or contains_alignment(
                node.right, seen
            )
        return False

    def offline_path(node, seen=frozenset()):
        """Recognize literal paths and ordinary aliases without running code."""
        value = literal(node)
        if (
            value is not None
            and PurePosixPath(value.replace("\\", "/")).name in OFFLINE_FILENAMES
        ):
            return True
        if isinstance(node, ast.Name) and node.id not in seen:
            return any(
                offline_path(value, seen | {node.id})
                for value in assigned_values.get(node.id, [])
            )
        if isinstance(node, (ast.BinOp, ast.JoinedStr, ast.List, ast.Tuple)):
            return any(
                offline_path(child, seen) for child in ast.iter_child_nodes(node)
            )
        if isinstance(node, ast.Call):
            return any(offline_path(arg, seen) for arg in node.args) or offline_path(
                node.func, seen
            )
        if isinstance(node, ast.Attribute):
            return offline_path(node.value, seen)
        return False

    def launches_offline(node, seen=frozenset()):
        if isinstance(node, ast.Name) and node.id not in seen:
            return any(
                launches_offline(value, seen | {node.id})
                for value in assigned_values.get(node.id, [])
            )
        if isinstance(node, (ast.List, ast.Tuple)) and node.elts:
            first = node.elts[0]
            executable = literal(first)
            launcher = PurePosixPath(executable).name if executable is not None else ""
            if offline_path(first):
                return True
            if qualified(first) == "sys.executable" or re.fullmatch(
                r"python(?:\d+(?:\.\d+)*)?|uvx?|(?:ba|z)?sh", launcher
            ):
                return any(launches_offline(arg) for arg in node.elts[1:])
            return False
        value = literal(node)
        if value is not None:
            return any(
                re.search(
                    r"(?:^|[\s/'\"])" + re.escape(name) + r"(?:$|[\s'\";])", value
                )
                for name in OFFLINE_FILENAMES
            )
        return offline_path(node)

    def owner(node):
        while node in parents:
            node = parents[node]
            if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
                return node.name
        return None

    for node in nodes:
        name = qualified(node)
        tail = name.rsplit(".", 1)[-1]
        if isinstance(node, (ast.Attribute, ast.Name, ast.Call)):
            if (tail in ARROW_NAMES or tail == "set_alignment") and (
                relative in EXPECTED_IMPORTS or sensitive_reference(node)
            ):
                report(node, "Arrow export or Pillow alignment access requires review")
            if (
                tail == "burn_pixels"
                and relative != RENDERER
                and (relative in EXPECTED_IMPORTS or sensitive_reference(node))
            ):
                report(node, "new external burn_pixels reference requires review")
            if name.startswith(RENDER_MODULE + ".") and relative not in {
                RENDERER,
                PIL_TEST,
            }:
                member = name[len(RENDER_MODULE) + 1 :].split(".")[0]
                if relative != SERVICE or member not in {
                    "MAX_SOURCE_BYTES",
                    "MAX_PAGES",
                    "render_redacted",
                    "store_artifacts",
                }:
                    report(node, "new renderer member access requires review")
                elif (
                    member in {"render_redacted", "store_artifacts"}
                    and owner(node) not in PINNED_FUNCTIONS
                ):
                    report(node, "new renderer caller requires review")
        if isinstance(node, ast.Call):
            function = qualified(node.func)
            if function in IMPORT_FUNCTIONS:
                if dynamic_import_requires_review(node, function):
                    report(
                        node, "dynamic import can widen the reviewed Pillow boundary"
                    )
            path_arguments = []
            if function in {
                "runpy.run_path",
                "builtins.exec",
                "exec",
                "builtins.compile",
                "compile",
            }:
                path_arguments.extend(node.args[:1])
                path_arguments.extend(
                    keyword.value
                    for keyword in node.keywords
                    if keyword.arg in {"path_name", "source"}
                )
            elif function in {
                "importlib.util.spec_from_file_location",
                "importlib.machinery.SourceFileLoader",
                "importlib.machinery.SourcelessFileLoader",
            }:
                path_arguments.extend(node.args[1:2])
                path_arguments.extend(
                    keyword.value
                    for keyword in node.keywords
                    if keyword.arg in {"location", "path"}
                )
            if any(offline_path(arg) for arg in path_arguments):
                report(node, "archived offline Pillow tool execution requires review")
            if function == "runpy.run_module" and dynamic_import_requires_review(
                node, "importlib.import_module"
            ):
                report(node, "module execution can widen the reviewed Pillow boundary")
            if function.startswith("subprocess.") or function in {
                "os.system",
                "os.execv",
                "os.execve",
                "os.execvp",
                "os.execvpe",
            }:
                commands = (
                    node.args[:2] if function.startswith("os.exec") else node.args[:1]
                )
                commands += [
                    keyword.value
                    for keyword in node.keywords
                    if keyword.arg in {"args", "command", "path", "file"}
                ]
                if any(launches_offline(command) for command in commands):
                    report(
                        node, "archived offline Pillow tool execution requires review"
                    )
            if (
                function
                in {
                    "getattr",
                    "setattr",
                    "delattr",
                    "builtins.getattr",
                    "builtins.setattr",
                    "builtins.delattr",
                }
                and len(node.args) >= 2
            ):
                member = literal(node.args[1])
                if member in ARROW_NAMES | {"set_alignment", "burn_pixels"} and (
                    relative in EXPECTED_IMPORTS or sensitive_reference(node.args[0])
                ):
                    report(
                        node,
                        "reflective Arrow, alignment, or pixel access requires review",
                    )
            # Only writes into real process environments count; inert fixture
            # dictionaries and unrelated mapping assignments remain allowed.
            if function in {
                "os.putenv",
                "os.environ.setdefault",
                "os.environ.update",
                "os.environ.__setitem__",
            }:
                if any(
                    literal(arg) == "PILLOW_ALIGNMENT" or contains_alignment(arg)
                    for arg in node.args
                ) or any(
                    keyword.arg == "PILLOW_ALIGNMENT"
                    or keyword.arg is None
                    and contains_alignment(keyword.value)
                    for keyword in node.keywords
                ):
                    report(node, "PILLOW_ALIGNMENT environment write requires review")
            if (
                function == "operator.setitem"
                and len(node.args) >= 2
                and qualified(node.args[0]) == "os.environ"
                and literal(node.args[1]) == "PILLOW_ALIGNMENT"
            ):
                report(node, "PILLOW_ALIGNMENT environment write requires review")
            if function.startswith("subprocess.") or function in {
                "os.execve",
                "os.execvpe",
                "os.spawnve",
                "os.spawnvpe",
                "os.posix_spawn",
                "os.posix_spawnp",
            }:
                environments = [
                    keyword.value for keyword in node.keywords if keyword.arg == "env"
                ]
                index = {
                    "os.execve": 2,
                    "os.execvpe": 2,
                    "os.posix_spawn": 2,
                    "os.posix_spawnp": 2,
                    "os.spawnve": 3,
                    "os.spawnvpe": 3,
                    "subprocess.Popen": 10,
                }.get(function)
                if index is not None and len(node.args) > index:
                    environments.append(node.args[index])
                if any(contains_alignment(value) for value in environments):
                    report(
                        node, "PILLOW_ALIGNMENT subprocess environment requires review"
                    )
        if (
            isinstance(node, ast.Subscript)
            and isinstance(node.ctx, ast.Store)
            and qualified(node.value) == "os.environ"
            and literal(node.slice) == "PILLOW_ALIGNMENT"
        ):
            report(node, "PILLOW_ALIGNMENT environment write requires review")
        if (
            isinstance(node, (ast.Assign, ast.AnnAssign, ast.AugAssign))
            and node.value is not None
        ):
            targets = node.targets if isinstance(node, ast.Assign) else [node.target]
            if any(
                qualified(target) == "os.environ" for target in targets
            ) and contains_alignment(node.value):
                report(
                    node, "PILLOW_ALIGNMENT environment configuration requires review"
                )
    if relative == SERVICE:
        for name, expected in PINNED_FUNCTIONS.items():
            found = [
                node
                for node in tree.body
                if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef))
                and node.name == name
            ]
            if len(found) != 1 or digest(canonical_ast(found[0])) != expected:
                report(tree, f"reviewed renderer caller {name} changed")
    return sorted(set(errors))


def validate(root) -> list[str]:
    """Validate tracked working-tree files, returning reasons the exception holds."""
    root = Path(root)
    try:
        if root.is_symlink():
            raise ValueError("root is a symlink")
        root = root.resolve(strict=True)
        paths = tracked_paths(root)
    except (OSError, ValueError, UnicodeError, subprocess.SubprocessError):
        return ["Pillow source boundary: cannot establish tracked regular files"]
    errors = []
    files = {}
    for relative in paths:
        try:
            data = read_regular(root, relative)
            files[relative] = data
            if (
                relative in PINNED_FILES
                and hashlib.sha256(data).hexdigest() != PINNED_FILES[relative]
            ):
                errors.append(f"{relative}: reviewed Pillow caller fingerprint changed")
            if (
                relative in OFFLINE_TOOLS
                and hashlib.sha256(data).hexdigest() != OFFLINE_TOOLS[relative][0]
            ):
                errors.append(
                    f"{relative}: reviewed offline Pillow tool fingerprint changed"
                )
            if relative.endswith(".py"):
                errors.extend(
                    source_errors(relative, ast.parse(data, filename=relative))
                )
        except (OSError, ValueError, SyntaxError, UnicodeError, RecursionError):
            errors.append(
                f"{relative}: source cannot be read and parsed as a regular Python file"
            )
    try:
        errors.extend(
            dependency_errors(
                tomllib.loads(files["uv.lock"].decode()),
                tomllib.loads(files["pyproject.toml"].decode()),
            )
        )
    except (
        KeyError,
        OSError,
        ValueError,
        TypeError,
        AttributeError,
        UnicodeError,
        RecursionError,
    ):
        errors.append(
            "Pillow dependency boundary: lock or project requirements cannot be validated"
        )
    return sorted(set(errors))
