import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const checker = 'apps/frontend/scripts/check-source-map-security.mjs';

function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), 'alethical-source-map-security-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  for (const path of [checker]) {
    mkdirSync(dirname(join(directory, path)), { recursive: true });
    cpSync(join(root, path), join(directory, path));
  }
  for (const name of ['source-map-js', 'css-tree', 'mdn-data', 'postcss', 'nanoid', 'picocolors']) {
    cpSync(
      dirname(require.resolve(`${name}/package.json`)),
      join(directory, 'node_modules', name),
      {
        recursive: true,
      },
    );
  }
  const jsdom = join(directory, 'node_modules/jsdom');
  mkdirSync(jsdom, { recursive: true });
  writeFileSync(join(jsdom, 'package.json'), JSON.stringify({ name: 'jsdom', main: 'index.js' }));
  writeFileSync(join(jsdom, 'index.js'), '');
  return directory;
}

function change(directory, path, transform) {
  const target = join(directory, path);
  const original = readFileSync(target, 'utf8');
  const changed = transform(original);
  assert.notEqual(changed, original);
  writeFileSync(target, changed);
}

function runChecker(directory) {
  const result = spawnSync(process.execPath, [join(directory, checker)], {
    cwd: directory,
    encoding: 'utf8',
    timeout: 15000,
  });
  assert.equal(result.error, undefined, 'The guard must finish within its time bound');
  return result;
}

test('the published 1.2.2 repair passes with both real CSS consumers', (t) => {
  const result = runChecker(fixture(t));
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /published 1.2.2 repair passes/);
});

const rejected = [
  [
    'changed installed version',
    (dir) =>
      change(dir, 'node_modules/source-map-js/package.json', (text) => {
        const manifest = JSON.parse(text);
        manifest.version = '1.2.1';
        return JSON.stringify(manifest);
      }),
  ],
  [
    'missing offset validation',
    (dir) =>
      change(dir, 'node_modules/source-map-js/lib/source-map-consumer.js', (text) =>
        text.replace(
          'if (!isValidOffset(offsetLine) || !isValidOffset(offsetColumn))',
          'if (false)',
        ),
      ),
  ],
  [
    'missing nested offset limit',
    (dir) =>
      change(dir, 'node_modules/source-map-js/lib/source-map-consumer.js', (text) =>
        text.replace('if (totalOffsetLine > MAX_SECTION_OFFSET_LINE)', 'if (false)'),
      ),
  ],
  [
    'CSS parser resolving a different private package',
    (dir) => {
      const privatePackage = 'node_modules/css-tree/node_modules/source-map-js';
      cpSync(join(dir, 'node_modules/source-map-js'), join(dir, privatePackage), {
        recursive: true,
      });
      change(dir, `${privatePackage}/lib/source-map-consumer.js`, (text) =>
        text.replace(
          'if (!isValidOffset(offsetLine) || !isValidOffset(offsetColumn))',
          'if (false)',
        ),
      );
    },
  ],
  [
    'PostCSS resolving a different private package',
    (dir) => {
      const privatePackage = 'node_modules/postcss/node_modules/source-map-js';
      cpSync(join(dir, 'node_modules/source-map-js'), join(dir, privatePackage), {
        recursive: true,
      });
      change(dir, `${privatePackage}/lib/source-map-consumer.js`, (text) =>
        text.replace(
          'if (!isValidOffset(offsetLine) || !isValidOffset(offsetColumn))',
          'if (false)',
        ),
      );
    },
  ],
];
for (const [name, mutate] of rejected) {
  test(`the guard blocks ${name}`, (t) => {
    const directory = fixture(t);
    mutate(directory);
    const result = runChecker(directory);
    assert.equal(result.status, 1, result.stdout);
    assert.doesNotMatch(result.stdout, /published 1.2.2 repair passes/);
  });
}
