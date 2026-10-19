#!/usr/bin/env node
// Test-only loopback server: the real built app adopts the shared sample SSR article.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist = resolve(root, 'dist');
const rawPort = process.env.REPLAY_CHECK_PORT ?? '4174';
if (!/^\d+$/.test(rawPort)) throw new Error('REPLAY_CHECK_PORT must be an integer');
const port = Number(rawPort);
if (!Number.isInteger(port) || port < 1024 || port > 65535)
  throw new Error('REPLAY_CHECK_PORT must be between 1024 and 65535');
if ([4186, 4188, 4189].includes(port)) throw new Error('Reserved private preview port');
const origin = `http://127.0.0.1:${port}`;
const articlePath = '/blog/events/forward-debate-2026';
const require = createRequire(import.meta.url);
const { createServer: createViteServer } = await import(
  require.resolve('vite', { paths: [dirname(require.resolve('vitest/package.json'))] })
);
const vite = await createViteServer({
  root,
  configFile: false,
  appType: 'custom',
  envDir: false,
  logLevel: 'error',
  server: {
    middlewareMode: true,
    hmr: false,
    ws: false,
    allowedHosts: ['127.0.0.1'],
    cors: false,
  },
});
const { EVENTS } = await vite.ssrLoadModule('/src/lib/events.ts');
const { renderEventReplay } = await vite.ssrLoadModule('/src/lib/eventReplayMarkup.ts');
const { renderEventPageSnapshot, injectPageSnapshot } = await vite.ssrLoadModule(
  '/src/lib/pageSnapshot.ts',
);
const fixture = JSON.parse(
  await readFile(resolve(root, 'src/lib/__tests__/fixtures/eventReplay.json'), 'utf8'),
);
const shell = await readFile(resolve(dist, 'index.html'), 'utf8');
const deployment = JSON.parse(await readFile(resolve(root, '../../vercel.json'), 'utf8'));
const productionCsp = deployment.headers
  .flatMap((group) => group.headers)
  .find((header) => header.key.toLowerCase() === 'content-security-policy')?.value;
if (!productionCsp) throw new Error('Production content security policy is missing');
// Keep the production script hashes, including the real scroll boot program.
// HTTPS upgrading alone is unsuitable for this deliberately HTTP loopback server.
const csp = productionCsp
  .split(';')
  .filter((directive) => directive.trim() !== 'upgrade-insecure-requests')
  .join(';');
const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};
const server = createServer(async (request, response) => {
  if (
    request.headers.host !== `127.0.0.1:${port}` ||
    (request.headers.origin && request.headers.origin !== origin)
  ) {
    response.writeHead(403).end();
    return;
  }
  if (!['GET', 'HEAD'].includes(request.method)) {
    response.writeHead(405).end();
    return;
  }
  response.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive');
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('Content-Security-Policy', csp);
  response.setHeader('X-Content-Type-Options', 'nosniff');
  try {
    const url = new URL(request.url, origin);
    if (url.pathname === articlePath) {
      const markup = renderEventReplay(EVENTS[0], fixture, {
        origin,
        search: url.search,
        example: true,
      });
      const html = injectPageSnapshot(shell, renderEventPageSnapshot(markup, articlePath));
      response.writeHead(200, { 'Content-Type': types['.html'] });
      response.end(request.method === 'HEAD' ? undefined : html);
      return;
    }
    const file = resolve(dist, `.${decodeURIComponent(url.pathname)}`);
    if (file !== dist && !file.startsWith(dist + sep)) {
      response.writeHead(403).end();
      return;
    }
    let body;
    let extension = extname(file);
    try {
      body = await readFile(file);
    } catch {
      if (extension) {
        response.writeHead(404).end();
        return;
      }
      // Other routes use the actual built shell and application, without a fake snapshot.
      body = shell;
      extension = '.html';
    }
    response.writeHead(200, { 'Content-Type': types[extension] ?? 'application/octet-stream' });
    response.end(request.method === 'HEAD' ? undefined : body);
  } catch {
    response.writeHead(400).end();
  }
});
server.listen(port, '127.0.0.1', () =>
  console.log(`Built replay startup check available on loopback port ${port}`),
);
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => server.close(() => void vite.close().then(() => process.exit(0))));
}
