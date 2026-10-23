"""Trusted-main-only read-only verification of the production Pillow boundary.

No application code is imported. Credentials are read only from
PILLOW_RAILWAY_TOKEN and sent only to the fixed Railway HTTPS/WSS origins.
"""

from __future__ import annotations

import asyncio
from contextlib import contextmanager
from datetime import UTC, datetime
import json
import logging
import os
from pathlib import Path
import re
import signal
import ssl
import sys
import time
import urllib.request

API = "https://backboard.railway.com/graphql/v2"
RELAY = "wss://backboard.railway.com/relay"
PROJECT = "82c4cf9a-9a48-469b-bc71-8afd05339955"
ENVIRONMENT = "2555565c-2352-4cfe-b3ff-8073003c97a1"
SERVICE = "e5d405e3-5d8b-43a0-83e9-780e6627e1ca"
GUARD_PATH = Path(__file__).with_name("pillow_source_guard.py")
BUILD_COMMAND = "uv sync --frozen"
START_COMMAND = "uv run uvicorn alethical.api.main:create_app --factory --host 0.0.0.0 --port $PORT --proxy-headers --forwarded-allow-ips='*'"
PREDEPLOY_COMMAND = "uv run python -m alembic -c alembic.ini upgrade head"
FACTS = {
    "pillow_alignment_present": False,
    "pyarrow_importable": False,
    "pyarrow_installed": False,
    "pillow_version": "13.0.0",
    "renderer_sha256": "33a2f50db0ddd2bda981a131a8e6d4d2c27e9b0ebfcd04f03d10201b32533e92",
    "deployed_source_guard_passed": True,
    "app_environment_verified": True,
}
MAX_HTTP_BYTES = 1_000_000
MAX_DEPLOYMENTS = 4
MAX_INSTANCES = 8
MAX_OUTPUT = 4096
MAX_WIRE_BYTES = 32768
MAX_MESSAGES = 64
# Deploys took 2.7 to 6.8 minutes on 2026-10-23. Only these
# provider states mean "still rolling out"; every other unsettled state fails.
ROLLOUT_DEPLOYMENT_STATES = {
    "QUEUED",
    "WAITING",
    "BUILDING",
    "DEPLOYING",
    "INITIALIZING",
    "REMOVING",
}
ROLLOUT_INSTANCE_STATES = {"CREATED", "INITIALIZING", "RESTARTING", "REMOVING"}
SETTLE_SECONDS = 600
SETTLE_INTERVAL = 15
PROOF_SECONDS = 240
PROBE_SECONDS = 90
QUERY = """query PillowRuntimeState($environmentId: String!, $serviceId: String!) {
  projectToken { project { id } environment { id } }
  environment(id: $environmentId) { id config(decryptVariables: false) }
  serviceInstance(environmentId: $environmentId, serviceId: $serviceId) {
    activeDeployments { id status meta instances { id status } }
  }
}"""


class CheckFailed(Exception):
    """Details must never be printed: provider exceptions may contain secrets."""


def require(condition):
    if not condition:
        raise CheckFailed


@contextmanager
def failure_stage(name):
    # Only fixed local labels may reach logs. Never include provider data,
    # exception text, variable names, commands, credentials or remote output.
    require(
        name
        in {
            "probe-build",
            "first-provider-read",
            "first-state-validation",
            "rollout-wait",
            "instance-probe",
            "second-provider-read",
            "second-state-validation",
            "state-stability",
        }
    )
    try:
        yield
    except (Exception, KeyboardInterrupt):
        print(f"Pillow runtime stage failed: {name}.", file=sys.stderr)
        raise CheckFailed from None


def unique_object(pairs):
    result = {}
    for key, value in pairs:
        require(key not in result)
        result[key] = value
    return result


def read_json(raw):
    def invalid_constant(_):
        raise CheckFailed

    try:
        return json.loads(
            raw, object_pairs_hook=unique_object, parse_constant=invalid_constant
        )
    except (ValueError, UnicodeError, RecursionError):
        raise CheckFailed from None


def exact_dict(value, keys):
    require(isinstance(value, dict) and set(value) == set(keys))
    return value


def resource_id(value):
    require(
        isinstance(value, str)
        and re.fullmatch(r"[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}", value)
    )
    return value


def commit_id(value):
    require(isinstance(value, str) and re.fullmatch(r"[0-9a-f]{40}", value))
    return value


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def query(token):
    request = urllib.request.Request(
        API,
        data=json.dumps(
            {
                "query": QUERY,
                "variables": {"environmentId": ENVIRONMENT, "serviceId": SERVICE},
            }
        ).encode(),
        headers={
            "project-access-token": token,
            "Content-Type": "application/json",
            "User-Agent": "alethical-pillow-runtime/1",
        },
        method="POST",
    )
    # Default TLS verification remains enabled; no proxy credentials or redirects.
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())
    try:
        with opener.open(request, timeout=15) as response:
            require(response.status == 200 and response.geturl() == API)
            raw = response.read(MAX_HTTP_BYTES + 1)
        require(len(raw) <= MAX_HTTP_BYTES)
        result = read_json(raw)
        require(
            isinstance(result, dict) and set(result) <= {"data", "errors", "extensions"}
        )
        require(result.get("errors") in (None, []))
        return exact_dict(
            result.get("data"), {"projectToken", "environment", "serviceInstance"}
        )
    except Exception:
        raise CheckFailed from None


def variable_names(value):
    require(isinstance(value, dict) and len(value) <= 1000)
    for name, entry in value.items():
        require(
            isinstance(name, str)
            and re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]{0,255}", name)
        )
        exact_dict(entry, {"value", "generator"})
        # The provider explicitly hides values when decryptVariables=false.
        require(entry["value"] is None and entry["generator"] is None)
    require("PILLOW_ALIGNMENT" not in value)
    return set(value)


def replica_count(deploy):
    require(isinstance(deploy, dict))
    regions = deploy.get("multiRegionConfig")
    require(isinstance(regions, dict) and 1 <= len(regions) <= MAX_INSTANCES)
    total = 0
    for region_name, placement in regions.items():
        require(isinstance(region_name, str) and len(region_name) <= 100)
        if placement is None:
            continue  # Railway keeps null entries for removed regions.
        require(isinstance(placement, dict))
        count = placement.get("numReplicas")
        require(type(count) is int and 0 <= count <= MAX_INSTANCES)
        total += count
    require(1 <= total <= MAX_INSTANCES)
    return total


def command_settings(settings, *, deployed):
    require(isinstance(settings, dict))
    build, deploy = settings.get("build"), settings.get("deploy")
    require(isinstance(build, dict) and isinstance(deploy, dict))
    require(build.get("buildCommand") == BUILD_COMMAND)
    require(deploy.get("startCommand") == START_COMMAND)
    if deployed:
        require(deploy.get("preDeployCommand") == [PREDEPLOY_COMMAND])
    elif "preDeployCommand" in deploy:
        require(deploy["preDeployCommand"] in (PREDEPLOY_COMMAND, [PREDEPLOY_COMMAND]))


def settings(data):
    """Validate identity and saved settings, which must hold even mid-rollout."""
    exact_dict(data, {"projectToken", "environment", "serviceInstance"})
    identity = exact_dict(data["projectToken"], {"project", "environment"})
    require(exact_dict(identity["project"], {"id"})["id"] == PROJECT)
    require(exact_dict(identity["environment"], {"id"})["id"] == ENVIRONMENT)
    environment = exact_dict(data["environment"], {"id", "config"})
    require(environment["id"] == ENVIRONMENT)
    config = environment["config"]
    require(isinstance(config, dict))
    services = config.get("services")
    require(isinstance(services, dict) and SERVICE in services)
    service = services[SERVICE]
    require(isinstance(service, dict))
    variable_names(service.get("variables"))
    variable_names(config.get("sharedVariables"))
    command_settings(service, deployed=False)


def rollout_in_progress(data):
    """True only for the provider's named rollout states; anything else is judged
    by the full snapshot, which fails on crashed, failed or unknown states."""
    active = data["serviceInstance"]["activeDeployments"]
    if not isinstance(active, list):
        return False
    for deployment in active:
        if not isinstance(deployment, dict):
            return False
        if deployment.get("status") in ROLLOUT_DEPLOYMENT_STATES:
            return True
        instances = deployment.get("instances")
        if isinstance(instances, list) and any(
            isinstance(row, dict) and row.get("status") in ROLLOUT_INSTANCE_STATES
            for row in instances
        ):
            return True
    return False


def snapshot(data):
    """Validate configuration without returning private names, values or commands."""
    settings(data)
    instance = exact_dict(data["serviceInstance"], {"activeDeployments"})
    active = instance["activeDeployments"]
    require(isinstance(active, list) and 1 <= len(active) <= MAX_DEPLOYMENTS)
    deployments = []
    deployment_ids, all_instances = set(), set()
    for deployment in active:
        exact_dict(deployment, {"id", "status", "meta", "instances"})
        deployment_id = resource_id(deployment["id"])
        require(
            deployment_id not in deployment_ids and deployment["status"] == "SUCCESS"
        )
        deployment_ids.add(deployment_id)
        metadata = deployment["meta"]
        require(isinstance(metadata, dict))
        commit = commit_id(metadata.get("commitHash"))
        manifest = metadata.get("serviceManifest")
        command_settings(manifest, deployed=True)
        replicas = replica_count(manifest["deploy"])
        instances = deployment["instances"]
        require(isinstance(instances, list) and len(instances) <= 1000)
        running, seen = [], set()
        for row in instances:
            exact_dict(row, {"id", "status"})
            instance_id = resource_id(row["id"])
            require(instance_id not in seen and row["status"] in {"RUNNING", "REMOVED"})
            seen.add(instance_id)
            if row["status"] == "RUNNING":
                require(instance_id not in all_instances)
                all_instances.add(instance_id)
                running.append(instance_id)
        require(len(running) == replicas and len(all_instances) <= MAX_INSTANCES)
        deployments.append(
            {
                "deployment_id": deployment_id,
                "commit_sha": commit,
                "instance_ids": sorted(running),
                "configured_replicas": replicas,
            }
        )
    return sorted(deployments, key=lambda deployment: deployment["deployment_id"])


REMOTE_BODY = r"""
import importlib.metadata, importlib.util, os, pathlib, sys

def deployed_paths(root):
    paths = ['uv.lock', 'pyproject.toml']
    def failed_walk(error):
        raise error
    for current, directories, filenames in os.walk(root, followlinks=False, onerror=failed_walk):
        current_path = pathlib.Path(current)
        directories[:] = [name for name in directories if name not in {'node_modules', '__pycache__'} and not (current_path == root and name in {'.venv', '.git'})]
        for name in directories:
            if (current_path / name).is_symlink():
                raise ValueError('source directory symlink')
        for name in filenames:
            if name.endswith('.py'):
                paths.append((current_path / name).relative_to(root).as_posix())
                if len(paths) > 5000:
                    raise ValueError('source inventory bound')
    if not {RENDERER, PIL_TEST, SERVICE} <= set(paths):
        raise ValueError('reviewed source unavailable')
    total = 0
    for relative in paths:
        path = root / relative
        if path.is_symlink() or not path.is_file():
            raise ValueError('nonregular source')
        size = path.stat().st_size
        total += size
        if size > 1_000_000 or total > 32_000_000:
            raise ValueError('source byte bound')
    return sorted(paths)

def bounded_proc_read(path, limit):
    with path.open('rb') as stream:
        value = stream.read(limit + 1)
    if len(value) > limit:
        raise ValueError('process field bound')
    return value

def process_environment(raw):
    if raw and not raw.endswith(b'\0'):
        raise ValueError('malformed process environment')
    result = {}
    for entry in raw.split(b'\0'):
        if not entry:
            continue
        key, separator, value = entry.partition(b'=')
        if not separator or not key or key in result:
            raise ValueError('malformed process environment')
        result[key] = value
    return result

def verify_app_environment(root):
    venv_bin = root / '.venv' / 'bin'
    executable = pathlib.Path(sys.executable)
    if pathlib.Path(sys.prefix) != root / '.venv' or executable.parent != venv_bin:
        raise ValueError('probe virtual environment mismatch')
    if not re.fullmatch(r'python(?:\d+(?:\.\d+)*)?', executable.name):
        raise ValueError('probe interpreter identity')
    interpreter = executable.resolve(strict=True)
    own_environment = dict(os.environb)
    keys = (b'PYTHONPATH', b'PYTHONHOME', b'VIRTUAL_ENV', b'UV_PROJECT_ENVIRONMENT', b'PYTHONNOUSERSITE', b'PYTHONUSERBASE', b'PYTHONSAFEPATH', b'PYTHONPLATLIBDIR')
    candidates = []
    processes = list(pathlib.Path('/proc').iterdir())
    if len(processes) > 5000:
        raise ValueError('process inventory bound')
    for process in processes:
        if not process.name.isdigit():
            continue
        # The probe itself carries up to 100 KB of reviewed source in one argument.
        command = bounded_proc_read(process / 'cmdline', 131072)
        if not command:
            continue
        if not command.endswith(b'\0'):
            raise ValueError('malformed process command')
        args = command.rstrip(b'\0').split(b'\0')
        if b'alethical.api.main:create_app' not in args:
            continue
        script_form = len(args) >= 3 and pathlib.PurePosixPath(os.fsdecode(args[1])).name == 'uvicorn'
        module_form = len(args) >= 4 and args[1:3] == [b'-m', b'uvicorn']
        if not script_form and not module_form:
            continue
        app_python = pathlib.Path(os.fsdecode(args[0]))
        if app_python.parent != venv_bin or not re.fullmatch(r'python(?:\d+(?:\.\d+)*)?', app_python.name):
            raise ValueError('application interpreter differs')
        if (process / 'exe').resolve(strict=True) != interpreter:
            raise ValueError('application executable differs')
        if (process / 'cwd').resolve(strict=True) != root:
            raise ValueError('application working directory differs')
        environment = process_environment(bounded_proc_read(process / 'environ', 1_000_000))
        if b'PILLOW_ALIGNMENT' in environment:
            raise ValueError('application alignment present')
        if any(environment.get(key) != own_environment.get(key) for key in keys):
            raise ValueError('application interpreter environment differs')
        if bounded_proc_read(process / 'cmdline', 131072) != command:
            raise ValueError('application process changed during check')
        candidates.append(process.name)
    if not candidates:
        raise ValueError('application process unavailable')
    return True

def runtime_result():
    global tracked_paths
    tracked_paths = deployed_paths
    root = pathlib.Path.cwd()
    app_environment_verified = verify_app_environment(root)
    if validate(root):
        raise ValueError('deployed source boundary changed')
    try:
        importlib.metadata.version('pyarrow')
        installed = True
    except importlib.metadata.PackageNotFoundError:
        installed = False
    return {
        'pillow_alignment_present': 'PILLOW_ALIGNMENT' in os.environ,
        'pyarrow_importable': importlib.util.find_spec('pyarrow') is not None,
        'pyarrow_installed': installed,
        'pillow_version': importlib.metadata.version('Pillow'),
        'renderer_sha256': hashlib.sha256(pathlib.Path(RENDERER).read_bytes()).hexdigest(),
        'deployed_source_guard_passed': True,
        'app_environment_verified': app_environment_verified,
        'deployment_id': os.environ.get('RAILWAY_DEPLOYMENT_ID'),
        'commit_sha': os.environ.get('RAILWAY_GIT_COMMIT_SHA'),
        'instance_id': os.environ.get('RAILWAY_REPLICA_ID'),
    }

try:
    print(json.dumps(runtime_result(), sort_keys=True, separators=(',', ':')), flush=True)
except Exception:
    sys.exit(31)
"""


def build_probe():
    require(not GUARD_PATH.is_symlink())
    source = GUARD_PATH.read_text()
    require(len(source.encode()) <= 100_000)
    future = "from __future__ import annotations\n"
    require(source.count(future) == 1)
    # Code is from a fixed sibling in the trusted main checkout, never PR inputs.
    probe = (
        future
        + "import signal\nsignal.alarm(60)\n"
        + source.replace(future, "")
        + REMOTE_BODY
    )
    compile(probe, "<trusted-pillow-runtime-probe>", "exec")
    return probe


def verified_output(output, deployment, instance_id):
    require(0 < len(output) <= MAX_OUTPUT)
    expected = {
        **FACTS,
        "deployment_id": deployment["deployment_id"],
        "commit_sha": deployment["commit_sha"],
        "instance_id": instance_id,
    }
    actual = exact_dict(read_json(output), expected)
    # Exact types matter: JSON's numeric 0 must not pass as False.
    require(
        all(
            type(actual[key]) is type(value) and actual[key] == value
            for key, value in expected.items()
        )
    )
    return actual


def data_bytes(payload):
    data = payload.get("data")
    if isinstance(data, str):
        return data.encode("utf-8", errors="strict")
    require(isinstance(data, dict) and set(data) in ({"data"}, {"type", "data"}))
    require("type" not in data or data["type"] == "Buffer")
    values = data["data"]
    require(
        isinstance(values, list)
        and all(type(value) is int and 0 <= value <= 255 for value in values)
    )
    return bytes(values)


async def exchange(socket, probe, deployment, instance_id):
    count = wire_bytes = 0

    async def receive():
        nonlocal count, wire_bytes
        raw = await asyncio.wait_for(socket.recv(), timeout=70)
        require(isinstance(raw, str))
        count += 1
        wire_bytes += len(raw.encode())
        require(count <= MAX_MESSAGES and wire_bytes <= MAX_WIRE_BYTES)
        message = exact_dict(read_json(raw), {"type", "payload"})
        require(
            isinstance(message["type"], str) and isinstance(message["payload"], dict)
        )
        return message["type"], message["payload"]

    kind, _ = await receive()
    require(kind == "welcome")
    await asyncio.wait_for(
        socket.send(
            json.dumps(
                {
                    "type": "exec_command",
                    "payload": {
                        "command": "python",
                        "args": ["-B", "-c", probe],
                        "env": {},
                    },
                }
            )
        ),
        timeout=5,
    )
    output = bytearray()
    while True:
        kind, payload = await receive()
        if kind == "session_data":
            output.extend(data_bytes(payload))
            require(len(output) <= MAX_OUTPUT)
        elif kind == "command_exit":
            require(type(payload.get("code")) is int and payload["code"] == 0)
            return verified_output(output, deployment, instance_id)
        else:
            require(kind in {"ready", "stand_by"})


async def probe_instance(token, probe, deployment, instance_id):
    from websockets.asyncio.client import connect

    class NoRedirectConnect(connect):
        def process_redirect(self, exc):
            return exc

    logger = logging.Logger("pillow-runtime-silent")
    logger.disabled = True
    async with NoRedirectConnect(
        RELAY,
        additional_headers={
            "project-access-token": token,
            "X-Railway-Project-Id": PROJECT,
            "X-Railway-Environment-Id": ENVIRONMENT,
            "X-Railway-Service-Id": SERVICE,
            "X-Railway-Deployment-Instance-Id": instance_id,
            "X-Source": "alethical-pillow-runtime/1",
        },
        proxy=None,
        compression=None,
        open_timeout=15,
        close_timeout=2,
        ping_interval=10,
        ping_timeout=10,
        max_size=16384,
        max_queue=4,
        logger=logger,
    ) as socket:
        return await exchange(socket, probe, deployment, instance_id)


def connection_lost(error):
    """Only a lost or refused connection is retried; a wrong answer, a bad exit,
    a malformed message, a certificate failure or a timeout is never retried."""
    if isinstance(error, (CheckFailed, ssl.SSLError, TimeoutError)):
        return False
    if isinstance(error, ConnectionError):
        return True
    try:
        from websockets.exceptions import ConnectionClosed, InvalidStatus
    except ImportError:
        return False
    if isinstance(error, InvalidStatus):
        return 500 <= error.response.status_code < 600
    return isinstance(error, ConnectionClosed)


async def verify_instances(token, probe, deployments):
    semaphore = asyncio.Semaphore(4)

    async def verify(deployment, instance_id):
        async with semaphore:
            for attempt in (1, 2):
                try:
                    return await asyncio.wait_for(
                        probe_instance(token, probe, deployment, instance_id),
                        timeout=PROBE_SECONDS,
                    )
                except Exception as error:
                    if attempt == 2 or not connection_lost(error):
                        raise

    tasks = [
        verify(deployment, instance_id)
        for deployment in deployments
        for instance_id in deployment["instance_ids"]
    ]
    results = await asyncio.gather(*tasks)
    require(
        len(results)
        == sum(len(deployment["instance_ids"]) for deployment in deployments)
    )


def utc_now():
    return datetime.now(UTC).isoformat(timespec="seconds").replace("+00:00", "Z")


def settled_state(token, *, sleep=time.sleep, clock=time.monotonic):
    """Read until no deployment is rolling out, then validate the full snapshot.
    Bad settings fail at once; a rollout that never settles fails at the bound."""
    deadline = clock() + SETTLE_SECONDS
    while True:
        with failure_stage("first-provider-read"):
            state = query(token)
        with failure_stage("first-state-validation"):
            settings(state)
            if not rollout_in_progress(state):
                return state, snapshot(state)
        with failure_stage("rollout-wait"):
            require(clock() + SETTLE_INTERVAL <= deadline)
            sleep(SETTLE_INTERVAL)


def check(token):
    started_at = utc_now()
    with failure_stage("probe-build"):
        probe = build_probe()
    before, deployments = settled_state(token)
    with failure_stage("instance-probe"):
        asyncio.run(verify_instances(token, probe, deployments))
    with failure_stage("second-provider-read"):
        after = query(token)
    with failure_stage("second-state-validation"):
        require(snapshot(after) == deployments)
    # Includes redacted config, command strings and removed-instance identities;
    # no private payload is serialized into the result or diagnostics.
    with failure_stage("state-stability"):
        require(after == before)
    return {
        "schema_version": 1,
        "project_id": PROJECT,
        "environment_id": ENVIRONMENT,
        "service_id": SERVICE,
        "started_at": started_at,
        "checked_at": utc_now(),
        "saved_pillow_alignment_present": False,
        **FACTS,
        "deployments": deployments,
    }


def main():
    def timed_out(_signum, _frame):
        raise CheckFailed

    try:
        require(len(sys.argv) == 1)
        token = os.environ.get("PILLOW_RAILWAY_TOKEN", "")
        require(
            0 < len(token) <= 4096 and all(33 <= ord(char) <= 126 for char in token)
        )
        signal.signal(signal.SIGALRM, timed_out)
        # Settling is bounded on its own, so the proof keeps its full budget.
        signal.alarm(SETTLE_SECONDS + PROOF_SECONDS)
        result = check(token)
        signal.alarm(0)
    except (Exception, KeyboardInterrupt):
        signal.alarm(0)
        print("Pillow runtime verification failed.", file=sys.stderr)
        return 1
    print(json.dumps(result, sort_keys=True, separators=(",", ":")))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
