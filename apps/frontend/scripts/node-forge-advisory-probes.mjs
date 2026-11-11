// Public upstream regression vectors, run locally without sockets or private data.
// https://github.com/digitalbazaar/forge/security/advisories
import assert from 'node:assert/strict';

export function checkEd25519(forge) {
  const identity = '01' + '00'.repeat(31);
  const zero = '00'.repeat(32);
  const verify = (message, r, key) =>
    forge.ed25519.verify({
      message,
      encoding: 'utf8',
      signature: forge.util.hexToBytes(r + zero),
      publicKey: forge.util.hexToBytes(key),
    });
  // GHSA-6889-vf6x-f3g5: identity, noncanonical identity, order 2 and order 8.
  for (const message of ['', 'hello', 'signature regression']) {
    assert.equal(verify(message, identity, identity), false, 'small-order identity key');
  }
  assert.equal(verify('attack at dawn', identity, 'ee' + 'ff'.repeat(30) + '7f'), false);
  const order2 = 'ec' + 'ff'.repeat(30) + '7f';
  assert.equal(verify('attack at dawn', order2, order2), false);
  assert.equal(
    verify(
      'attack at dawn',
      'c7176a703d4dd84fba3c0b760d10670f2a2053fa2c39ccc64ec7fd7792ac037a',
      '26e8958fc2b227b045c3f489f2ef98f0d5dfac05d3c63339b13802886d53fc05',
    ),
    false,
  );
  // RFC 8032 section 7.1 TEST 1 remains valid.
  const signature = forge.util.hexToBytes(
    'e5564300c360ac729086e2cc806e828a84877f1eb8e5d974d873e06522490155' +
      '5fb8821590a33bacc61e39701cf9b46bd25bf5f0595bbe24655141438e7a100b',
  );
  const publicKey = forge.util.hexToBytes(
    'd75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a',
  );
  assert.equal(forge.ed25519.verify({ message: '', encoding: 'utf8', signature, publicKey }), true);
  assert.equal(
    forge.ed25519.verify({ message: 'changed', encoding: 'utf8', signature, publicKey }),
    false,
  );
}

export function checkTlsWithoutSession(forge) {
  // GHSA-j8rw-jp99-435v: no session before handshake or after either close route.
  const hello = forge.util.hexToBytes('160301000402000000');
  const close = forge.util.hexToBytes('15030100020100');
  for (const state of ['before', 'peer-close', 'local-close', 'reopened']) {
    const log = { closed: 0, errors: [] };
    const client = forge.tls.createConnection({
      server: false,
      tlsDataReady(c) {
        c.tlsData.getBytes();
      },
      dataReady(c) {
        c.data.getBytes();
      },
      closed() {
        log.closed++;
      },
      error(c, error) {
        log.errors.push(error.message);
      },
    });
    if (state !== 'before') {
      client.handshake();
      if (state === 'peer-close') client.process(close);
      else client.close();
      assert.equal(log.closed, 1);
    }
    if (state === 'reopened') client.handshake();
    assert.doesNotThrow(() => client.process(hello), state);
    if (state === 'reopened') {
      assert.equal(log.errors.length, 1);
      assert.match(log.errors[0], /ServerHello/);
    } else {
      assert.deepEqual(log.errors, []);
    }
  }
}

export function checkTlsCompression(forge, privateKey) {
  // GHSA-w4xr-hqv8-ch44: real local TLS flights with an altered compression byte.
  // A locally trusted test certificate exercises ordinary verification, no override.
  const cert = forge.pki.createCertificate();
  cert.publicKey = forge.pki.rsa.setPublicKey(privateKey.n, privateKey.e);
  cert.serialNumber = '01';
  cert.validity.notBefore = new Date(Date.now() - 86400000);
  cert.validity.notAfter = new Date(Date.now() + 86400000);
  const name = [{ name: 'commonName', value: 'local-security-test.invalid' }];
  cert.setSubject(name);
  cert.setIssuer(name);
  cert.setExtensions([{ name: 'basicConstraints', cA: true }]);
  cert.sign(privateKey, forge.md.sha256.create());
  const certificate = forge.pki.certificateToPem(cert);
  const key = forge.pki.privateKeyToPem(privateKey);
  const changeCompression = (bytes, method) => {
    const input = forge.util.createBuffer(bytes);
    let output = '';
    while (input.length()) {
      const header = input.getBytes(3);
      let fragment = input.getBytes(input.getInt16());
      if (
        header.charCodeAt(0) === forge.tls.ContentType.handshake &&
        fragment.charCodeAt(0) === forge.tls.HandshakeType.server_hello
      ) {
        let offset = 4 + 2 + 32;
        offset += 1 + fragment.charCodeAt(offset) + 2;
        fragment =
          fragment.slice(0, offset) + String.fromCharCode(method) + fragment.slice(offset + 1);
      }
      output += header + forge.util.int32ToBytes(fragment.length).slice(2) + fragment;
    }
    return output;
  };
  for (const method of [0, 1, 255]) {
    const log = { connected: false, errors: [] };
    const ends = {};
    let first = true;
    let flights = 0;
    ends.client = forge.tls.createConnection({
      server: false,
      caStore: [certificate],
      connected() {
        log.connected = true;
      },
      tlsDataReady(c) {
        const bytes = c.tlsData.getBytes();
        // Avoid feeding the rejected alert back into a reentrant client callback.
        if (flights++ === 0 || method === 0) ends.server.process(bytes);
      },
      dataReady() {},
      closed() {},
      error(c, error) {
        log.errors.push({ message: error.message, alert: error.alert });
      },
    });
    ends.server = forge.tls.createConnection({
      server: true,
      getCertificate() {
        return certificate;
      },
      getPrivateKey() {
        return key;
      },
      connected() {},
      dataReady() {},
      closed() {},
      error() {},
      tlsDataReady(c) {
        let bytes = c.tlsData.getBytes();
        if (first) {
          first = false;
          bytes = changeCompression(bytes, method);
        }
        ends.client.process(bytes);
      },
    });
    assert.doesNotThrow(() => ends.client.handshake(), `compression ${method}`);
    assert.equal(log.connected, method === 0);
    if (method === 0) assert.deepEqual(log.errors, []);
    else {
      assert.equal(ends.client.fail, true);
      assert.equal(log.errors.length, 1);
      assert.equal(log.errors[0].message, 'Unsupported compression method.');
      assert.equal(log.errors[0].alert.description, forge.tls.Alert.Description.illegal_parameter);
    }
  }
}

// GHSA-6cv4-p8m7-4r25: the old expression can block Node for minutes. Run only
// in a bounded child; exercise the public response and cookie APIs, not a timer alone.
export const httpProbe = String.raw`
  const assert = require('node:assert/strict');
  const { createRequire } = require('node:module');
  const requireForge = createRequire(process.argv[1]);
  const forge = requireForge('./forge');
  requireForge('./http');
  const whitespace = '\t '.repeat(256 * 1024);
  function response(header) {
    const r = forge.http.createResponse();
    assert.equal(r.readHeader(forge.util.createBuffer('HTTP/1.1 200 OK\r\n' + header + '\r\n\r\n')), true);
    return r;
  }
  const long = response('X-Test: a' + whitespace + 'b' + whitespace);
  assert.equal(long.getField('X-Test'), 'a' + whitespace + 'b');
  const cookies = response('Set-Cookie: a=b' + whitespace + 'c; path=/').getCookies();
  assert.equal(cookies.length, 1);
  assert.equal(cookies[0].value, 'b' + whitespace + 'c');
  const ordinary = response('X-Test: \t a  b \u00a0\t\r\nSet-Cookie:  name = value ; path=/');
  assert.equal(ordinary.getField('X-Test'), 'a  b');
  assert.equal(ordinary.getCookies()[0].name, 'name');
  assert.equal(ordinary.getCookies()[0].value, 'value');
  assert.equal(ordinary.getCookies()[0].path, '/');
  console.log(JSON.stringify({header: true, cookie: true, ordinary: true}));
`;
