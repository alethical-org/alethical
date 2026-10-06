import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer, request } from 'node:http';
import { createRequire } from 'node:module';
import test from 'node:test';
import zlib from 'node:zlib';

const require = createRequire(import.meta.url);
const expoRequire = createRequire(require.resolve('@expo/cli/package.json'));
const compression = expoRequire('compression');
assert.equal(expoRequire('compression/package.json').version, '1.8.2');

// Exercise the package Expo actually resolves, on a private loopback server.
// Observe the real zlib close event, not only the response or JS stream flags.
async function responseProbe(t, abort) {
  const descriptor = Object.getOwnPropertyDescriptor(zlib, 'createGzip');
  const streams = [];
  const closed = [];
  Object.defineProperty(zlib, 'createGzip', {
    ...descriptor,
    value: (options) => {
      const stream = descriptor.value(options);
      streams.push(stream);
      closed.push(once(stream, 'close'));
      return stream;
    },
  });
  t.after(() => Object.defineProperty(zlib, 'createGzip', descriptor));
  const body = 'release compression test '.repeat(4096);
  const middleware = compression({ threshold: 0 });
  const server = createServer((req, res) =>
    middleware(req, res, () => {
      res.setHeader('Content-Type', 'text/plain');
      if (!abort) return res.end(body);
      const timer = setInterval(() => {
        res.write(body);
        res.flush();
      }, 5);
      res.once('close', () => clearInterval(timer));
    }),
  );
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  const received = await new Promise((resolve, reject) => {
    const client = request(
      { host: '127.0.0.1', port: server.address().port, headers: { 'Accept-Encoding': 'gzip' } },
      (res) => {
        assert.equal(res.headers['content-encoding'], 'gzip');
        const chunks = [];
        res.on('data', (chunk) => {
          chunks.push(chunk);
          if (abort) {
            client.destroy();
            resolve(null);
          }
        });
        res.once('end', () => resolve(Buffer.concat(chunks)));
        res.on('error', (error) => {
          if (!abort) reject(error);
        });
      },
    );
    t.after(() => client.destroy());
    client.on('error', (error) => {
      if (!abort) reject(error);
    });
    client.end();
  });
  assert.equal(streams.length, 1);
  await Promise.all(closed);
  assert.equal(streams[0].closed, true, 'The native gzip stream must release its handle');
  if (!abort) assert.equal(zlib.gunzipSync(received).toString(), body);
}

test(
  'Expo compression releases its gzip stream when a client disconnects',
  { timeout: 5000 },
  (t) => responseProbe(t, true),
);
test('Expo compression keeps ordinary compressed responses intact', { timeout: 5000 }, (t) =>
  responseProbe(t, false),
);
