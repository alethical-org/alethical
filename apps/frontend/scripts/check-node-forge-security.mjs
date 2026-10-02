import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const patchPath = 'patches/node-forge@1.4.0.patch';
const patchHash = '17f32de12e78ff6579733b89f13976a383e39ebfb86f35951c43c8724c079b8e';
const rsaHash = 'acc22e5d36e27832c34e02dd3933aad7977d45b047eead5016520735efedc9c5';
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

// Upstream has no fixed release for GHSA-86w9-cpqp-85rv. Accept only the
// exact local backport of digitalbazaar/forge#1152, never stock 1.4.0 or a
// different patch. Frozen installation is required by the calling security gate.
assert.equal(sha256(readFileSync(join(root, patchPath))), patchHash);
assert.match(
  readFileSync(join(root, 'pnpm-workspace.yaml'), 'utf8'),
  /^  node-forge@1\.4\.0: patches\/node-forge@1\.4\.0\.patch$/m,
);
assert.match(
  readFileSync(join(root, 'pnpm-lock.yaml'), 'utf8'),
  new RegExp(
    `^  node-forge@1\\.4\\.0:\\n    hash: ${patchHash}\\n    path: ${patchPath.replaceAll('.', '\\.')}\\n`,
    'm',
  ),
);

const { privateKey: pem } = generateKeyPairSync('rsa', {
  modulusLength: 1024,
  publicExponent: 3,
  privateKeyEncoding: { type: 'pkcs1', format: 'pem' },
  publicKeyEncoding: { type: 'pkcs1', format: 'pem' },
});

for (const consumer of ['@expo/cli', '@expo/code-signing-certificates']) {
  const consumerRequire = createRequire(require.resolve(`${consumer}/package.json`));
  const manifest = consumerRequire('node-forge/package.json');
  assert.equal(manifest.version, '1.4.0');
  const forgeRequire = createRequire(consumerRequire.resolve('node-forge'));
  assert.equal(sha256(readFileSync(forgeRequire.resolve('./rsa'))), rsaHash);
  const forge = consumerRequire('node-forge');
  const privateKey = forge.pki.privateKeyFromPem(pem);
  const publicKey = forge.pki.rsa.setPublicKey(privateKey.n, privateKey.e);
  const md = forge.md.sha256.create().update('Alethical signature regression');
  const digest = md.digest().getBytes();
  assert.equal(publicKey.verify(digest, privateKey.sign(md)), true);

  for (const includeNull of [true, false]) {
    for (const malformed of [false, true]) {
      const asn1 = forge.asn1;
      const algorithm = [
        asn1.create(
          asn1.Class.UNIVERSAL,
          asn1.Type.OID,
          false,
          asn1.oidToDer(forge.oids.sha256).getBytes(),
        ),
      ];
      if (includeNull) algorithm.push(asn1.create(asn1.Class.UNIVERSAL, asn1.Type.NULL, false, ''));
      if (malformed)
        algorithm.push(
          asn1.create(asn1.Class.UNIVERSAL, asn1.Type.OCTETSTRING, false, 'unexpected'),
        );
      const info = asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SEQUENCE, true, [
        asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SEQUENCE, true, algorithm),
        asn1.create(asn1.Class.UNIVERSAL, asn1.Type.OCTETSTRING, false, digest),
      ]);
      // A known test key signs the malformed payload with ordinary PKCS#1
      // padding. This isolates validation, not a no-private-key exploit.
      const signature = privateKey.sign(asn1.toDer(info).getBytes(), 'NONE');
      if (malformed) {
        assert.throws(
          () => publicKey.verify(digest, signature),
          /valid RSASSA-PKCS1-v1_5 DigestInfo/,
        );
      } else {
        assert.equal(publicKey.verify(digest, signature), true);
      }
    }
  }
}

console.log(
  'GHSA-86w9-cpqp-85rv: exact installed repair and valid/malformed signatures passed for both Expo consumers',
);
