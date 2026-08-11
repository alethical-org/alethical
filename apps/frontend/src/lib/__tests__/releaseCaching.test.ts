import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

interface VercelConfig {
  headers?: Array<{
    source: string;
    headers: Array<{ key: string; value: string }>;
  }>;
}

const here = dirname(fileURLToPath(import.meta.url));
const liveConfig = resolve(here, '../../../../../vercel.json');

function readConfig(path: string): VercelConfig {
  return JSON.parse(readFileSync(path, 'utf8')) as VercelConfig;
}

describe('Vercel release caching', () => {
  it('keeps content-named Expo files in the browser', () => {
    const config = readConfig(liveConfig);
    const staticRule = config.headers?.find((rule) => rule.source === '/_expo/static/(.*)');

    expect(staticRule?.headers).toContainEqual({
      key: 'Cache-Control',
      value: 'public, max-age=31536000, immutable',
    });
  });

  it('does not apply the immutable rule to page HTML', () => {
    const config = readConfig(liveConfig);
    const immutableRules = (config.headers ?? []).filter((rule) =>
      rule.headers.some((header) => header.value.includes('immutable')),
    );

    expect(immutableRules.map((rule) => rule.source)).toEqual(['/_expo/static/(.*)']);
  });
});
