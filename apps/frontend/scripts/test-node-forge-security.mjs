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
const checkerPath = 'apps/frontend/scripts/check-node-forge-security.mjs';
const patchPath = 'patches/node-forge@1.4.0.patch';
const forgeDirectory = dirname(require.resolve('node-forge/package.json'));
const repairedCondition =
  "obj.value.length !== 2 ||\n            obj.value[0].value.length !==\n              (('parameters' in capture) ? 2 : 1)) {";

function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), 'alethical-forge-security-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  for (const path of [checkerPath, patchPath, 'pnpm-workspace.yaml', 'pnpm-lock.yaml']) {
    mkdirSync(dirname(join(directory, path)), { recursive: true });
    cpSync(join(root, path), join(directory, path));
  }
  cpSync(forgeDirectory, join(directory, 'node_modules/node-forge'), { recursive: true });
  for (const consumer of ['@expo/cli', '@expo/code-signing-certificates']) {
    const consumerDirectory = join(directory, 'node_modules', consumer);
    mkdirSync(consumerDirectory, { recursive: true });
    writeFileSync(join(consumerDirectory, 'package.json'), JSON.stringify({ name: consumer }));
  }
  return directory;
}

function change(directory, path, transform) {
  const target = join(directory, path);
  const original = readFileSync(target, 'utf8');
  const changed = transform(original);
  assert.notEqual(changed, original, `The fixture mutation must change ${path}`);
  writeFileSync(target, changed);
}

function runChecker(directory) {
  const result = spawnSync(process.execPath, [join(directory, checkerPath)], {
    cwd: directory,
    encoding: 'utf8',
    timeout: 15000,
  });
  assert.equal(result.error, undefined, 'The checker must finish, rather than time out');
  assert.equal(result.signal, null);
  return result;
}

test('the exact installed repair passes for both Expo consumers', (t) => {
  const result = runChecker(fixture(t));
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /exact installed repair and valid\/malformed signatures passed/);
});

const rejectedFixtures = [
  ['missing patch', (directory) => rmSync(join(directory, patchPath)), /ENOENT/],
  [
    'drifted patch',
    (directory) => change(directory, patchPath, (text) => `${text}\n`),
    /AssertionError/,
  ],
  [
    'missing workspace patch binding',
    (directory) =>
      change(directory, 'pnpm-workspace.yaml', (text) =>
        text.replace(/^  node-forge@1\.4\.0: patches\/node-forge@1\.4\.0\.patch\n/m, ''),
      ),
    /AssertionError/,
  ],
  [
    'changed lock patch hash',
    (directory) =>
      change(directory, 'pnpm-lock.yaml', (text) =>
        text.replace(/(  node-forge@1\.4\.0:\n    hash: )[a-f0-9]+/, `$1${'0'.repeat(64)}`),
      ),
    /AssertionError/,
  ],
  [
    'missing installed dependency',
    (directory) => rmSync(join(directory, 'node_modules/node-forge'), { recursive: true }),
    /MODULE_NOT_FOUND/,
  ],
  [
    'changed installed package version',
    (directory) =>
      change(directory, 'node_modules/node-forge/package.json', (text) => {
        const manifest = JSON.parse(text);
        manifest.version = '1.4.1';
        return JSON.stringify(manifest);
      }),
    /AssertionError/,
  ],
  [
    'stock RSA verification condition',
    (directory) =>
      change(directory, 'node_modules/node-forge/lib/rsa.js', (text) =>
        text.replace(repairedCondition, 'obj.value.length !== 2) {'),
      ),
    /AssertionError/,
  ],
  [
    'drifted installed RSA source',
    (directory) => change(directory, 'node_modules/node-forge/lib/rsa.js', (text) => `${text}\n`),
    /AssertionError/,
  ],
  [
    'a consumer resolving an unpatched private dependency copy',
    (directory) => {
      const packageDirectory = join(
        directory,
        'node_modules/@expo/code-signing-certificates/node_modules/node-forge',
      );
      cpSync(join(directory, 'node_modules/node-forge'), packageDirectory, { recursive: true });
      change(packageDirectory, 'lib/rsa.js', (text) =>
        text.replace(repairedCondition, 'obj.value.length !== 2) {'),
      );
    },
    /AssertionError/,
  ],
];

for (const [name, mutate, expectedError] of rejectedFixtures) {
  test(`the checker blocks ${name}`, (t) => {
    const directory = fixture(t);
    mutate(directory);
    const result = runChecker(directory);
    assert.equal(result.status, 1, result.stdout);
    assert.match(result.stderr, expectedError);
    assert.doesNotMatch(result.stdout, /signatures passed/);
  });
}

// Use a known test key to sign malformed DigestInfo with valid padding. This
// exercises the parser through default verification options, rather than
// claiming to generate an attack without a private key.
const signatureProbe = String.raw`
  const { generateKeyPairSync } = require('node:crypto');
  const forge = require(process.argv[1]);
  const { privateKey: pem } = generateKeyPairSync('rsa', {
    modulusLength: 1024,
    publicExponent: 3,
    privateKeyEncoding: { type: 'pkcs1', format: 'pem' },
    publicKeyEncoding: { type: 'pkcs1', format: 'pem' },
  });
  const privateKey = forge.pki.privateKeyFromPem(pem);
  const publicKey = forge.pki.rsa.setPublicKey(privateKey.n, privateKey.e);
  const digest = forge.md.sha256.create().update('repair regression').digest().getBytes();
  const { asn1 } = forge;
  const outcomes = [];
  for (const includeNull of [true, false]) {
    for (const malformed of [false, true]) {
      const algorithm = [asn1.create(asn1.Class.UNIVERSAL, asn1.Type.OID, false,
        asn1.oidToDer(forge.oids.sha256).getBytes())];
      if (includeNull) algorithm.push(asn1.create(asn1.Class.UNIVERSAL, asn1.Type.NULL, false, ''));
      if (malformed) algorithm.push(asn1.create(asn1.Class.UNIVERSAL, asn1.Type.OCTETSTRING, false, 'garbage'));
      const info = asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SEQUENCE, true, [
        asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SEQUENCE, true, algorithm),
        asn1.create(asn1.Class.UNIVERSAL, asn1.Type.OCTETSTRING, false, digest),
      ]);
      const signature = privateKey.sign(asn1.toDer(info).getBytes(), 'NONE');
      try {
        outcomes.push(publicKey.verify(digest, signature));
      } catch (error) {
        if (!/valid RSASSA-PKCS1-v1_5 DigestInfo/.test(error.message)) throw error;
        outcomes.push('invalid DigestInfo');
      }
    }
  }
  console.log(JSON.stringify(outcomes));
`;

test('default verification accepts valid forms and blocks both malformed forms only after repair', (t) => {
  const directory = fixture(t);
  const packageDirectory = join(directory, 'node_modules/node-forge');
  const probe = () => {
    const result = spawnSync(process.execPath, ['-e', signatureProbe, packageDirectory], {
      cwd: directory,
      encoding: 'utf8',
      timeout: 15000,
    });
    assert.equal(result.error, undefined);
    assert.equal(result.status, 0, result.stderr);
    return JSON.parse(result.stdout);
  };
  assert.deepEqual(probe(), [true, 'invalid DigestInfo', true, 'invalid DigestInfo']);
  change(packageDirectory, 'lib/rsa.js', (text) =>
    text.replace(repairedCondition, 'obj.value.length !== 2) {'),
  );
  assert.deepEqual(probe(), [true, true, true, true]);
});
