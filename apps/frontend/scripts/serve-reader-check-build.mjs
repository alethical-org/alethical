#!/usr/bin/env node
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('../dist/', import.meta.url)));
const types = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
  '.json': 'application/json',
};
createServer(async (request, response) => {
  if (!['GET', 'HEAD'].includes(request.method)) {
    response.writeHead(405).end();
    return;
  }
  try {
    const path = resolve(
      root,
      `.${decodeURIComponent(new URL(request.url, 'http://127.0.0.1').pathname)}`,
    );
    if (path !== root && !path.startsWith(root + sep)) {
      response.writeHead(403).end();
      return;
    }
    let body;
    let extension = extname(path);
    try {
      body = await readFile(path);
    } catch {
      if (extension) {
        response.writeHead(404).end();
        return;
      }
      body = await readFile(resolve(root, 'index.html'));
      extension = '.html';
    }
    response.writeHead(200, { 'content-type': types[extension] ?? 'application/octet-stream' });
    response.end(request.method === 'HEAD' ? undefined : body);
  } catch {
    response.writeHead(400).end();
  }
}).listen(4173, '127.0.0.1', () =>
  console.log('Reader fixture build available on loopback port 4173'),
);
