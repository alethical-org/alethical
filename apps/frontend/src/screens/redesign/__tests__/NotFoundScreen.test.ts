import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SCREEN = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '..', 'NotFoundScreen.tsx'),
  'utf8',
);

describe('missing-page screen contract', () => {
  it('uses the normal site frame and gives the reader 3 useful ways onward', () => {
    expect(SCREEN).toContain('<TopNav');
    expect(SCREEN).toContain('<Footer');
    expect(SCREEN).toContain('{NOT_FOUND_HEADING}');
    expect(SCREEN).toContain('{NOT_FOUND_DESCRIPTION}');
    expect(SCREEN).toContain('routePath.home()');
    expect(SCREEN).toContain('routePath.bills()');
    expect(SCREEN).toContain('routePath.legislators()');
  });

  it('has 1 main heading and shows the address that failed', () => {
    expect(SCREEN.match(/aria-level=\{1\}/g)).toHaveLength(1);
    expect(SCREEN).toContain('route.params.path');
  });
});
