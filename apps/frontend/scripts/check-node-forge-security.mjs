import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createCipheriv, createHash, generateKeyPairSync } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const patchPath = 'patches/node-forge@1.4.0.patch';
const patchHash = 'b6b641c5516784f73c3ada59a215dbd7bb2eb7d4b2c254699a06551baa835ff6';
// Every lib/ file the patch changes: the digitalbazaar/forge#1152 hunk in
// rsa.js for GHSA-86w9-cpqp-85rv (no upstream release), plus the exact
// node-forge 1.4.0 -> 1.4.1 lib/ diff for the 11 advisories 1.4.1 fixes while
// that release (27 Oct 2026) is younger than the 7-day package gate.
const libraryHashes = {
  asn1: '77cc3ca2b4c1009e93cf26594232598f253bd3e046f16eb32386c8bf644857b6',
  cipher: '9dbfb9e9a02a128c9092faf78462221b9092ef0f3555da7ea1f6002aab4819a8',
  cipherModes: '904c168aecdfdf07afce4e38bdc9e0a8f3a799274b8c36d0adae3439a83324a8',
  http: '257276e15b49964f8e5c4037e1bd6b4368aacdc1de4f6f46a45b67ca72728265',
  jsbn: 'f17e767bfef62490e22a66ec2e12444fe53aee15e838fe572b7808e75194b62d',
  pbe: '674750301f7c7d44b7b52c80bde90399aef8ff6021e6d6ccd1553ce3f5768c81',
  pem: '38f22a503dc8285e31edfb67f0614a30c8af4abd0032e7738d45a08c31361401',
  pkcs12: '4e471bf3e717d940a07b34d5716d988cfa01b143c38c3fc1f8b597cb83d29742',
  rsa: '97027a525106f7c1cade09b5032ca31cf3e8a55078cd6d34f7a4265cd549f5f0',
  tls: '3d7def7a2e1c568de50c18109d7186c0c83d0384c7f9badab4831722b6233cbe',
  x509: '6749ed90069312a63470cc468d434781494fa3c9d3f2cc194efb2099011f9132',
};
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

// Accept only the exact saved patch, lock binding and installed code, never
// stock 1.4.0 or a different patch. Frozen installation is required by the
// calling security gate.
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
  modulusLength: 2048,
  publicExponent: 3,
  privateKeyEncoding: { type: 'pkcs1', format: 'pem' },
  publicKeyEncoding: { type: 'pkcs1', format: 'pem' },
});

// Unrepaired 1.4.0 loops forever on a negative modInverse operand and spends
// seconds on a short crafted PEM text, so those run in a child process that a
// timeout bounds; the parent only reads the printed results.
const boundedProbe = String.raw`
  const forge = require(process.argv[1]);
  const B = forge.jsbn.BigInteger;
  const inverse = (a, m) => new B(a).modInverse(new B(m)).toString();
  const pemTimes = {};
  for (const [name, text] of [
    ['mismatchedLabels', ' -----BEGIN I-----G-----END B'.repeat(1000) + '\x00'],
    ['newlinesWithoutEnd', '-----BEGIN CERTIFICATE-----' + '\n'.repeat(32000)],
    ['longHeaderLine', '-----BEGIN X-----\nProc-Type: 4,ENCRYPTED\n' + 'a'.repeat(30000) + '\n\nQUJD\n-----END X-----'],
  ]) {
    const start = performance.now();
    let outcome;
    try { outcome = forge.pem.decode(text).length; } catch (error) { outcome = error.message; }
    pemTimes[name] = { outcome, ms: Math.round(performance.now() - start) };
  }
  console.log(JSON.stringify({
    inverse: [inverse('3', '7'), inverse('-3', '7'), inverse('3', '-7'), inverse('0', '7')],
    pemTimes,
  }));
`;

for (const consumer of ['@expo/cli', '@expo/code-signing-certificates']) {
  const consumerRequire = createRequire(require.resolve(`${consumer}/package.json`));
  const manifest = consumerRequire('node-forge/package.json');
  assert.equal(manifest.version, '1.4.0');
  const forgeRequire = createRequire(consumerRequire.resolve('node-forge'));
  for (const [name, hash] of Object.entries(libraryHashes)) {
    assert.equal(sha256(readFileSync(forgeRequire.resolve(`./${name}`))), hash, `lib/${name}.js`);
  }
  const forge = consumerRequire('node-forge');
  const privateKey = forge.pki.privateKeyFromPem(pem);
  const publicKey = forge.pki.rsa.setPublicKey(privateKey.n, privateKey.e);
  const md = forge.md.sha256.create().update('Alethical signature regression');
  const digest = md.digest().getBytes();
  assert.equal(publicKey.verify(digest, privateKey.sign(md)), true);

  // GHSA-86w9-cpqp-85rv: extra nested DigestAlgorithm elements are rejected.
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

  // GHSA-jc66-7q78-782g: an iteration count below 1 made the PKCS#12 key a
  // constant, so a MAC computed with that constant verified under any password.
  const salt = new forge.util.ByteBuffer('alethical-salt');
  assert.equal(forge.pkcs12.generateKey('any password', salt, 3, 1, 20).length(), 20);
  for (const iterations of [0, -1, NaN]) {
    assert.throws(
      () => forge.pkcs12.generateKey('any password', salt, 3, iterations, 20),
      /iteration count must be >= 1/,
    );
  }
  const cert = forge.pki.createCertificate();
  cert.publicKey = publicKey;
  cert.serialNumber = '01';
  cert.validity.notBefore = new Date(0);
  cert.validity.notAfter = new Date(0);
  const attrs = [{ name: 'commonName', value: 'Alethical security regression' }];
  cert.setSubject(attrs);
  cert.setIssuer(attrs);
  cert.sign(privateKey, forge.md.sha256.create());
  const pfx = forge.pkcs12.toPkcs12Asn1(privateKey, [cert], 'correct password', {
    algorithm: '3des',
    count: 2048,
  });
  assert.equal(
    forge.pkcs12.pkcs12FromAsn1(pfx, 'correct password').getBags({
      bagType: forge.pki.oids.certBag,
    })[forge.pki.oids.certBag].length,
    1,
  );
  assert.throws(
    () => forge.pkcs12.pkcs12FromAsn1(pfx, 'wrong password'),
    /MAC could not be verified/,
  );
  // Forge the MAC over the real content with the constant key (0x03 x 20) that
  // 0 iterations produced, then set MacData.iterations to 0: unrepaired 1.4.0
  // accepts this under any password; the repair refuses it before any MAC check.
  const asn1 = forge.asn1;
  const content = pfx.value[1].value[1].value[0];
  const constantMac = forge.hmac.create();
  constantMac.start(forge.md.sha1.create(), '\x03'.repeat(20));
  constantMac.update(content.value);
  const macData = pfx.value[2];
  macData.value[0].value[1] = asn1.create(
    asn1.Class.UNIVERSAL,
    asn1.Type.OCTETSTRING,
    false,
    constantMac.getMac().getBytes(),
  );
  macData.value[2] = asn1.create(
    asn1.Class.UNIVERSAL,
    asn1.Type.INTEGER,
    false,
    asn1.integerToDer(0).getBytes(),
  );
  assert.throws(
    () => forge.pkcs12.pkcs12FromAsn1(pfx, 'any password'),
    /MAC iteration count must be >= 1/,
  );

  // GHSA-7wch-p9px-956x (PEM) and GHSA-h6cr-wjv9-3cpp (modInverse): bounded.
  const probe = spawnSync(process.execPath, ['-e', boundedProbe, forgeRequire.resolve('./index')], {
    encoding: 'utf8',
    timeout: 10000,
  });
  assert.equal(probe.error, undefined, 'the bounded probe must finish, rather than time out');
  assert.equal(probe.status, 0, probe.stderr);
  const bounded = JSON.parse(probe.stdout);
  assert.deepEqual(bounded.inverse, ['5', '0', '0', '0']);
  for (const [name, { outcome, ms }] of Object.entries(bounded.pemTimes)) {
    assert.ok(ms < 2000, `${name} took ${ms} ms`);
    assert.equal(outcome, name === 'longHeaderLine' ? 1 : 'Invalid PEM formatted message.');
  }
  // Ordinary PEM text, with and without encapsulated headers, still decodes.
  const certPem = forge.pki.certificateToPem(cert);
  assert.equal(forge.pki.certificateToPem(forge.pki.certificateFromPem(certPem)), certPem);
  const headed = forge.pem.encode({
    type: 'CERTIFICATE',
    procType: { version: '4', type: 'ENCRYPTED' },
    headers: [{ name: 'X-Alethical', values: ['regression check'] }],
    body: forge.asn1.toDer(forge.pki.certificateToAsn1(cert)).getBytes(),
  });
  const [decoded] = forge.pem.decode(headed);
  assert.equal(decoded.type, 'CERTIFICATE');
  assert.deepEqual(decoded.procType, { version: '4', type: 'ENCRYPTED' });
  assert.deepEqual(decoded.headers, [{ name: 'X-Alethical', values: ['regression check'] }]);
  assert.equal(forge.pki.certificateFromAsn1(forge.asn1.fromDer(decoded.body)).serialNumber, '01');

  // GHSA-4642-5mcj-2rqw: out-of-range first OID arcs are refused, and a first
  // subidentifier of 80 or more decodes back to its 2.x arc.
  assert.throws(
    () => forge.asn1.oidToDer('0.42.840.113549.1.1.1'),
    /first two arcs are out of range/,
  );
  for (const oid of ['1.2.840.113549.1.1.1', '2.100.3', '2.5.29.19']) {
    assert.equal(forge.asn1.derToOid(forge.asn1.oidToDer(oid)), oid);
  }

  // GHSA-5cwg-6vw7-rj6p: a GCM tag length of 0 no longer disables the tag.
  const gcmKey = forge.random.getBytesSync(16);
  const gcmIv = forge.random.getBytesSync(12);
  for (const tagLength of [0, false, '', '0', 8]) {
    assert.throws(() => {
      const decipher = forge.cipher.createDecipher('AES-GCM', gcmKey);
      decipher.start({ iv: gcmIv, tagLength, tag: '' });
    }, /Invalid tag length/);
  }
  const gcm = forge.cipher.createCipher('AES-GCM', gcmKey);
  gcm.start({ iv: gcmIv });
  gcm.update(forge.util.createBuffer('Alethical GCM regression'));
  gcm.finish();
  const gcmDecipher = forge.cipher.createDecipher('AES-GCM', gcmKey);
  gcmDecipher.start({ iv: gcmIv, tag: gcm.mode.tag });
  gcmDecipher.update(gcm.output);
  assert.equal(gcmDecipher.finish(), true);
  assert.equal(gcmDecipher.output.toString(), 'Alethical GCM regression');

  // CBC unpadding (part of the 1.4.1 cipher-mode fixes): every padding byte
  // must match the count. Node's cipher makes the raw blocks without padding.
  const cbcKey = Buffer.alloc(16, 7);
  const cbcIv = Buffer.alloc(16, 9);
  const cbcBlocks = (plaintext) => {
    const cipher = createCipheriv('aes-128-cbc', cbcKey, cbcIv);
    cipher.setAutoPadding(false);
    return Buffer.concat([cipher.update(plaintext), cipher.final()]).toString('binary');
  };
  const cbcUnpad = (ciphertext) => {
    const decipher = forge.cipher.createDecipher('AES-CBC', cbcKey.toString('binary'));
    decipher.start({ iv: cbcIv.toString('binary') });
    decipher.update(forge.util.createBuffer(ciphertext));
    return [decipher.finish(), decipher.output.toString()];
  };
  assert.deepEqual(
    cbcUnpad(cbcBlocks(Buffer.concat([Buffer.from('Alethical CBC'), Buffer.alloc(3, 3)]))),
    [true, 'Alethical CBC'],
  );
  assert.equal(
    cbcUnpad(cbcBlocks(Buffer.concat([Buffer.from('Alethical CBC'), Buffer.from([3, 3, 7])])))[0],
    false,
  );
  assert.equal(
    cbcUnpad(cbcBlocks(Buffer.concat([Buffer.alloc(15, 65), Buffer.from([0])])))[0],
    false,
  );

  // GHSA-4487-j8r4-4g2f: verifying a chain never removes same-subject CA
  // certificates from the store, and the ordinary chain still verifies.
  const caStore = forge.pki.createCaStore();
  const issuers = [];
  for (const serial of ['02', '03']) {
    const { privateKey: caPem } = generateKeyPairSync('rsa', {
      modulusLength: 2048,
      privateKeyEncoding: { type: 'pkcs1', format: 'pem' },
      publicKeyEncoding: { type: 'pkcs1', format: 'pem' },
    });
    const caKey = forge.pki.privateKeyFromPem(caPem);
    const ca = forge.pki.createCertificate();
    ca.publicKey = forge.pki.rsa.setPublicKey(caKey.n, caKey.e);
    ca.serialNumber = serial;
    ca.validity.notBefore = new Date(Date.now() - 86400000);
    ca.validity.notAfter = new Date(Date.now() + 86400000);
    const caAttrs = [{ name: 'commonName', value: 'Alethical regression CA' }];
    ca.setSubject(caAttrs);
    ca.setIssuer(caAttrs);
    ca.setExtensions([{ name: 'basicConstraints', cA: true }]);
    ca.sign(caKey, forge.md.sha256.create());
    caStore.addCertificate(ca);
    issuers.push({ ca, caKey });
  }
  const leaf = forge.pki.createCertificate();
  leaf.publicKey = publicKey;
  leaf.serialNumber = '04';
  leaf.validity.notBefore = new Date(Date.now() - 86400000);
  leaf.validity.notAfter = new Date(Date.now() + 86400000);
  leaf.setSubject([{ name: 'commonName', value: 'leaf' }]);
  leaf.setIssuer(issuers[1].ca.subject.attributes);
  leaf.sign(issuers[1].caKey, forge.md.sha256.create());
  assert.equal(forge.pki.verifyCertificateChain(caStore, [leaf]), true);
  assert.equal(caStore.listAllCertificates().length, 2);
}

console.log(
  'GHSA-86w9-cpqp-85rv and the 11 node-forge 1.4.1 advisories: exact installed repair, valid/malformed signatures, PKCS#12 forgery, PEM, modInverse, OID, GCM, CBC and CA-store checks passed for both Expo consumers',
);
