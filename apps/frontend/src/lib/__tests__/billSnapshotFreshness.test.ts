import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, it } from 'vitest';
import {
  BILL_API_MAX_AGE_SECONDS,
  BILL_PAGE_MAX_AGE_SECONDS,
  BILL_FIRST_RESPONSE_MAX_AGE_SECONDS,
  billReadWithinCacheWindow,
} from '../billRecordReads';

it('pins the two independent cache allowances without adding the two alternative stale windows', () => {
  const root = resolve(__dirname, '../../../../..');
  const api = readFileSync(resolve(root, 'alethical/api/routers/public.py'), 'utf8');
  const page = readFileSync(resolve(root, 'api/page.ts'), 'utf8');
  expect(api).toContain('PUBLIC_CACHE_CONTROL = "public, max-age=60, stale-while-revalidate=300"');
  expect(page).toContain(
    'public, max-age=0, s-maxage=300, stale-while-revalidate=300, stale-if-error=300',
  );
  expect(BILL_API_MAX_AGE_SECONDS).toBe(60 + 300);
  expect(BILL_PAGE_MAX_AGE_SECONDS).toBe(300 + Math.max(300, 300));
  expect(BILL_FIRST_RESPONSE_MAX_AGE_SECONDS).toBe(960);
});

it('refuses evidence of over-age source data, including refresh failure ages', () => {
  expect(billReadWithinCacheWindow(360)).toBe(true);
  expect(billReadWithinCacheWindow(361)).toBe(false);
  expect(billReadWithinCacheWindow(3600)).toBe(false);
  expect(billReadWithinCacheWindow(-1)).toBe(false);
  expect(billReadWithinCacheWindow(null)).toBe(true);
});
