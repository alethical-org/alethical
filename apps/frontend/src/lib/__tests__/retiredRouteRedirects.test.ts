import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

type Redirect = { source: string; destination: string; permanent: boolean };

const here = dirname(fileURLToPath(import.meta.url));
const liveConfig = resolve(here, '../../../../../vercel.json');

describe('retired public addresses', () => {
  it('permanently sends old Search addresses to Bills and old Chat or Account addresses home', () => {
    const config = JSON.parse(readFileSync(liveConfig, 'utf8')) as { redirects?: Redirect[] };

    expect(config.redirects).toEqual(
      expect.arrayContaining([
        { source: '/search', destination: '/bills', permanent: true },
        { source: '/chat', destination: '/', permanent: true },
        { source: '/chat/:path*', destination: '/', permanent: true },
        { source: '/account', destination: '/', permanent: true },
      ]),
    );
  });
});
