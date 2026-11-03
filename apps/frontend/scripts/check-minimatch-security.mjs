import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const root = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const patchPath = 'patches/minimatch@10.2.5.patch';
const patchHash = '6e9b5b0bb1b4da39bf8c426e8962f700abfa5864a6c80cfbdd90ba616bc6d0ad';
// Exact isaacs/minimatch 77a0f5c backport (bound the **/.. preprocessing pass
// and skip pairwise dedupe above 1,000 patterns), applied to both compiled
// modules and their type declarations. The fixed 11.0.1 (27 Oct 2026) is a
// major version and younger than the 7-day gate. The minified glob bundles Expo
// loads embed their own minimatch copy; patches/glob@13.0.6.patch carries the
// same fix there, and the bundle probe below exercises it.
const fileHashes = {
  'dist/esm/index.js': '212e3c577b86d562b0aab51656cf483f7bb12b69a26f816d1193496ff90e5fb5',
  'dist/commonjs/index.js': '8020da06ae4bde907949aebcf32c2aa187d10547e99cb67246c4d1d6d63201eb',
  'dist/esm/index.d.ts': '0266fcb2be9a18086fa06f0cebdbf0391bd0e2f1069f58acc81cad2861841446',
  'dist/commonjs/index.d.ts': '0266fcb2be9a18086fa06f0cebdbf0391bd0e2f1069f58acc81cad2861841446',
};
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

assert.equal(sha256(readFileSync(join(root, patchPath))), patchHash);
assert.match(
  readFileSync(join(root, 'pnpm-workspace.yaml'), 'utf8'),
  /^  minimatch@10\.2\.5: patches\/minimatch@10\.2\.5\.patch$/m,
);
assert.match(
  readFileSync(join(root, 'pnpm-lock.yaml'), 'utf8'),
  new RegExp(
    `^  minimatch@10\\.2\\.5:\\n    hash: ${patchHash}\\n    path: patches/minimatch@10\\.2\\.5\\.patch\\n`,
    'm',
  ),
);

// Resolve the minimatch package through the glob copy Expo's command-line tool
// depends on, which is the reported dependency path. glob's unminified entries
// and other Expo tools load this package.
const expoRequire = createRequire(require.resolve('@expo/cli/package.json'));
const globRequire = createRequire(expoRequire.resolve('glob/package.json'));
const minimatchDirectory = dirname(globRequire.resolve('minimatch/package.json'));
assert.equal(
  JSON.parse(readFileSync(join(minimatchDirectory, 'package.json'), 'utf8')).version,
  '10.2.5',
);
assert.equal(globRequire.resolve('minimatch'), join(minimatchDirectory, 'dist/commonjs/index.js'));
for (const [file, hash] of Object.entries(fileHashes)) {
  assert.equal(sha256(readFileSync(join(minimatchDirectory, file))), hash, file);
}

// Each `**/..` segment doubles the pattern set at optimizationLevel 2, and the
// unrepaired second phase then compares every pair. Count the pairwise calls
// and the generated patterns in a child process that a timeout bounds.
const probe = String.raw`
  const { Minimatch, minimatch } = require(process.argv[1]);
  const compares = { count: 0 };
  const partsMatch = Minimatch.prototype.partsMatch;
  Minimatch.prototype.partsMatch = function (...args) {
    compares.count += 1;
    return partsMatch.apply(this, args);
  };
  const hostile = '**/../a/b/'.repeat(15) + 'c';
  const start = performance.now();
  const large = new Minimatch(hostile, { optimizationLevel: 2 });
  const ms = Math.round(performance.now() - start);
  const largeCompares = compares.count;
  compares.count = 0;
  const capped = new Minimatch(hostile, { optimizationLevel: 2, braceExpandMax: 2000 });
  compares.count = 0;
  const small = new Minimatch('**/../a/b/c', { optimizationLevel: 2 });
  console.log(JSON.stringify({
    ms,
    largeParts: large.globParts.length,
    largeCompares,
    largeMatches: large.match('a/b/'.repeat(15) + 'c'),
    cappedParts: capped.globParts.length,
    smallParts: small.globParts.length,
    smallCompares: compares.count,
    plain: [
      minimatch('src/x.js', 'src/*.js', { optimizationLevel: 2 }),
      minimatch('src/y.ts', 'src/*.js', { optimizationLevel: 2 }),
      minimatch('a/b/c', '**/../a/b/c', { optimizationLevel: 2 }),
      minimatch('deep/x/y/z.js', '**/*.js'),
      minimatch('lib/a.js', '{lib,src}/*.js'),
      minimatch('other/a.js', '{lib,src}/*.js'),
    ],
  }));
`;
for (const [label, entry] of [
  ['commonjs', join(minimatchDirectory, 'dist/commonjs/index.js')],
  ['esm', join(minimatchDirectory, 'dist/esm/index.js')],
]) {
  const result = spawnSync(
    process.execPath,
    label === 'esm'
      ? [
          '--input-type=module',
          '--eval',
          `import { createRequire } from 'node:module';\nconst require = createRequire(process.argv[1]);\n${probe}`,
          '--',
          entry,
        ]
      : ['--eval', probe, '--', entry],
    { encoding: 'utf8', timeout: 10000 },
  );
  assert.equal(result.error, undefined, `${label}: the probe must finish, rather than time out`);
  assert.equal(result.status, 0, result.stderr);
  const outcome = JSON.parse(result.stdout);
  assert.ok(outcome.ms < 3000, `${label}: preprocessing took ${outcome.ms} ms`);
  assert.equal(
    outcome.largeCompares,
    0,
    `${label}: pairwise dedupe ran on ${outcome.largeParts} patterns`,
  );
  assert.equal(outcome.largeMatches, true, label);
  assert.ok(
    outcome.cappedParts <= 2000,
    `${label}: ${outcome.cappedParts} patterns above braceExpandMax`,
  );
  assert.equal(outcome.smallParts, 2, label);
  assert.ok(outcome.smallCompares > 0, `${label}: small sets must still dedupe`);
  assert.deepEqual(outcome.plain, [true, false, true, true, true, false], label);
  console.log(`${label}: ${JSON.stringify(outcome)}`);
}

// Expo's glob entry is a minified bundle with its own minimatch copy, so the
// package check above does not reach it. Build the hostile pattern through
// both bundles in a bounded child process: unrepaired, 15 segments make
// 32,768 patterns and take seconds; repaired, the default cap holds 10,000.
const globDirectory = dirname(expoRequire.resolve('glob/package.json'));
assert.equal(expoRequire.resolve('glob'), join(globDirectory, 'dist/commonjs/index.min.js'));
const bundleProbe = String.raw`
  const hostile = '**/../a/b/'.repeat(15) + 'c';
  const start = performance.now();
  const large = new Glob(hostile, { optimizationLevel: 2, cwd: process.cwd() });
  const ms = Math.round(performance.now() - start);
  const capped = new Glob(hostile, { optimizationLevel: 2, braceExpandMax: 2000, cwd: process.cwd() });
  const small = new Glob('**/../a/b/c', { optimizationLevel: 2, cwd: process.cwd() });
  console.log(JSON.stringify({
    ms,
    largePatterns: large.patterns.length,
    cappedPatterns: capped.patterns.length,
    smallPatterns: small.patterns.length,
    ordinary: globSync('scripts/check-minimatch-*.mjs', { cwd: process.argv[2] }),
  }));
`;
for (const [label, entry] of [
  ['commonjs bundle', join(globDirectory, 'dist/commonjs/index.min.js')],
  ['esm bundle', join(globDirectory, 'dist/esm/index.min.js')],
]) {
  const frontend = join(root, 'apps/frontend');
  const result = spawnSync(
    process.execPath,
    label === 'esm bundle'
      ? [
          '--input-type=module',
          '--eval',
          `const { Glob, globSync } = await import(process.argv[1]);${bundleProbe}`,
          '--',
          pathToFileURL(entry).href,
          frontend,
        ]
      : [
          '--eval',
          `const { Glob, globSync } = require(process.argv[1]);${bundleProbe}`,
          '--',
          entry,
          frontend,
        ],
    { encoding: 'utf8', timeout: 10000 },
  );
  assert.equal(result.error, undefined, `${label}: the probe must finish, rather than time out`);
  assert.equal(result.status, 0, result.stderr);
  const outcome = JSON.parse(result.stdout);
  assert.ok(outcome.ms < 3000, `${label}: preprocessing took ${outcome.ms} ms`);
  assert.equal(outcome.largePatterns, 10000, `${label}: the default cap did not hold`);
  assert.ok(
    outcome.cappedPatterns <= 2000,
    `${label}: ${outcome.cappedPatterns} patterns above braceExpandMax`,
  );
  assert.equal(outcome.smallPatterns, 2, label);
  assert.deepEqual(outcome.ordinary, ['scripts/check-minimatch-security.mjs'], label);
  console.log(`${label}: ${JSON.stringify(outcome)}`);
}

console.log(
  'GHSA-g3hv-75wg-m249: exact upstream preprocessing-limit backport verified in the minimatch package and in the minimatch copy inside both glob bundles Expo loads; hostile patterns stay bounded and ordinary matching still works',
);
