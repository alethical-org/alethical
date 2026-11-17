import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const rootRequire = createRequire(resolve(root, 'package.json'));
const lock = readFileSync(resolve(root, 'pnpm-lock.yaml'), 'utf8');
const sha = (path) => createHash('sha256').update(readFileSync(path)).digest('hex');
const patch = 'patches/picomatch@4.0.7.patch';
const patchHash = '450f63f7600e653f7a055bdbcd50dd7f5f907f673aac382e04a704d310aa3fa4';
const parserHash = '4944f002b5a418638b7ba20d635099f83bb1cba056616e65dbcc70f49b9003de';
assert.equal(sha(resolve(root, patch)), patchHash);
assert.ok(lock.includes(`  picomatch@4.0.7:\n    hash: ${patchHash}\n    path: ${patch}\n`));

const packageFile = realpathSync(rootRequire.resolve('picomatch/package.json'));
const seen = new Set();
const consumers = new Set();
function visitModules(modules) {
  if (!existsSync(modules) || seen.has(realpathSync(modules))) return;
  seen.add(realpathSync(modules));
  for (const entry of readdirSync(modules, { withFileTypes: true })) {
    if (entry.name.startsWith('.') || !(entry.isDirectory() || entry.isSymbolicLink())) continue;
    const path = join(modules, entry.name);
    if (entry.name.startsWith('@')) {
      visitModules(path);
      continue;
    }
    const manifest = join(path, 'package.json');
    if (!existsSync(manifest)) continue;
    const pkg = JSON.parse(readFileSync(manifest, 'utf8'));
    if (pkg.name === 'picomatch') {
      assert.equal(
        realpathSync(manifest),
        packageFile,
        'unexpected additional picomatch installation',
      );
    }
    if (
      [pkg.dependencies, pkg.optionalDependencies, pkg.peerDependencies].some(
        (deps) => deps?.picomatch,
      )
    ) {
      assert.equal(
        realpathSync(createRequire(manifest).resolve('picomatch/package.json')),
        packageFile,
        pkg.name,
      );
      consumers.add(pkg.name);
    }
    visitModules(join(path, 'node_modules'));
  }
}
for (const workspace of [
  '',
  'apps/frontend',
  'apps/finance',
  ...readdirSync(resolve(root, 'packages')).map((name) => `packages/${name}`),
]) {
  visitModules(resolve(root, workspace, 'node_modules'));
}
for (const name of ['jest-util', 'micromatch', 'lint-staged', '@expo/cli', '@expo/metro-config']) {
  assert.ok(consumers.has(name), `missing build tool: ${name}`);
}
assert.equal(rootRequire(packageFile).version, '4.0.7');
assert.equal(sha(resolve(packageFile, '../lib/parse.js')), parserHash);
const match = rootRequire('picomatch');
assert.ok(match('src/**/*.{js,ts}')('src/pages/home.ts'));
assert.ok(!match('**/*.tsx')('src/home.css'));
assert.ok(match('+(ab|cd).js')('abcdab.js'));
assert.throws(() => match('+([ab]).js'), /fixed-width literal alternatives/);

// These consumers previously used 2.x. Exercise their public entry points.
const files = ['src/page.ts', 'src/page.test.ts', 'docs/readme.md'];
assert.deepEqual(rootRequire('micromatch')(files, ['src/**/*.ts', '!**/*.test.ts']), [
  'src/page.ts',
]);
const jestMatch = rootRequire('jest-util').globsToMatcher(['src/**/*.ts', '!**/*.test.ts']);
assert.deepEqual(files.filter(jestMatch), ['src/page.ts']);
console.log(
  `Verified the single patched picomatch parser for all ${consumers.size} installed build-tool consumers.`,
);
