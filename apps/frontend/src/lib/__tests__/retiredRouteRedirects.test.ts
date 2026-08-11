import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

type Redirect = { source: string; destination: string; permanent: boolean };

const here = dirname(fileURLToPath(import.meta.url));
const liveConfig = resolve(here, '../../../../../vercel.json');

describe('retired public addresses', () => {
  it('keeps Search retired while leaving restorable Chat and Account routes reversible', () => {
    const config = JSON.parse(readFileSync(liveConfig, 'utf8')) as { redirects?: Redirect[] };

    expect(config.redirects).toEqual(
      expect.arrayContaining([
        { source: '/search', destination: '/bills', permanent: true },
        { source: '/chat', destination: '/', permanent: false },
        { source: '/chat/:path*', destination: '/', permanent: false },
        { source: '/account', destination: '/', permanent: false },
      ]),
    );
  });
});
