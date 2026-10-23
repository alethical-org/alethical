"""Provider and relay mutation tests. No real credentials or network calls."""

import ast
import asyncio
from copy import deepcopy
import importlib.util
import io
import json
import os
from pathlib import Path
from pathlib import PurePosixPath
import re
from types import SimpleNamespace
from unittest.mock import Mock

import pytest

SCRIPT = Path(__file__).resolve().parents[3] / "scripts/check_pillow_runtime.py"
SPEC = importlib.util.spec_from_file_location("pillow_runtime_under_test", SCRIPT)
runtime = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(runtime)

DEPLOYMENT = "83d992b3-6d98-4f75-965d-840c91a92810"
INSTANCE = "820cf286-6972-460e-a685-8b89e5b43ab9"
OTHER_INSTANCE = "11111111-1111-4111-8111-111111111111"
REMOVED_INSTANCE = "22222222-2222-4222-8222-222222222222"
COMMIT = "c509dfe42d497b79960f4aeb9af6707a5af6e0c0"
FAKE_TOKEN = "clearly-fake-test-token"


@pytest.fixture
def provider():
    manifest = {
        "build": {"buildCommand": runtime.BUILD_COMMAND},
        "deploy": {
            "startCommand": runtime.START_COMMAND,
            "preDeployCommand": [runtime.PREDEPLOY_COMMAND],
            "multiRegionConfig": {"sfo": {"numReplicas": 1}},
        },
    }
    return {
        "projectToken": {
            "project": {"id": runtime.PROJECT},
            "environment": {"id": runtime.ENVIRONMENT},
        },
        "environment": {
            "id": runtime.ENVIRONMENT,
            "config": {
                "services": {
                    runtime.SERVICE: {
                        "variables": {
                            "EXAMPLE_VARIABLE": {"value": None, "generator": None}
                        },
                        "build": deepcopy(manifest["build"]),
                        "deploy": {"startCommand": runtime.START_COMMAND},
                    }
                },
                "sharedVariables": {},
                "privateNetworkDisabled": False,
            },
        },
        "serviceInstance": {
            "activeDeployments": [
                {
                    "id": DEPLOYMENT,
                    "status": "SUCCESS",
                    "meta": {"commitHash": COMMIT, "serviceManifest": manifest},
                    "instances": [
                        {"id": INSTANCE, "status": "RUNNING"},
                        {"id": REMOVED_INSTANCE, "status": "REMOVED"},
                    ],
                }
            ]
        },
    }


def active(provider):
    return provider["serviceInstance"]["activeDeployments"][0]


def service(provider):
    return provider["environment"]["config"]["services"][runtime.SERVICE]


def observation(deployment=None, instance_id=INSTANCE):
    return {
        **runtime.FACTS,
        "deployment_id": DEPLOYMENT
        if deployment is None
        else deployment["deployment_id"],
        "commit_sha": COMMIT,
        "instance_id": instance_id,
    }


def message(kind, **payload):
    return json.dumps({"type": kind, "payload": payload})


class Socket:
    def __init__(self, messages):
        self.messages = iter(messages)
        self.sent = []

    async def recv(self):
        value = next(self.messages)
        if isinstance(value, Exception):
            raise value
        return value

    async def send(self, value):
        self.sent.append(json.loads(value))


def test_valid_snapshot_includes_running_only(provider):
    assert runtime.snapshot(provider) == [
        {
            "deployment_id": DEPLOYMENT,
            "commit_sha": COMMIT,
            "instance_ids": [INSTANCE],
            "configured_replicas": 1,
        }
    ]


@pytest.mark.parametrize(
    "mutation",
    [
        lambda p: p["projectToken"]["project"].update(id=INSTANCE),
        lambda p: p["projectToken"]["environment"].update(id=INSTANCE),
        lambda p: p["environment"].update(id=INSTANCE),
        lambda p: p["environment"]["config"].pop("sharedVariables"),
        lambda p: p["environment"]["config"].update(sharedVariables=[]),
        lambda p: p["environment"]["config"]["sharedVariables"].update(
            PILLOW_ALIGNMENT={"value": None, "generator": None}
        ),
        lambda p: service(p).pop("variables"),
        lambda p: service(p)["variables"].update(
            PILLOW_ALIGNMENT={"value": None, "generator": None}
        ),
        lambda p: service(p)["variables"].update(BAD="not a variable entry"),
        lambda p: service(p)["variables"].update(
            BAD={"value": "private-value", "generator": None}
        ),
        lambda p: service(p)["variables"].update(BAD={"value": None}),
        lambda p: service(p)["build"].update(buildCommand="changed build"),
        lambda p: service(p)["deploy"].update(startCommand="changed start"),
        lambda p: active(p)["meta"]["serviceManifest"]["build"].update(
            buildCommand="changed build"
        ),
        lambda p: active(p)["meta"]["serviceManifest"]["deploy"].update(
            startCommand="changed start"
        ),
        lambda p: active(p)["meta"]["serviceManifest"]["deploy"].update(
            preDeployCommand=["changed predeploy"]
        ),
        lambda p: active(p)["meta"]["serviceManifest"]["deploy"].pop(
            "multiRegionConfig"
        ),
        lambda p: active(p)["meta"]["serviceManifest"]["deploy"]["multiRegionConfig"][
            "sfo"
        ].update(numReplicas=2),
        lambda p: active(p)["meta"]["serviceManifest"]["deploy"]["multiRegionConfig"][
            "sfo"
        ].update(numReplicas=True),
        lambda p: active(p).update(status="DEPLOYING"),
        lambda p: active(p).update(instances=[]),
        lambda p: active(p)["instances"][0].update(status="STOPPING"),
        lambda p: active(p)["instances"].append(deepcopy(active(p)["instances"][0])),
        lambda p: active(p)["meta"].update(commitHash="private invalid identity"),
        lambda p: p["serviceInstance"].update(activeDeployments=[]),
        lambda p: p["serviceInstance"]["activeDeployments"].append(deepcopy(active(p))),
    ],
)
def test_provider_mutations_fail_closed(provider, mutation):
    mutation(provider)
    with pytest.raises(runtime.CheckFailed):
        runtime.snapshot(provider)


def test_all_running_instances_are_probed_and_bound(provider, monkeypatch):
    active(provider)["instances"].append({"id": OTHER_INSTANCE, "status": "RUNNING"})
    active(provider)["meta"]["serviceManifest"]["deploy"]["multiRegionConfig"]["sfo"][
        "numReplicas"
    ] = 2
    calls = []

    async def probe(token, text, deployment, instance):
        calls.append(
            (
                token,
                text,
                deployment["deployment_id"],
                deployment["commit_sha"],
                instance,
            )
        )
        return observation(instance_id=instance)

    monkeypatch.setattr(runtime, "probe_instance", probe)
    asyncio.run(
        runtime.verify_instances(
            FAKE_TOKEN, "fixed test code", runtime.snapshot(provider)
        )
    )
    assert len(calls) == 2
    assert {call[-1] for call in calls} == {INSTANCE, OTHER_INSTANCE}
    assert all(
        call[:4] == (FAKE_TOKEN, "fixed test code", DEPLOYMENT, COMMIT)
        for call in calls
    )


def test_one_failed_instance_prevents_success(provider, monkeypatch):
    async def probe(*_):
        raise runtime.CheckFailed

    monkeypatch.setattr(runtime, "probe_instance", probe)
    with pytest.raises(runtime.CheckFailed):
        asyncio.run(
            runtime.verify_instances(
                FAKE_TOKEN, "fixed code", runtime.snapshot(provider)
            )
        )


@pytest.mark.parametrize(
    "key,value",
    [
        ("pillow_alignment_present", True),
        ("pillow_alignment_present", 0),
        ("pyarrow_importable", True),
        ("pyarrow_installed", True),
        ("pillow_version", "13.0.1"),
        ("renderer_sha256", "0" * 64),
        ("deployed_source_guard_passed", False),
        ("app_environment_verified", False),
        ("deployment_id", OTHER_INSTANCE),
        ("commit_sha", "0" * 40),
        ("instance_id", OTHER_INSTANCE),
    ],
)
def test_observed_fact_or_identity_drift_fails(provider, key, value):
    output = observation()
    output[key] = value
    with pytest.raises(runtime.CheckFailed):
        runtime.verified_output(
            json.dumps(output).encode(), runtime.snapshot(provider)[0], INSTANCE
        )


@pytest.mark.parametrize(
    "raw", [b"", b"{}", b"x" * 4097, b'{"x":1,"x":2}', b'{"x":NaN}']
)
def test_invalid_output_fails(provider, raw):
    with pytest.raises(runtime.CheckFailed):
        runtime.verified_output(raw, runtime.snapshot(provider)[0], INSTANCE)


@pytest.mark.parametrize("buffer", [False, True])
def test_relay_accepts_only_fixed_command_and_verified_exit(provider, buffer):
    output = json.dumps(observation())
    encoded = {"type": "Buffer", "data": list(output.encode())} if buffer else output
    socket = Socket(
        [
            message("welcome"),
            message("ready"),
            message("session_data", data=encoded),
            message("command_exit", code=0),
        ]
    )
    result = asyncio.run(
        runtime.exchange(
            socket, "fixed test code", runtime.snapshot(provider)[0], INSTANCE
        )
    )
    assert result == observation()
    assert socket.sent == [
        {
            "type": "exec_command",
            "payload": {
                "command": "python",
                "args": ["-B", "-c", "fixed test code"],
                "env": {},
            },
        }
    ]


@pytest.mark.parametrize(
    "messages",
    [
        [message("error", message="private provider error")],
        [message("welcome"), message("pty_closed")],
        [message("welcome"), message("command_exit", code=1)],
        [message("welcome"), message("command_exit", code=False)],
        [message("welcome"), message("command_exit", code=0)],
        [message("welcome"), message("session_data", data="x" * 4097)],
        [message("welcome"), message("session_data", data={"data": [True]})],
        [message("welcome")] + [message("ready")] * 64,
        [b"binary message"],
        [message("welcome"), message("welcome")],
    ],
)
def test_relay_incomplete_or_malformed_result_fails(provider, messages):
    with pytest.raises(runtime.CheckFailed):
        asyncio.run(
            runtime.exchange(
                Socket(messages), "fixed code", runtime.snapshot(provider)[0], INSTANCE
            )
        )


def test_snapshot_changes_during_probes_fail(provider, monkeypatch):
    after = deepcopy(provider)
    service(after)["variables"]["NEW_SAFE_VARIABLE"] = {
        "value": None,
        "generator": None,
    }
    replies = iter([provider, after])
    monkeypatch.setattr(runtime, "query", lambda _: next(replies))
    monkeypatch.setattr(runtime, "build_probe", lambda: "fixed code")

    async def verify(*_):
        pass

    monkeypatch.setattr(runtime, "verify_instances", verify)
    with pytest.raises(runtime.CheckFailed):
        runtime.check(FAKE_TOKEN)


def test_stable_result_contains_only_allowlisted_facts(provider, monkeypatch):
    monkeypatch.setattr(runtime, "query", lambda _: deepcopy(provider))
    monkeypatch.setattr(runtime, "build_probe", lambda: "fixed code")

    async def verify(*_):
        pass

    monkeypatch.setattr(runtime, "verify_instances", verify)
    report = runtime.check(FAKE_TOKEN)
    assert set(report) == {
        "schema_version",
        "project_id",
        "environment_id",
        "service_id",
        "started_at",
        "checked_at",
        "saved_pillow_alignment_present",
        "deployments",
        *runtime.FACTS,
    }
    serialized = json.dumps(report)
    assert (
        "EXAMPLE_VARIABLE" not in serialized and runtime.START_COMMAND not in serialized
    )
    assert report["started_at"].endswith("Z") and report["checked_at"].endswith("Z")
    assert report["deployments"] == runtime.snapshot(provider)


@pytest.mark.parametrize(
    "body",
    [
        b'{"data":null}',
        b'{"data":{},"errors":[{"message":"private"}]}',
        b'{"data":{},"data":{}}',
        b"x" * 1_000_001,
    ],
)
def test_http_bad_response_fails_without_raw_text(body, monkeypatch):
    class Response(io.BytesIO):
        status = 200

        def geturl(self):
            return runtime.API

    monkeypatch.setattr(
        runtime.urllib.request,
        "build_opener",
        lambda *_: SimpleNamespace(open=lambda *_args, **_kwargs: Response(body)),
    )
    with pytest.raises(runtime.CheckFailed) as failure:
        runtime.query(FAKE_TOKEN)
    assert str(failure.value) == ""


def test_http_uses_fixed_origin_project_header_and_no_redirect(provider, monkeypatch):
    seen = []

    class Response(io.BytesIO):
        status = 200

        def geturl(self):
            return runtime.API

    def opening(request, timeout):
        seen.append(request)
        assert timeout == 15
        return Response(json.dumps({"data": provider}).encode())

    def build(*handlers):
        assert any(isinstance(handler, runtime.NoRedirect) for handler in handlers)
        assert any(
            isinstance(handler, runtime.urllib.request.ProxyHandler)
            and handler.proxies == {}
            for handler in handlers
        )
        return SimpleNamespace(open=opening)

    monkeypatch.setattr(runtime.urllib.request, "build_opener", build)
    assert runtime.query(FAKE_TOKEN) == provider
    assert seen[0].full_url == runtime.API
    assert seen[0].get_header("Project-access-token") == FAKE_TOKEN
    assert seen[0].get_header("Authorization") is None
    assert (
        runtime.NoRedirect().redirect_request(
            None, None, 302, None, None, "https://other.invalid"
        )
        is None
    )


def test_main_never_prints_exception_or_token(monkeypatch, capsys):
    monkeypatch.setattr(runtime.sys, "argv", ["check_pillow_runtime.py"])
    monkeypatch.setattr(runtime.os, "environ", {"PILLOW_RAILWAY_TOKEN": FAKE_TOKEN})
    monkeypatch.setattr(runtime.signal, "signal", Mock())
    monkeypatch.setattr(runtime.signal, "alarm", Mock())

    def fails(_):
        raise RuntimeError("private text " + FAKE_TOKEN)

    monkeypatch.setattr(runtime, "check", fails)
    assert runtime.main() == 1
    output = capsys.readouterr()
    assert output.out == ""
    assert output.err == "Pillow runtime verification failed.\n"


def test_probe_embeds_trusted_guard_without_app_imports():
    probe = runtime.build_probe()
    compile(probe, "<offline-test>", "exec")
    assert "signal.alarm(60)" in probe
    assert "tracked_paths = deployed_paths" in probe
    assert "onerror=failed_walk" in probe
    assert "from alethical" not in probe and "import alethical" not in probe
    assert "PILLOW_RAILWAY_TOKEN" not in probe


def test_symlink_guard_is_rejected(tmp_path, monkeypatch):
    target = tmp_path / "target.py"
    target.write_text("from __future__ import annotations\n")
    link = tmp_path / "linked.py"
    link.symlink_to(target)
    monkeypatch.setattr(runtime, "GUARD_PATH", link)
    with pytest.raises(runtime.CheckFailed):
        runtime.build_probe()


@pytest.fixture
def remote_helpers(tmp_path):
    root = tmp_path / "app"
    root.mkdir()
    proc = tmp_path / "proc"
    proc.mkdir()
    interpreter = root / ".venv/bin/python"
    interpreter.parent.mkdir(parents=True)
    interpreter.touch()
    own_environment = {b"VIRTUAL_ENV": os.fsencode(root / ".venv")}

    def paths(value):
        return proc if str(value) == "/proc" else Path(value)

    scope = {
        "pathlib": SimpleNamespace(Path=paths, PurePosixPath=PurePosixPath),
        "sys": SimpleNamespace(prefix=str(root / ".venv"), executable=str(interpreter)),
        "os": SimpleNamespace(
            environb=own_environment, fsdecode=os.fsdecode, walk=os.walk
        ),
        "re": re,
        "RENDERER": "alethical/pipeline/tv_ad_redaction.py",
        "PIL_TEST": "alethical/tests/test_tv_ad_review.py",
        "SERVICE": "alethical/api/services/tv_ad_review.py",
    }
    names = {
        "deployed_paths",
        "bounded_proc_read",
        "process_environment",
        "verify_app_environment",
    }
    nodes = [
        node
        for node in ast.parse(runtime.REMOTE_BODY).body
        if isinstance(node, ast.FunctionDef) and node.name in names
    ]
    exec(
        compile(
            ast.Module(body=nodes, type_ignores=[]), "<trusted-remote-helpers>", "exec"
        ),
        scope,
    )

    def add_process(pid="100", *, environment=None, app_python=None, cwd=None):
        path = proc / pid
        path.mkdir()
        argv = [
            str(app_python or interpreter),
            str(root / ".venv/bin/uvicorn"),
            "alethical.api.main:create_app",
            "--factory",
        ]
        (path / "cmdline").write_bytes(
            b"\0".join(os.fsencode(arg) for arg in argv) + b"\0"
        )
        env = own_environment if environment is None else environment
        (path / "environ").write_bytes(
            b"\0".join(key + b"=" + value for key, value in env.items())
            + (b"\0" if env else b"")
        )
        (path / "exe").symlink_to(interpreter)
        (path / "cwd").symlink_to(cwd or root, target_is_directory=True)
        return path

    return root, proc, scope, add_process


def test_actual_app_and_probe_environment_match(remote_helpers):
    root, _, scope, add_process = remote_helpers
    add_process()
    add_process("101")
    assert scope["verify_app_environment"](root) is True


@pytest.mark.parametrize(
    "kind",
    [
        "alignment",
        "pythonpath",
        "virtualenv",
        "wrong_python",
        "wrong_cwd",
        "missing_env",
        "malformed_env",
        "no_app",
        "wrong_probe_prefix",
    ],
)
def test_actual_app_environment_mismatches_fail(remote_helpers, kind):
    root, _, scope, add_process = remote_helpers
    if kind == "alignment":
        add_process(environment={**scope["os"].environb, b"PILLOW_ALIGNMENT": b"64"})
    elif kind == "pythonpath":
        add_process(environment={**scope["os"].environb, b"PYTHONPATH": b"/somewhere"})
    elif kind == "virtualenv":
        add_process(environment={})
    elif kind == "wrong_python":
        add_process(app_python=Path("/usr/bin/python"))
    elif kind == "wrong_cwd":
        add_process(cwd=root.parent)
    elif kind == "wrong_probe_prefix":
        add_process()
        scope["sys"].prefix = "/usr"
    elif kind == "missing_env":
        (add_process() / "environ").unlink()
    elif kind == "malformed_env":
        (add_process() / "environ").write_bytes(b"KEY=x\0KEY=y\0")
    with pytest.raises((ValueError, OSError)):
        scope["verify_app_environment"](root)


def test_all_app_processes_must_pass(remote_helpers):
    root, _, scope, add_process = remote_helpers
    add_process()
    add_process("101", environment={**scope["os"].environb, b"PILLOW_ALIGNMENT": b"64"})
    with pytest.raises(ValueError):
        scope["verify_app_environment"](root)


def test_remote_inventory_includes_root_and_other_project_python(remote_helpers):
    root, _, scope, _ = remote_helpers
    included = [
        "uv.lock",
        "pyproject.toml",
        scope["RENDERER"],
        scope["PIL_TEST"],
        scope["SERVICE"],
        "root_module.py",
        "another_package/module.py",
    ]
    excluded = [
        ".venv/lib/dependency.py",
        ".git/hooks/check.py",
        "apps/frontend/node_modules/dependency/check.py",
        "__pycache__/cache.py",
    ]
    for relative in included + excluded:
        path = root / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text("# fixture\n")
    assert scope["deployed_paths"](root) == sorted(included)


@pytest.mark.parametrize(
    "kind", ["symlink", "oversized", "missing_required", "read_error"]
)
def test_remote_inventory_fails_closed(remote_helpers, kind):
    root, _, scope, _ = remote_helpers
    for relative in [
        "uv.lock",
        "pyproject.toml",
        scope["RENDERER"],
        scope["PIL_TEST"],
        scope["SERVICE"],
    ]:
        path = root / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text("# fixture\n")
    if kind == "symlink":
        (root / "linked_source").symlink_to(
            root / "alethical", target_is_directory=True
        )
    elif kind == "oversized":
        with (root / "huge.py").open("wb") as stream:
            stream.truncate(1_000_001)
    elif kind == "missing_required":
        (root / scope["PIL_TEST"]).unlink()
    else:

        def failed_walk(*_args, **kwargs):
            kwargs["onerror"](PermissionError("unreadable directory"))

        scope["os"].walk = failed_walk
    with pytest.raises((ValueError, OSError)):
        scope["deployed_paths"](root)
