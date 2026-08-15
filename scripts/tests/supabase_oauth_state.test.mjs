import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const helper = path.join(root, "scripts/supabase_oauth_state.mjs");

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
