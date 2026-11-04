// @vitest-environment node
import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

it('permits private Blob images without opening other image origins', () => {
  const config = JSON.parse(
    readFileSync(new URL('../../vercel.json', import.meta.url), 'utf8'),
  );
  const policy = config.headers[0].headers.find(
    (header: { key: string }) => header.key === 'Content-Security-Policy',
  ).value as string;
  const imageSources = policy
    .split(';')
    .find((directive) => directive.trim().startsWith('img-src '))!
    .trim()
    .split(/\s+/)
    .slice(1);
  expect(imageSources).toEqual(["'self'", 'data:', 'blob:']);
});
