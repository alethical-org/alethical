import { defineConfig } from 'vitest/config';

// The Finance web app. No framework plugin: Vite compiles TSX itself, and the
// shell needs nothing more than that.
export default defineConfig({
  server: { port: 5174, strictPort: true },
  preview: { port: 5174, strictPort: true },
  build: { outDir: 'dist', sourcemap: true },
  test: { environment: 'jsdom' },
});
