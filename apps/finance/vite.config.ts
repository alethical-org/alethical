import { defineConfig } from 'vitest/config';

import { usSpelling } from './scripts/usSpelling.mjs';

// The Finance web app. No framework plugin: Vite compiles TSX itself, and the
// shell needs nothing more than that. Finance prints US spelling, including in
// the wording it imports from @alethical/shared (scripts/usSpelling.mjs).
// Real-data checks before a release: with FINANCE_QA_PROXY set, the dev server
// forwards GET and HEAD requests under /api to the shared API as the same origin,
// with a desktop browser's identity, and refuses every other method with 405, so
// a local build can read records but never write them. Nothing here ships in the
// build.
const qaProxy = process.env.FINANCE_QA_PROXY
  ? {
      '/api': {
        target: 'https://api.alethical.com',
        changeOrigin: true,
        bypass(req: { method?: string }, res: { statusCode: number; end: () => void } | undefined) {
          if (req.method === 'GET' || req.method === 'HEAD') return undefined;
          if (res) {
            res.statusCode = 405;
            res.end();
          }
          return false;
        },
        headers: {
          accept: 'application/json',
          'accept-language': 'en-US,en;q=0.9',
          'user-agent':
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36',
        },
      },
    }
  : undefined;

export default defineConfig({
  plugins: [usSpelling()],
  server: { port: 5174, strictPort: true, proxy: qaProxy },
  preview: { port: 5174, strictPort: true },
  build: { outDir: 'dist', sourcemap: true },
  test: { environment: 'jsdom' },
});
