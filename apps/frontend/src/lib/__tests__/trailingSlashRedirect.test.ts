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
  // Without this, /bills/94-2025-HF719/ misses the /bills/:id rewrite, falls
  // through to the catch-all, and serves the home page's title and canonical
  // for a real bill. Measured on production 11 Aug 2026, before this shipped.
  it('redirect to the address without the slash', () => {
    expect(readConfig().trailingSlash).toBe(false);
  });

  // The rewrites match one path segment each, so a trailing slash cannot be
  // absorbed by them. The redirect above is what keeps them reachable.
  it('are not covered by a rewrite that tolerates the slash', () => {
    const sources = (readConfig().rewrites ?? []).map((rule) => rule.source);

    expect(sources).toContain('/bills/:id');
    expect(sources).not.toContain('/bills/:id/');
  });
});
