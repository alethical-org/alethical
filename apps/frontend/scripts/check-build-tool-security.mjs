import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const frontendDirectory = join(dirname(fileURLToPath(import.meta.url)), '..');

function readPackageVersion(entryPath, packageName) {
  let directory = dirname(entryPath);
  while (directory !== dirname(directory)) {
    const manifestPath = join(directory, 'package.json');
    if (existsSync(manifestPath)) {
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
      if (manifest.name === packageName) {
        return manifest.version;
      }
    }
    directory = dirname(directory);
  }
  throw new Error(`Could not find the installed version of ${packageName}`);
}

function assertPackageVersion(packageRequire, packageName, expectedVersion) {
  assert.equal(
    readPackageVersion(packageRequire.resolve(packageName), packageName),
    expectedVersion,
    `${packageName} must stay on its reviewed security fix`,
  );
}

// Metro uses both byte buffers and file paths. image-size 2.x accepts buffers
// only, so exercise the real Metro calls after applying its file-reading bridge.
const metroRequire = createRequire(require.resolve('metro/package.json'));
assertPackageVersion(metroRequire, 'image-size', '2.0.3');
const metroAssets = require('metro/private/Assets');
const iconPath = join(frontendDirectory, 'public/icon-192.png');
assert.deepEqual(metroAssets.getAssetSize('png', readFileSync(iconPath), iconPath), {
  width: 192,
  height: 192,
});
const iconData = await metroAssets.getAssetData(iconPath, 'icon-192.png', [], null, '/assets');
assert.equal(iconData.width, 192, 'Metro must read image dimensions from a file');
assert.equal(iconData.height, 192);

const navigationRequire = createRequire(require.resolve('@react-navigation/core'));
const queryStringEntry = navigationRequire.resolve('query-string');
const queryStringRequire = createRequire(queryStringEntry);
assertPackageVersion(queryStringRequire, 'decode-uri-component', '0.5.0');

// React Navigation still uses query-string's CommonJS entry point. The small
// package patch selects the fixed decoder's ESM default export without changing
// its upstream decoding algorithm.
const queryString = navigationRequire('query-string');
assert.deepEqual(
  { ...queryString.parse('q=Saint+Paul%20%C3%A5%20%F0%9F%98%80&encoded%20key=%2B') },
  { 'encoded key': '+', q: 'Saint Paul å 😀' },
  'Navigation must decode Unicode, spaces, plus signs, and query parameter names',
);
assert.deepEqual(
  { ...queryString.parse('q=%E0%A4%A&literal=%25&bad=%GG') },
  { bad: '%GG', literal: '%', q: '%E0%A4%A' },
  'Malformed query text must remain readable without throwing',
);
assert.deepEqual(
  { ...queryString.parse('q=first&q=second&flag&empty=') },
  { empty: '', flag: null, q: ['first', 'second'] },
  'Navigation must preserve repeated, empty, and valueless query parameters',
);
assert.equal(
  queryString.stringify({ q: 'Saint Paul å 😀', symbol: '+' }, { sort: false }),
  'q=Saint%20Paul%20%C3%A5%20%F0%9F%98%80&symbol=%2B',
  'Navigation must still write shareable query strings',
);

// Keep the deliberately malformed input in a child process. A future regression
// must fail within 5 seconds instead of freezing the entire security check.
const malformedQueryResult = spawnSync(
  process.execPath,
  [
    '--input-type=commonjs',
    '--eval',
    `const assert = require('node:assert/strict');
     const queryString = require(process.argv[1]);
     const malformed = '%80'.repeat(2048);
     assert.equal(queryString.parse('q=' + malformed).q, malformed);`,
    queryStringEntry,
  ],
  { encoding: 'utf8', timeout: 5000 },
);
assert.equal(
  malformedQueryResult.status,
  0,
  `Malformed query text must finish within 5 seconds: ${
    malformedQueryResult.error?.message || malformedQueryResult.stderr
  }`,
);

const expoEntry = require.resolve('expo/bin/cli');
const expoConfigResult = spawnSync(
  process.execPath,
  [expoEntry, 'config', '--type', 'public', '--json'],
  {
    cwd: frontendDirectory,
    encoding: 'utf8',
    env: { ...process.env, CI: '1' },
  },
);
assert.equal(
  expoConfigResult.status,
  0,
  `Expo could not load app.json:\n${expoConfigResult.stderr || expoConfigResult.stdout}`,
);
const expoConfig = JSON.parse(expoConfigResult.stdout);
assert.equal(expoConfig.name, 'Alethical', "Expo must load Alethical's app configuration");
assert.equal(
  expoConfig.extra?.eas?.projectId,
  'e9bfa83e-58af-44d9-8587-8207217bb836',
  "Expo must retain Alethical's EAS project link",
);

console.log('Web build-tool security compatibility checks passed.');
