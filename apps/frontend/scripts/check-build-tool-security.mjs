import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const easRequire = createRequire(require.resolve('eas-cli/package.json'));
const frontendDirectory = join(dirname(fileURLToPath(import.meta.url)), '..');

function runNodeCommand(entryPath, args, description) {
  const result = spawnSync(process.execPath, [entryPath, ...args], {
    cwd: frontendDirectory,
    encoding: 'utf8',
    env: { ...process.env, CI: '1' },
  });
  assert.equal(result.status, 0, `${description} failed:\n${result.stderr || result.stdout}`);
  return `${result.stdout}\n${result.stderr}`;
}

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

const easEntry = easRequire.resolve('./bin/run');
for (const [args, expectedText, description] of [
  [['config', '--help'], /display project configuration/, 'EAS configuration command'],
  [['build', '--help'], /start a build/, 'EAS build command'],
  [['submit', '--help'], /submit app binary/, 'EAS submit command'],
]) {
  assert.match(runNodeCommand(easEntry, args, description), expectedText);
}

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

const easConfig = JSON.parse(readFileSync(join(frontendDirectory, 'eas.json'), 'utf8'));
for (const profile of ['simulator', 'preview', 'production']) {
  assert.ok(easConfig.build?.[profile], `eas.json must keep the ${profile} build profile`);
}
assert.ok(
  easConfig.submit?.production?.ios,
  'eas.json must keep the production iOS submit profile',
);

console.log('Build-tool security compatibility checks passed.');
