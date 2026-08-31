import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

interface VercelConfig {
  trailingSlash?: boolean;
  rewrites?: Array<{ source: string; destination: string }>;
}

const here = dirname(fileURLToPath(import.meta.url));

// Only the root config: Vercel never reads apps/frontend/vercel.json, and #1343
// removes it. Asserting a setting there would make a dead file look maintained.
const liveConfig = resolve(here, '../../../../../vercel.json');

function readConfig(): VercelConfig {
  return JSON.parse(readFileSync(liveConfig, 'utf8')) as VercelConfig;
}

describe('Trailing-slash addresses', () => {
  // Without this, /bills/94-2025-HF719/ would become a second address for the
  // same record. Measured on production 11 Aug 2026, before this shipped.
  it('redirect to the address without the slash', () => {
    expect(readConfig().trailingSlash).toBe(false);
  });

  // One final rule sends every non-file app address through the page builder.
  // Vercel applies the slash redirect before that rule, so the page builder and
  // the browser both see the same address without its ending slash.
  it('reach the same page builder as every other app address', () => {
    const rewrites = readConfig().rewrites ?? [];
    const catchAll = rewrites.at(-1);

    expect(catchAll?.source).toBe('/((?!api/|_expo/).*)');
    expect(catchAll?.destination).toBe('/api/page?path=/$1');
    expect(rewrites).not.toContainEqual(expect.objectContaining({ destination: '/index.html' }));
  });
});
