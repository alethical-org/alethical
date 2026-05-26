from __future__ import annotations

import argparse
import os
import shutil
import subprocess
import sys
from collections.abc import Sequence
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def executable(name: str) -> str:
    suffixes = [".exe", ".cmd", ".bat"] if os.name == "nt" else [""]
    local_bins = [
        ROOT / ".venv" / ("Scripts" if os.name == "nt" else "bin"),
        ROOT / ".tools" / "node" / "node_modules" / "corepack" / "shims",
        ROOT / ".tools" / "node",
    ]

    for directory in local_bins:
        for suffix in suffixes:
            candidate = directory / f"{name}{suffix}"
            if candidate.exists():
                return str(candidate)

    resolved = shutil.which(name)
    if resolved:
        return resolved

    return name


def pnpm_command() -> list[str]:
    corepack = ROOT / ".tools" / "node" / "node_modules" / "corepack" / "dist" / "corepack.js"
    node = ROOT / ".tools" / "node" / "node.exe"
    if os.name == "nt" and corepack.exists() and node.exists():
        return [str(node), str(corepack), "pnpm"]
    return [executable("pnpm")]


def node_command() -> str:
    node = ROOT / ".tools" / "node" / "node.exe"
    if os.name == "nt" and node.exists():
        return str(node)
    return executable("node")


def tsc_command() -> list[str]:
    tsc = ROOT / "node_modules" / "typescript" / "bin" / "tsc"
    if tsc.exists():
        return [node_command(), str(tsc)]
    return [*pnpm_command(), "exec", "tsc"]


def run(command: Sequence[str]) -> None:
    completed = subprocess.run(command, check=False)
    if completed.returncode:
        raise SystemExit(completed.returncode)


def format_code(_: argparse.Namespace) -> None:
    run([executable("ruff"), "format", "alethical", "scripts"])


def lint(_: argparse.Namespace) -> None:
    commands = [
        [executable("ruff"), "check", "alethical", "scripts"],
        [executable("ty"), "check", "alethical/db"],
        [*pnpm_command(), "install", "--frozen-lockfile"],
        [*tsc_command(), "--noEmit", "--project", "apps/frontend/tsconfig.json"],
    ]
    for command in commands:
        run(command)


def migrate(_: argparse.Namespace) -> None:
    run([executable("docker"), "compose", "up", "-d", "db"])
    run([sys.executable, "-m", "alembic", "-c", "alembic.ini", "upgrade", "head"])


def compose_up(_: argparse.Namespace) -> None:
    run([executable("docker"), "compose", "up"])


def compose_down(_: argparse.Namespace) -> None:
    run([executable("docker"), "compose", "down"])


def pipeline_install(args: argparse.Namespace) -> None:
    run([sys.executable, "-m", "alethical.pipeline.oban", "--target", args.target, "install"])


def pipeline(args: argparse.Namespace) -> None:
    run(
        [
            sys.executable,
            "-m",
            "alethical.pipeline.oban",
            "--target",
            args.target,
            "enqueue",
            "pipeline-run",
            *args.pipeline_args,
        ]
    )


def pipeline_work(args: argparse.Namespace) -> None:
    queues = [
        ["source_sync"],
        ["bill_sync", "--concurrency", "8"],
        ["committee_sync"],
        ["vote_sync"],
        ["ai_batch"],
    ]
    for queue_args in queues:
        run(
            [
                sys.executable,
                "-m",
                "alethical.pipeline.oban",
                "--target",
                args.target,
                "drain",
                *queue_args,
            ]
        )


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Cross-platform task runner for just recipes.")
    subparsers = parser.add_subparsers(required=True)

    commands = {
        "format": format_code,
        "lint": lint,
        "migrate": migrate,
        "up": compose_up,
        "down": compose_down,
    }
    for name, handler in commands.items():
        command_parser = subparsers.add_parser(name)
        command_parser.set_defaults(func=handler)

    pipeline_install_parser = subparsers.add_parser("pipeline-install")
    pipeline_install_parser.add_argument("target")
    pipeline_install_parser.set_defaults(func=pipeline_install)

    pipeline_parser = subparsers.add_parser("pipeline")
    pipeline_parser.add_argument("target")
    pipeline_parser.add_argument("pipeline_args", nargs=argparse.REMAINDER)
    pipeline_parser.set_defaults(func=pipeline)

    pipeline_work_parser = subparsers.add_parser("pipeline-work")
    pipeline_work_parser.add_argument("target")
    pipeline_work_parser.set_defaults(func=pipeline_work)

    return parser


def main(argv: Sequence[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    args.func(args)
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
