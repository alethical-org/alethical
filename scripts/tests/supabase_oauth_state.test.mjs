import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { selectSupabaseArtifact } from "../lib/supabase_oauth_artifacts.mjs";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const helper = path.join(root, "scripts/supabase_oauth_state.mjs");

const repository = "example/project";
const prefix = `/repos/${repository}/actions`;
const primary = "supabase-oauth-state-primary";
const backup = "supabase-oauth-state-backup";
const now = Date.parse("2026-10-23T03:00:00Z");

function artifact(id, runId, createdAt, extra = {}) {
  return {
    id,
    name: primary,
    created_at: createdAt,
    expired: false,
    expires_at: "2027-01-21T03:00:00Z",
    workflow_run: { id: runId, repository_id: 1 },
    ...extra,
  };
}

function run(id, extra = {}) {
  return {
    id,
    workflow_id: 7,
    event: "workflow_dispatch",
    status: "completed",
    run_attempt: 1,
    repository: { id: 1, full_name: repository },
    ...extra,
  };
}

function fixture(artifacts, runs, overrides = {}) {
  const calls = [];
  const read = (route) => {
    calls.push(route);
    if (overrides[route]) return overrides[route](calls);
    if (route === `${prefix}/workflows/hosted-service-settings.yml`)
      return { id: 7 };
    const url = new URL(route, "https://api.github.test");
    if (url.pathname === `${prefix}/artifacts`) {
      const items = artifacts.filter(
        (item) => item.name === url.searchParams.get("name"),
      );
      const page = Number(url.searchParams.get("page"));
      return {
        total_count: items.length,
        artifacts: items.slice((page - 1) * 100, page * 100),
      };
    }
    const found = runs.find((item) => route === `${prefix}/runs/${item.id}`);
    assert.ok(found, `Unexpected metadata route: ${route}`);
    return found;
  };
  return {
    calls,
    select: (extra = {}) =>
      selectSupabaseArtifact({ repository, read, now, ...extra }),
  };
}

test("an older run's newer saved replacement wins over run creation order", () => {
  const data = fixture(
    [
      artifact(20, 200, "2026-10-23T02:01:20Z"),
      artifact(30, 100, "2026-10-23T02:11:22Z"),
    ],
    [run(200), run(100)],
  );
  assert.equal(data.select(), 30);
  assert.ok(data.calls.every((route) => !route.includes("/zip")));
});

test("both saved names are paginated completely, even past 100 older entries", () => {
  const items = Array.from({ length: 101 }, (_, index) =>
    artifact(index + 1, 100, "2026-10-23T01:00:00Z"),
  );
  items.push(artifact(200, 200, "2026-10-23T02:00:00Z"));
  const data = fixture(
    items.concat([
      artifact(201, 200, "2026-10-23T02:00:01Z", { name: backup }),
    ]),
    [run(100), run(200)],
  );
  assert.equal(data.select(), 201);
  assert.ok(data.calls.some((route) => route.includes("page=2")));
});

for (const extra of [
  { event: "pull_request" },
  { workflow_id: 8 },
  { repository: { id: 2, full_name: "other/project" } },
]) {
  test(`ignores an untrusted source ${JSON.stringify(extra)}`, () => {
    const data = fixture(
      [
        artifact(10, 100, "2026-10-23T01:00:00Z"),
        artifact(20, 200, "2026-10-23T02:00:00Z"),
      ],
      [run(100), run(200, extra)],
    );
    assert.equal(data.select(), 10);
  });
}

for (const event of [
  "push",
  "schedule",
  "workflow_dispatch",
  "pull_request_target",
]) {
  test(`keeps the existing trusted event ${event} even if a later check failed`, () => {
    assert.equal(
      fixture(
        [artifact(10, 100, "2026-10-23T01:00:00Z")],
        [run(100, { event, conclusion: "failure" })],
      ).select(),
      10,
    );
  });
}

test("a retry can restore its own prior attempt, only for the exact current run and attempt", () => {
  const data = fixture(
    [artifact(10, 100, "2026-10-23T02:00:00Z")],
    [run(100, { status: "in_progress", run_attempt: 2 })],
  );
  assert.equal(
    data.select({ currentRunId: "100", currentRunAttempt: "2" }),
    10,
  );
  assert.throws(
    () => data.select({ currentRunId: "200", currentRunAttempt: "2" }),
    /current retry/,
  );
  assert.throws(
    () => data.select({ currentRunId: "100", currentRunAttempt: "1" }),
    /current retry/,
  );
  assert.throws(
    () => data.select({ currentRunId: "100", currentRunAttempt: "3" }),
    /current retry/,
  );
});

test("a newer trusted unfinished run never falls back to an older consumed grant", () => {
  assert.throws(
    () =>
      fixture(
        [
          artifact(10, 100, "2026-10-23T01:00:00Z"),
          artifact(20, 200, "2026-10-23T02:00:00Z"),
        ],
        [run(100), run(200, { status: "in_progress" })],
      ).select(),
    /current retry/,
  );
});

test("select CLI needs no Supabase secret and prints only the selected numeric identity", (t) => {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "supabase-metadata-"),
  );
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const item = artifact(20, 200, "2026-10-23T02:00:00Z", {
    expires_at: "2099-01-01T00:00:00Z",
  });
  const gh = path.join(directory, "gh");
  fs.writeFileSync(
    gh,
    `#!${process.execPath}\nconst route=process.argv[3];
    const item=${JSON.stringify(item)};
    const data=route.includes('/workflows/')?{id:7}:route.includes('/runs/')?${JSON.stringify(run(200))}:
      {total_count:route.includes('name=${primary}')?1:0,artifacts:route.includes('name=${primary}')?[item]:[]};
    process.stdout.write(JSON.stringify(data));`,
    { mode: 0o700 },
  );
  const env = { PATH: directory, GITHUB_REPOSITORY: repository };
  assert.equal(
    execFileSync(process.execPath, [helper, "select"], {
      env,
      encoding: "utf8",
    }),
    "20\n",
  );
  fs.writeFileSync(
    gh,
    `#!${process.execPath}\nprocess.stderr.write('private response body');process.exit(1);`,
  );
  assert.throws(
    () =>
      execFileSync(process.execPath, [helper, "select"], {
        env,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      }),
    (error) => {
      assert.equal(error.stdout, "");
      assert.match(error.stderr, /metadata/);
      assert.equal(error.stderr.includes("private response body"), false);
      return true;
    },
  );
});

for (const extra of [
  { expired: true },
  { expires_at: "2026-10-23T02:30:00Z" },
]) {
  test(`the newest expired copy fails without returning an older consumed grant ${JSON.stringify(extra)}`, () => {
    assert.throws(
      () =>
        fixture(
          [
            artifact(10, 100, "2026-10-23T01:00:00Z"),
            artifact(20, 200, "2026-10-23T02:00:00Z", extra),
          ],
          [run(100), run(200)],
        ).select(),
      /expired/,
    );
  });
}

test("missing saved history permits the existing bootstrap path", () => {
  assert.equal(fixture([], []).select(), null);
});

test("same-run timestamp ties choose a stable saved copy; different-run ties fail", () => {
  const a = artifact(10, 100, "2026-10-23T02:00:00Z");
  const b = artifact(20, 100, a.created_at, { name: backup });
  assert.equal(fixture([b, a], [run(100)]).select(), 20);
  assert.throws(
    () =>
      fixture(
        [a, { ...b, workflow_run: { id: 200, repository_id: 1 } }],
        [run(100), run(200)],
      ).select(),
    /ambiguous/,
  );
});

test("metadata errors, incomplete pages and changing pagination fail without bootstrap", () => {
  const route = `${prefix}/artifacts?name=${primary}&per_page=100&page=1`;
  for (const response of [
    () => {
      throw new Error("private response body");
    },
    () => ({ total_count: 1, artifacts: [] }),
    () => ({ total_count: 0 }),
  ]) {
    assert.throws(
      () => fixture([], [], { [route]: response }).select(),
      /metadata/,
    );
  }
  let reads = 0;
  assert.throws(
    () =>
      fixture([], [], {
        [route]: () => {
          reads += 1;
          return { total_count: reads === 1 ? 0 : 1, artifacts: [] };
        },
      }).select(),
    /metadata/,
  );
});

test("duplicate pages and missing or malformed saved identity fail closed", () => {
  const a = artifact(10, 100, "2026-10-23T02:00:00Z");
  for (const items of [
    [a, a],
    [{ ...a, created_at: "unknown" }],
    [{ ...a, workflow_run: null }],
    [{ ...a, expired: undefined }],
  ]) {
    assert.throws(() => fixture(items, [run(100)]).select(), /metadata/);
  }
});

test("metadata work is bounded and exhaustion is an error, never partial history", () => {
  const items = Array.from({ length: 51 }, (_, index) =>
    artifact(index + 1, index + 1, "2026-10-23T02:00:00Z"),
  );
  const data = fixture(
    items,
    items.map((item) => run(item.id, { event: "pull_request" })),
  );
  assert.throws(() => data.select(), /budget/);
  assert.equal(data.calls.length, 50);
});

test("both restore jobs call the same selector and retain encryption and serialization", () => {
  const workflow = fs.readFileSync(
    path.join(root, ".github/workflows/hosted-service-settings.yml"),
    "utf8",
  );
  assert.equal(
    workflow.match(
      /artifact_id="\$\(node scripts\/supabase_oauth_state.mjs select\)"/g,
    )?.length,
    2,
  );
  assert.equal(workflow.includes("trusted_run_id"), false);
  assert.equal(
    workflow.match(/- scripts\/lib\/supabase_oauth_artifacts.mjs/g)?.length,
    2,
  );
  assert.match(
    workflow,
    /group: hosted-service-settings-supabase-oauth\s+cancel-in-progress: false/,
  );
  assert.equal(
    workflow.match(/node scripts\/supabase_oauth_state.mjs decrypt/g)?.length,
    2,
  );
  assert.equal(workflow.match(/retention-days: 90/g)?.length, 4);
  const targetPaths = workflow
    .split("  pull_request_target:")[1]
    .split("  push:")[0];
  assert.equal(targetPaths.includes("scripts/"), false);
});

test("encrypts the rotating token and decrypts it without printing it", (t) => {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "supabase-oauth-state-"),
  );
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const tokenFile = path.join(directory, "token");
  const encryptedFile = path.join(directory, "state.json");
  const restoredFile = path.join(directory, "restored");
  const token = "private-rotating-refresh-token";
  const env = {
    ...process.env,
    SUPABASE_OAUTH_CLIENT_SECRET: "private-client-secret",
  };
  fs.writeFileSync(tokenFile, token, { mode: 0o600 });

  const encryptedOutput = execFileSync(
    process.execPath,
    [helper, "encrypt", tokenFile, encryptedFile],
    { env, encoding: "utf8" },
  );
  assert.equal(encryptedOutput, "");
  assert.equal(fs.readFileSync(encryptedFile, "utf8").includes(token), false);

  const decryptedOutput = execFileSync(
    process.execPath,
    [helper, "decrypt", encryptedFile, restoredFile],
    { env, encoding: "utf8" },
  );
  assert.equal(decryptedOutput, "");
  assert.equal(fs.readFileSync(restoredFile, "utf8"), token);
  assert.equal(fs.statSync(restoredFile).mode & 0o777, 0o600);
});

test("fails closed when the client secret is wrong", (t) => {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "supabase-oauth-state-"),
  );
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const tokenFile = path.join(directory, "token");
  const encryptedFile = path.join(directory, "state.json");
  const restoredFile = path.join(directory, "restored");
  fs.writeFileSync(tokenFile, "private-token", { mode: 0o600 });
  execFileSync(
    process.execPath,
    [helper, "encrypt", tokenFile, encryptedFile],
    {
      env: { ...process.env, SUPABASE_OAUTH_CLIENT_SECRET: "right-secret" },
    },
  );

  assert.throws(() =>
    execFileSync(
      process.execPath,
      [helper, "decrypt", encryptedFile, restoredFile],
      {
        env: { ...process.env, SUPABASE_OAUTH_CLIENT_SECRET: "wrong-secret" },
        stdio: "ignore",
      },
    ),
  );
  assert.equal(fs.existsSync(restoredFile), false);
});

for (const [field, bytes] of [
  ["tag", 4],
  ["iv", 8],
]) {
  test(`fails closed when the encrypted ${field} has the wrong length`, (t) => {
    const directory = fs.mkdtempSync(
      path.join(os.tmpdir(), "supabase-oauth-state-"),
    );
    t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
    const tokenFile = path.join(directory, "token");
    const encryptedFile = path.join(directory, "state.json");
    const restoredFile = path.join(directory, "restored");
    const env = {
      ...process.env,
      SUPABASE_OAUTH_CLIENT_SECRET: "private-client-secret",
    };
    fs.writeFileSync(tokenFile, "private-token", { mode: 0o600 });
    execFileSync(
      process.execPath,
      [helper, "encrypt", tokenFile, encryptedFile],
      { env },
    );
    const state = JSON.parse(fs.readFileSync(encryptedFile, "utf8"));
    state[field] = Buffer.alloc(bytes).toString("base64");
    fs.writeFileSync(encryptedFile, JSON.stringify(state), { mode: 0o600 });

    assert.throws(() =>
      execFileSync(
        process.execPath,
        [helper, "decrypt", encryptedFile, restoredFile],
        { env, stdio: "ignore" },
      ),
    );
    assert.equal(fs.existsSync(restoredFile), false);
  });
}
