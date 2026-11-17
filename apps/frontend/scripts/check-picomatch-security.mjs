import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const rootRequire = createRequire(resolve(root, 'package.json'));
const lock = readFileSync(resolve(root, 'pnpm-lock.yaml'), 'utf8');
const sha = (path) => createHash('sha256').update(readFileSync(path)).digest('hex');
const versions = {
  '2.3.2': [
    '2d6e61abe18f37836c59ef9daa507427777178cbf6f2863b490d59bb32aef9ba',
    '2375ed5433153e3e00b82df97e70387e1a1f10058e26237fc75b1d2fdd4345e0',
  ],
  '4.0.5': [
    '450f63f7600e653f7a055bdbcd50dd7f5f907f673aac382e04a704d310aa3fa4',
    '6f7113c7bf80164786069be54e49de0dce961695fc8612d21e4bf6cfe25f0387',
  ],
  '4.0.7': [
    '450f63f7600e653f7a055bdbcd50dd7f5f907f673aac382e04a704d310aa3fa4',
    '4944f002b5a418638b7ba20d635099f83bb1cba056616e65dbcc70f49b9003de',
  ],
};
for (const [version, [patchHash]] of Object.entries(versions)) {
  const patch = `patches/picomatch@${version}.patch`;
  assert.equal(sha(resolve(root, patch)), patchHash);
  assert.ok(lock.includes(`  picomatch@${version}:\n    hash: ${patchHash}\n    path: ${patch}\n`));
}

// Resolve the package as its actual consumers do, including hoisted copies.
for (const [consumer, expected] of [
  ['lint-staged', '4.0.7'],
  ['@expo/cli', '4.0.5'],
  ['@expo/metro-config', '4.0.5'],
  ['jest-util', '2.3.2'],
  ['micromatch', '2.3.2'],
]) {
  const consumerRequire = createRequire(rootRequire.resolve(consumer));
  const directory = dirname(consumerRequire.resolve('picomatch/package.json'));
  const match = consumerRequire('picomatch');
  assert.equal(consumerRequire('picomatch/package.json').version, expected, consumer);
  assert.equal(sha(resolve(directory, 'lib/parse.js')), versions[expected][1], consumer);
  assert.ok(match('src/**/*.{js,ts}')('src/pages/home.ts'));
  assert.ok(!match('**/*.tsx')('src/home.css'));
  assert.ok(match('+(ab|cd).js')('abcdab.js'));
  assert.throws(() => match('+([ab]).js'), /fixed-width literal alternatives/);
}
console.log('Verified all installed picomatch parser versions and ordinary build-file matching.');
