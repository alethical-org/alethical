import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const patchPath = 'patches/braces@3.0.3.patch';
const patchHash = 'ea29e28e84b25bb03e32f352eed8fc0dce67ad38b6cad073da15faf3e5ddcba2';
const parseHash = 'bc97f126475a21ed4a6ef83c15c754795bcba41878c21e3b522b238a027eec72';
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

// No upstream version fixes GHSA-vfj7-8cjw-p6xm. Accept only the exact local
// depth guard, then exercise the copies used by both Expo file scanners.
assert.equal(sha256(readFileSync(join(root, patchPath))), patchHash);
assert.match(
  readFileSync(join(root, 'pnpm-workspace.yaml'), 'utf8'),
  /^  braces@3\.0\.3: patches\/braces@3\.0\.3\.patch$/m,
);
assert.match(
  readFileSync(join(root, 'pnpm-lock.yaml'), 'utf8'),
  new RegExp(
    `^  braces@3\\.0\\.3:\\n    hash: ${patchHash}\\n    path: patches/braces@3\\.0\\.3\\.patch\\n`,
    'm',
  ),
);

const deeplyNestedBraces = '{'.repeat(4000) + 'a' + '}'.repeat(4000);
const deeplyNestedParens = '('.repeat(4000) + 'a' + ')'.repeat(4000);
for (const consumer of ['@expo/metro-file-map', 'metro-file-map']) {
  const consumerRoot = dirname(require.resolve(`${consumer}/package.json`));
  const consumerRequire = createRequire(join(consumerRoot, 'package.json'));
  const micromatchRequire = createRequire(consumerRequire.resolve('micromatch'));
  const manifest = micromatchRequire('braces/package.json');
  assert.equal(manifest.version, '3.0.3');
  assert.equal(
    sha256(readFileSync(join(dirname(micromatchRequire.resolve('braces')), 'lib/parse.js'))),
    parseHash,
  );

  const micromatch = consumerRequire('micromatch');
  const braces = micromatchRequire('braces');
  assert.deepEqual(micromatch.braces('src/{a,b}.js'), ['src/(a|b).js']);
  for (const expand of [false, true]) {
    for (const [parse, input] of [
      [micromatch.braces, deeplyNestedBraces],
      [braces, deeplyNestedParens],
    ]) {
      assert.throws(
        () => parse(input, { expand }),
        (error) =>
          error instanceof SyntaxError && error.message === 'Input nesting exceeds 100 levels',
      );
    }
  }

  // The file scanner uses micromatch.some(), not the braces API above.
  const scannerPath =
    consumer === '@expo/metro-file-map' ? 'build/watchers/common.js' : 'src/watchers/common.js';
  const { includedByGlob } = require(join(consumerRoot, scannerPath));
  assert.equal(includedByGlob('f', ['src/{a,b}.js'], false, 'src/a.js'), true);
  assert.equal(includedByGlob('f', ['src/{a,b}.js'], false, 'src/c.js'), false);
  assert.equal(includedByGlob('f', [deeplyNestedBraces], false, 'src/a.js'), false);
}

console.log(
  'GHSA-vfj7-8cjw-p6xm: exact depth guard passes through both Expo dependency trees; file matching still works',
);
