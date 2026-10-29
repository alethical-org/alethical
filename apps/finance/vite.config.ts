import { defineConfig } from 'vitest/config';

import { usSpelling } from './scripts/usSpelling.mjs';

// The Finance web app. No framework plugin: Vite compiles TSX itself, and the
// shell needs nothing more than that. Finance prints US spelling, including in
// the wording it imports from @alethical/shared (scripts/usSpelling.mjs).
export default defineConfig({
  plugins: [usSpelling()],
  server: { port: 5174, strictPort: true },
  preview: { port: 5174, strictPort: true },
  build: { outDir: 'dist', sourcemap: true },
  test: { environment: 'jsdom' },
});
