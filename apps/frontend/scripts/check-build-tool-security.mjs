import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const easRequire = createRequire(require.resolve('eas-cli/package.json'));

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

assertPackageVersion(easRequire, 'ts-deepmerge', '8.0.0');
assertPackageVersion(easRequire, 'diff', '8.0.3');

for (const owner of ['eas-cli', '@expo/bunyan', '@expo/rudder-sdk-node', '@expo/steps']) {
  const ownerRequire = createRequire(require.resolve(`${owner}/package.json`));
  assertPackageVersion(ownerRequire, 'uuid', '11.1.1');
}
const xcodeRequire = createRequire(require.resolve('xcode/package.json'));
assertPackageVersion(xcodeRequire, 'uuid', '11.1.1');

const plistRequire = createRequire(easRequire.resolve('@expo/plist/package.json'));
assertPackageVersion(plistRequire, '@xmldom/xmldom', '0.8.13');

const deepMerge = easRequire('ts-deepmerge').default;
assert.equal(typeof deepMerge, 'function', 'EAS CLI needs the ts-deepmerge default export');
assert.deepEqual(
  deepMerge({ expo: { name: 'Alethical' } }, { expo: { slug: 'alethical' } }),
  { expo: { name: 'Alethical', slug: 'alethical' } },
  'EAS CLI needs nested project settings to merge',
);
assert.deepEqual(
  deepMerge(JSON.parse('{"hasOwnProperty":null}'), { safe: true }),
  { safe: true },
  'The ts-deepmerge security fix must keep unsafe object keys out',
);

const { diffLines } = easRequire('diff');
assert.equal(typeof diffLines, 'function', 'EAS CLI needs the diffLines export');
assert.equal(diffLines('before\n', 'after\n').length, 2, 'EAS CLI needs line changes to compare');

const uuid = easRequire('uuid');
for (const name of ['v1', 'v4', 'validate', 'version']) {
  assert.equal(typeof uuid[name], 'function', `EAS CLI needs the uuid ${name} export`);
}
assert.equal(uuid.validate(uuid.v1()), true, 'Expo telemetry needs valid version 1 identifiers');
const version4Uuid = uuid.v4();
assert.equal(uuid.validate(version4Uuid), true, 'EAS CLI needs valid version 4 identifiers');
assert.equal(uuid.version(version4Uuid), 4, 'EAS CLI checks that submit identifiers are version 4');

const xcode = require('xcode');
const xcodeProject = xcode.project('unused');
xcodeProject.hash = { project: { objects: {} } };
assert.match(
  xcodeProject.generateUuid(),
  /^[A-F0-9]{24}$/,
  'Xcode project files need 24-character identifiers',
);

const plistModule = easRequire('@expo/plist');
const plist = plistModule.default ?? plistModule;
const plistXml = plist.build({ Name: 'Alethical' });
assert.equal(plist.parse(plistXml).Name, 'Alethical', 'Expo needs property lists to round-trip');

console.log('Build-tool security compatibility checks passed.');
