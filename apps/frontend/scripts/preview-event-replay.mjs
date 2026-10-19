// Local development entry point. Never imported by the app or deployment build.
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { createRequire } from 'node:module';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
// Vite is already supplied by Vitest; this adds no deployment dependency.
const { createServer } = await import(
  require.resolve('vite', { paths: [dirname(require.resolve('vitest/package.json'))] })
);
const port = Number(process.env.REPLAY_PREVIEW_PORT || 4186);
if (!Number.isInteger(port) || port < 1024 || port > 65535)
  throw new Error('Use a port between 1024 and 65535');
const origin = `http://127.0.0.1:${port}`;
const vite = await createServer({
  root,
  configFile: false,
  appType: 'custom',
  envDir: false,
  server: { middlewareMode: true, hmr: false, ws: false, allowedHosts: ['127.0.0.1'], cors: false },
});
const { EVENTS, eventPath } = await vite.ssrLoadModule('/src/lib/events.ts');
const { renderEventReplay } = await vite.ssrLoadModule('/src/lib/eventReplayMarkup.ts');
const { eventReplayBySlug } = await vite.ssrLoadModule('/src/lib/eventReplayContent.ts');
const { parseEventReplay } = await vite.ssrLoadModule('/src/lib/eventReplay.ts');
const { renderEventPageSnapshot } = await vite.ssrLoadModule('/src/lib/pageSnapshot.ts');
const shell = await readFile(resolve(root, 'public/index.html'), 'utf8');
const snapshotStyle =
  shell.match(/<style id="alethical-page-snapshot">[\s\S]*?<\/style>/)?.[0] ?? '';
const fixture = parseEventReplay(
  JSON.parse(await readFile(resolve(root, 'src/lib/__tests__/fixtures/eventReplay.json'), 'utf8')),
);
const content = process.env.REPLAY_CONTENT_JSON
  ? parseEventReplay(JSON.parse(await readFile(resolve(process.env.REPLAY_CONTENT_JSON), 'utf8')))
  : undefined;
const event = EVENTS[0];
const server = http.createServer((req, res) => {
  // Loopback binding plus Host/Origin checks prevent accidental LAN exposure and rebinding.
  if (
    req.headers.host !== `127.0.0.1:${port}` ||
    (req.headers.origin && req.headers.origin !== origin)
  ) {
    res.writeHead(403);
    res.end('Private preview');
    return;
  }
  res.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; script-src 'self' https://www.youtube.com https://s.ytimg.com; style-src 'self' 'unsafe-inline'; img-src 'self' https://www.alethical.com data:; font-src 'self'; frame-src https://www.youtube-nocookie.com; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  );
  const url = new URL(req.url, origin);
  if (url.pathname === '/robots.txt') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('User-agent: *\nDisallow: /\n');
    return;
  }
  if (url.pathname === '/replay-preview-client.js') {
    res.writeHead(200, { 'Content-Type': 'text/javascript' });
    res.end(
      "import { mountEventReplay } from '/src/lib/eventReplayPlayer.ts'; mountEventReplay(document.querySelector('.replay-content'));",
    );
    return;
  }
  if (
    url.pathname === '/' ||
    url.pathname === eventPath(event) ||
    url.pathname === '/__replay-example'
  ) {
    const example = url.pathname === '/__replay-example';
    const markup = renderEventReplay(
      event,
      example ? fixture : (content ?? eventReplayBySlug(event.slug)),
      {
        origin,
        search: url.search,
        example,
      },
    );
    const body = renderEventPageSnapshot(markup)
      .replace('<span class="ps-signin">Sign in</span>', '')
      .replaceAll('href="/', 'href="https://www.alethical.com/');
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(
      `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow,noarchive"><title>The Forward Debate | Alethical</title><link rel="stylesheet" href="/fonts/fonts.css">${snapshotStyle}<style>body{margin:0;background:#f7f8f5}.replay-draft{padding:12px 20px;background:#fff2ad;color:#11150f;font:700 14px 'Libre Franklin',sans-serif;text-align:center}button[hidden]{display:none!important}</style></head><body>${body}<script type="module" src="/replay-preview-client.js"></script></body></html>`,
    );
    return;
  }
  // Vite serves only local code/assets for this development preview; no application API.
  vite.middlewares(req, res, () => {
    res.writeHead(404);
    res.end('Not found');
  });
});
server.listen(port, '127.0.0.1', () =>
  console.log(
    `Private replay preview: ${origin}${eventPath(event)}\nIllustrative interaction example: ${origin}/__replay-example`,
  ),
);
for (const signal of ['SIGINT', 'SIGTERM'])
  process.on(signal, () => {
    server.close();
    void vite.close().then(() => process.exit(0));
  });
