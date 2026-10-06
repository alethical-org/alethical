import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { setTimeout as pause } from 'node:timers/promises';
import { test } from 'node:test';

const runner = new URL('./check-address-recovery-local.mjs', import.meta.url);
async function interruptedFixture(parentExitsFirst) {
  const root = await realpath(await mkdtemp(resolve(tmpdir(), 'address-process-group-test-')));
  const cache = resolve(root, 'temporary');
  let descendant;
  let child;
  try {
    await mkdir(resolve(root, 'apps/frontend/scripts'), { recursive: true });
    await mkdir(resolve(root, 'node_modules/expo/bin'), { recursive: true });
    await mkdir(cache);
    await copyFile(runner, resolve(root, 'apps/frontend/scripts/runner.mjs'));
    const marker = resolve(root, 'descendant.pid');
    await writeFile(
      resolve(root, 'node_modules/expo/bin/descendant.cjs'),
      `
      const fs = require('node:fs');
      process.on('SIGTERM', () => {});
      fs.writeFileSync(${JSON.stringify(marker)}, String(process.pid));
      setInterval(() => {}, 1000);
    `,
    );
    await writeFile(
      resolve(root, 'node_modules/expo/bin/cli'),
      `
      const { spawn } = require('node:child_process');
      spawn(process.execPath, [require('node:path').resolve(__dirname, 'descendant.cjs')], { stdio: 'ignore' });
      ${parentExitsFirst ? "process.on('SIGTERM', () => process.exit(0));" : ''}
      setInterval(() => {}, 1000);
    `,
    );
    child = spawn(process.execPath, [resolve(root, 'apps/frontend/scripts/runner.mjs')], {
      env: { ...process.env, TMPDIR: cache },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const completion = new Promise((done) => child.once('exit', done));
    let output = '';
    child.stdout.on('data', (data) => {
      output += data;
    });
    child.stderr.on('data', (data) => {
      output += data;
    });
    const deadline = Date.now() + 5000;
    while (!descendant && Date.now() < deadline) {
      descendant = Number(await readFile(marker, 'utf8').catch(() => '')) || undefined;
      if (!descendant) await pause(20);
    }
    assert.ok(descendant, `Synthetic descendant never started: ${output}`);
    process.kill(descendant, 0);
    child.kill('SIGTERM');
    assert.equal(await completion, 143, output);
    assert.throws(() => process.kill(descendant, 0), { code: 'ESRCH' });
    assert.deepEqual(await readdir(cache), [], 'Owned temporary export was not removed');
  } finally {
    // Only these task-owned synthetic processes can be cleaned up by this test.
    try {
      child?.kill('SIGKILL');
    } catch {}
    try {
      if (descendant) process.kill(descendant, 'SIGKILL');
    } catch {}
    await rm(root, { recursive: true, force: true });
  }
}

test(
  'interrupt kills a SIGTERM-ignoring descendant after its direct parent exits',
  {
    skip: process.platform === 'win32',
    timeout: 10_000,
  },
  async () => interruptedFixture(true),
);

test(
  'interrupt kills remaining owned descendants when the direct parent exits by default',
  {
    skip: process.platform === 'win32',
    timeout: 10_000,
  },
  async () => interruptedFixture(false),
);

test('missing and empty --only filters fail before exporting', async () => {
  for (const args of [['--only'], ['--only', ''], ['--only', '--webkit']]) {
    const child = spawn(process.execPath, [runner.pathname, ...args], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    child.stdout.on('data', (data) => {
      output += data;
    });
    child.stderr.on('data', (data) => {
      output += data;
    });
    assert.equal(await new Promise((done) => child.once('exit', done)), 1);
    assert.match(output, /--only needs a nonempty/);
    assert.doesNotMatch(output, /Metro|Exported:/);
  }
});

test(
  'each successful phase kills its orphan before the next phase starts',
  {
    skip: process.platform === 'win32',
    timeout: 10_000,
  },
  async () => {
    const root = await realpath(await mkdtemp(resolve(tmpdir(), 'address-earlier-group-test-')));
    const cache = resolve(root, 'temporary');
    let descendant;
    let child;
    try {
      await mkdir(resolve(root, 'apps/frontend/scripts'), { recursive: true });
      await mkdir(resolve(root, 'node_modules/expo/bin'), { recursive: true });
      await mkdir(cache);
      await copyFile(runner, resolve(root, 'apps/frontend/scripts/runner.mjs'));
      const marker = resolve(root, 'descendant.pid');
      const nextPhase = resolve(root, 'browser.started');
      await writeFile(
        resolve(root, 'node_modules/expo/bin/cli'),
        `
      const { spawn } = require('node:child_process');
      const fs = require('node:fs');
      const path = require('node:path');
      const output = process.argv[process.argv.indexOf('--output-dir') + 1];
      fs.mkdirSync(output);
      fs.writeFileSync(path.join(output, 'index.html'), '<title>fixture</title>');
      const worker = spawn(process.execPath, ['-e', ${JSON.stringify(`
        require('node:fs').writeFileSync(${JSON.stringify(marker)}, String(process.pid));
        process.on('SIGTERM', () => {});
        setInterval(() => {}, 1000);
      `)}], { stdio: 'ignore' });
      const ready = setInterval(() => {
        if (fs.existsSync(${JSON.stringify(marker)})) { clearInterval(ready); process.exit(0); }
      }, 10);
    `,
      );
      await writeFile(
        resolve(root, 'apps/frontend/scripts/check-address-recovery.mjs'),
        `
      import { writeFileSync } from 'node:fs';
      writeFileSync(${JSON.stringify(nextPhase)}, String(process.pid));
      setInterval(() => {}, 1000);
    `,
      );
      child = spawn(process.execPath, [resolve(root, 'apps/frontend/scripts/runner.mjs')], {
        env: { ...process.env, TMPDIR: cache },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      const completion = new Promise((done) => child.once('exit', done));
      let output = '';
      child.stdout.on('data', (data) => {
        output += data;
      });
      child.stderr.on('data', (data) => {
        output += data;
      });
      const deadline = Date.now() + 5000;
      let phaseStarted = false;
      while (!phaseStarted && Date.now() < deadline) {
        phaseStarted = Boolean(await readFile(nextPhase, 'utf8').catch(() => ''));
        if (!phaseStarted) await pause(20);
      }
      assert.ok(phaseStarted, `Second phase did not start: ${output}`);
      descendant = Number(await readFile(marker, 'utf8'));
      assert.throws(() => process.kill(descendant, 0), { code: 'ESRCH' });
      child.kill('SIGTERM');
      assert.equal(await completion, 143, output);
      assert.throws(() => process.kill(descendant, 0), { code: 'ESRCH' });
      assert.deepEqual(await readdir(cache), []);
    } finally {
      try {
        child?.kill('SIGKILL');
      } catch {}
      try {
        if (descendant) process.kill(descendant, 'SIGKILL');
      } catch {}
      await rm(root, { recursive: true, force: true });
    }
  },
);
