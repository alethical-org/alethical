import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { expect, it } from 'vitest';

it('removes the private invitation before the application or outside resources start', () => {
  const source = readFileSync(
    new URL('../../../public/mail-upload-bootstrap.js', import.meta.url),
    'utf8',
  );
  let destination = '';
  const window = {
    location: { pathname: '/mail-upload', search: '?token=accidental', hash: '#invite=secret' },
    history: {
      state: { retained: true },
      replaceState: (_state: unknown, _title: string, path: string) => {
        destination = path;
      },
    },
    __alethicalMailInvitation: undefined,
  };
  runInNewContext(source, { window, URLSearchParams });
  expect(window.__alethicalMailInvitation).toBe('secret');
  expect(destination).toBe('/mail-upload');
});
