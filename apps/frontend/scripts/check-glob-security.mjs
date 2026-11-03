import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const root = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const patchPath = 'patches/glob@13.0.6.patch';
const patchHash = '5d5d1fa72fbd15472192cbe9daa0937769fd7ffe83111970b03396f4da6163c6';
// Exact isaacs/node-glob 4682e8c backport (abort branches return after cb()),
// applied to both compiled walkers and both minified entry bundles. The fixed
// 14.0.2 (27 Oct 2026) is a major version and younger than the 7-day gate.
const fileHashes = {
  'dist/esm/walker.js': '8afedbdf3bb2bddaf37ee3ef4b393b76a5a99c80ef12aaedd2160a77c2effadb',
  'dist/commonjs/walker.js': '4eca6e1f2fd9c9ef7469977a12c7e9bd6503bc7a9257ccdc8e79b346ec34fccd',
  'dist/esm/index.min.js': '948cfcfa16c15cb2a3ac020c08640e1e97527b20160de00fbdb5aae0a32f6eef',
  'dist/commonjs/index.min.js': '682658aec006a5ec59de9e0b5e2ebaff1a0085c63c4c68a1731d42f916261a6a',
};
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

assert.equal(sha256(readFileSync(join(root, patchPath))), patchHash);
assert.match(
  readFileSync(join(root, 'pnpm-workspace.yaml'), 'utf8'),
  /^  glob@13\.0\.6: patches\/glob@13\.0\.6\.patch$/m,
);
assert.match(
  readFileSync(join(root, 'pnpm-lock.yaml'), 'utf8'),
  new RegExp(
    `^  glob@13\\.0\\.6:\\n    hash: ${patchHash}\\n    path: patches/glob@13\\.0\\.6\\.patch\\n`,
    'm',
  ),
);

// The copy Expo's command-line tool loads is the minified CommonJS entry.
const expoRequire = createRequire(require.resolve('@expo/cli/package.json'));
const globDirectory = dirname(expoRequire.resolve('glob/package.json'));
assert.equal(
  JSON.parse(readFileSync(join(globDirectory, 'package.json'), 'utf8')).version,
  '13.0.6',
);
assert.equal(expoRequire.resolve('glob'), join(globDirectory, 'dist/commonjs/index.min.js'));
for (const [file, hash] of Object.entries(fileHashes)) {
  assert.equal(sha256(readFileSync(join(globDirectory, file))), hash, file);
}

const directory = mkdtempSync(join(tmpdir(), 'alethical-glob-security-'));
try {
  const make = (dir, depth) => {
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'f'), '');
    if (depth) {
      make(join(dir, 'a'), depth - 1);
      make(join(dir, 'b'), depth - 1);
    }
  };
  make(directory, 5);
  const expected = 126;

  // Count directory reads through glob's own `fs` option and abort on the
  // first one. Unrepaired 13.0.6 rejects, then keeps reading the whole tree.
  const counted = (controller) => {
    const counter = { calls: 0 };
    const abortFirst = () => {
      if (++counter.calls === 1) controller.abort(new Error('aborted by the check'));
    };
    const countedFs = {
      ...fs,
      readdir: (...args) => {
        abortFirst();
        return fs.readdir(...args);
      },
      readdirSync: (...args) => {
        abortFirst();
        return fs.readdirSync(...args);
      },
    };
    return { counter, countedFs };
  };

  for (const [label, { glob, globSync, globStreamSync }] of [
    ['commonjs', expoRequire('glob')],
    ['esm', await import(pathToFileURL(join(globDirectory, 'dist/esm/index.min.js')).href)],
  ]) {
    assert.equal(globSync('**', { cwd: directory }).length, expected, label);
    assert.deepEqual(globSync('a/*/f', { cwd: directory }).sort(), ['a/a/f', 'a/b/f'], label);

    const asyncController = new AbortController();
    const asyncCount = counted(asyncController);
    await assert.rejects(
      glob('**', { cwd: directory, signal: asyncController.signal, fs: asyncCount.countedFs }),
      /aborted by the check/,
      label,
    );
    const atReject = asyncCount.counter.calls;
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.equal(asyncCount.counter.calls, atReject, `${label}: reads continued after the abort`);
    assert.equal(atReject, 1, `${label}: ${atReject} reads before the abort rejected`);

    const syncController = new AbortController();
    const syncCount = counted(syncController);
    await new Promise((resolve, reject) => {
      const stream = globStreamSync('**', {
        cwd: directory,
        signal: syncController.signal,
        fs: syncCount.countedFs,
      });
      stream.on('error', (error) => {
        try {
          assert.match(error.message, /aborted by the check/, label);
          assert.equal(syncCount.counter.calls, 1, `${label}: sync stream kept reading`);
          resolve();
        } catch (failure) {
          reject(failure);
        }
      });
      stream.on('end', () => reject(new Error(`${label}: the aborted sync stream ended normally`)));
      stream.resume();
    });

    // A paused stream still delivers every match once it is read.
    const stream = (await import('node:stream')).Readable.from(
      (await import(pathToFileURL(join(globDirectory, 'dist/esm/index.min.js')).href)).globStream(
        '**',
        { cwd: directory },
      ),
    );
    await new Promise((resolve) => setTimeout(resolve, 50));
    const found = [];
    for await (const path of stream) found.push(path);
    assert.equal(new Set(found).size, expected, label);
  }
} finally {
  rmSync(directory, { recursive: true, force: true });
}

console.log(
  'GHSA-3g3m-2fjr-6pw4: exact upstream abort-return backport verified in both glob bundles Expo loads; aborted walks stop reading and ordinary matching still works',
);
