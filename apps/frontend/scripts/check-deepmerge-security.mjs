import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const patchPath = 'patches/deepmerge@4.3.1.patch';
const patchHash = '88b0436747f9b7041c39bdf27baadee2fc9632348fa0615b0f69b78ecc7210a8';
const fileHashes = {
  'dist/cjs.js': '976c91f003a1fc609ebe2017babda35eb15dcb972c4bc868637626d3850c2756',
  'dist/umd.js': '88e2fb95a180eaa6d0e739d051a2faf9e2d9c7a1111022a4709d56d7da53dfe0',
  'index.js': '281deda15dc48e3f932e7e36310d6bcb5cbc7c851280fd0ee59fd2bf6f56bba1',
};
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

// No upstream version fixes GHSA-gcqx-w48m-w2h4. Accept only the exact local
// "__proto__" guard, then exercise the copy Expo's app-config merging loads.
assert.equal(sha256(readFileSync(join(root, patchPath))), patchHash);
assert.match(
  readFileSync(join(root, 'pnpm-workspace.yaml'), 'utf8'),
  /^  deepmerge@4\.3\.1: patches\/deepmerge@4\.3\.1\.patch$/m,
);
assert.match(
  readFileSync(join(root, 'pnpm-lock.yaml'), 'utf8'),
  new RegExp(
    `^  deepmerge@4\\.3\\.1:\\n    hash: ${patchHash}\\n    path: patches/deepmerge@4\\.3\\.1\\.patch\\n`,
    'm',
  ),
);

const configRequire = createRequire(require.resolve('@expo/config/package.json'));
const deepmergeRoot = dirname(configRequire.resolve('deepmerge/package.json'));
assert.equal(configRequire('deepmerge/package.json').version, '4.3.1');
for (const [file, hash] of Object.entries(fileHashes)) {
  assert.equal(sha256(readFileSync(join(deepmergeRoot, file))), hash, file);
}
assert.equal(configRequire.resolve('deepmerge'), join(deepmergeRoot, 'dist/cjs.js'));

// index.js needs a development-only package that is never installed, so only
// its fingerprint is checked. Both built copies run.
const poisoned = () => JSON.parse('{"__proto__":{"polluted":"x"}}');
for (const merge of [configRequire('deepmerge'), require(join(deepmergeRoot, 'dist/umd.js'))]) {
  const fromTarget = merge(poisoned(), {});
  assert.equal(fromTarget.polluted, undefined);
  assert.equal(Object.getPrototypeOf(fromTarget), Object.prototype);
  const fromSource = merge(Object.create(null), poisoned());
  assert.equal(fromSource.polluted, undefined);
  assert.equal(Object.getPrototypeOf(fromSource), Object.prototype);
  assert.equal(merge({}, poisoned()).polluted, undefined);
  assert.equal({}.polluted, undefined);

  const nullTarget = Object.create(null);
  nullTarget.kept = 1;
  assert.deepEqual(merge(nullTarget, { added: 2 }), { kept: 1, added: 2 });
  assert.deepEqual(
    merge(
      { web: { bundler: 'metro', list: [1] }, name: 'a' },
      { web: { output: 'static', list: [2] } },
    ),
    { web: { bundler: 'metro', output: 'static', list: [1, 2] }, name: 'a' },
  );
  assert.deepEqual(merge([1, { a: 1 }], [2]), [1, { a: 1 }, 2]);
  assert.deepEqual(merge.all([{ a: 1 }, { b: 2 }]), { a: 1, b: 2 });

  const source = { nested: { value: 1 } };
  assert.notEqual(merge({}, source).nested, source.nested);
  assert.equal(merge({}, source, { clone: false }).nested, source.nested);
}

console.log(
  'GHSA-gcqx-w48m-w2h4: exact __proto__ guard passes through the deepmerge Expo app config loads; ordinary merging still works',
);
