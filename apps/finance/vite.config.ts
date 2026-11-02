import { defineConfig } from 'vitest/config';

import { usSpelling } from './scripts/usSpelling.mjs';

// The Finance web app. No framework plugin: Vite compiles TSX itself, and the
// shell needs nothing more than that. Finance prints US spelling, including in
// the wording it imports from @alethical/shared (scripts/usSpelling.mjs).
// Real-data checks before a release: with FINANCE_QA_PROXY set, the dev server
// forwards /api to the shared API as the same origin, so a browser signed in to
// Finance can read production records from a local build (the API allows only
// Finance's own address across origins). Reads only pass through unchanged;
// nothing here ships in the build.
const qaProxy = process.env.FINANCE_QA_PROXY
  ? {
      '/api': {
        target: 'https://api.alethical.com',
        changeOrigin: true,
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
