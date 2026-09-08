import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { resultCountLine, UNKNOWN_RESULT_COUNT } from '../resultCount';
import {
  META_READ_PATH,
  metaQueryKey,
  POLICY_AREA_READ_LIMIT,
  policyAreasQueryKey,
  policyAreasReadPath,
  SESSIONS_READ_PATH,
  sessionsQueryKey,
} from '../searchPageReads';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
const REPO = join(ROOT, '../../..');

function source(path: string) {
  return readFileSync(join(ROOT, path), 'utf8');
}

describe('the keys /bills and /legislators are seeded under', () => {
  /**
   * A key written out twice is 2 chances to drift, and a drifted key seeds
   * nothing and improves nothing — silently, because the page still works and
   * the reader simply waits as before. So one builder per read, shared by the
   * hook and by `api/page.ts`, and these are the exact keys the hooks used to
   * write out by hand.
   */
  it('builds the keys the hooks had written out by hand', () => {
    expect(policyAreasQueryKey({})).toEqual(['policy-areas', 'current', 'session']);
    expect(policyAreasQueryKey({ scope: 'legislature' })).toEqual([
      'policy-areas',
      'current',
      'legislature',
    ]);
    expect(policyAreasQueryKey({ session: '94-2025-regular' })).toEqual([
      'policy-areas',
      '94-2025-regular',
      'session',
    ]);
    expect(sessionsQueryKey()).toEqual(['sessions']);
    expect(metaQueryKey()).toEqual(['meta']);
  });

  it('leaves those keys written out nowhere in the hooks', () => {
    const hooks = source('hooks/useAppQueries.ts');

    for (const builder of ['policyAreasQueryKey', 'sessionsQueryKey', 'metaQueryKey']) {
      expect(hooks).toContain(`${builder}(`);
    }
    for (const literal of [
      "queryKey: ['policy-areas'",
      "queryKey: ['sessions']",
      "queryKey: ['meta']",
    ]) {
      expect(hooks).not.toContain(literal);
    }
  });

  it('reads each one at the path the app would otherwise have asked for', () => {
    // Written out rather than built from the constants, so a changed limit shows
    // up here instead of quietly moving both sides of the comparison at once.
    expect(POLICY_AREA_READ_LIMIT).toBe(50);
    expect(policyAreasReadPath({ scope: 'legislature' })).toBe(
      '/policy-areas?limit=50&scope=legislature',
    );
    expect(policyAreasReadPath({})).toBe('/policy-areas?limit=50');
    expect(policyAreasReadPath({ session: '94-2025-regular' })).toBe(
      '/policy-areas?limit=50&session=94-2025-regular',
    );
    expect(SESSIONS_READ_PATH).toBe('/sessions');
    expect(META_READ_PATH).toBe('/meta');
  });

  it('keeps every read the app makes running through the same shaper', () => {
    const api = source('data/api.ts');

    // A seeded payload and a fetched payload have to go through one function, or
    // a figure that arrived with the page could differ from the same figure
    // fetched a moment later.
    for (const shaper of ['policyAreasFromPayload', 'sessionsFromPayload', 'metaFromPayload']) {
      expect(api).toContain(`export function ${shaper}(`);
      expect(source('hooks/useAppQueries.ts')).toContain(`...seededQuery(key, ${shaper})`);
    }
    for (const path of ['policyAreasReadPath(', 'SESSIONS_READ_PATH', 'META_READ_PATH']) {
      expect(api).toContain(path);
    }
  });

  it('seeds them from the page function through those same builders', () => {
    const pageFunction = readFileSync(join(REPO, 'api/page.ts'), 'utf8');

    for (const builder of [
      'policyAreasQueryKey(',
      'sessionsQueryKey()',
      'metaQueryKey()',
      'policyAreasReadPath(',
      'SESSIONS_READ_PATH',
      'META_READ_PATH',
    ]) {
      expect(pageFunction).toContain(builder);
    }
  });
});

describe('the count above a list of results', () => {
  it('prints a blank of the same height rather than 0 for a figure it has not been told', () => {
    // "0 bills" was on screen for about a second of every /bills visit, and the
    // current Legislature has 10,491 (issue #1996).
    expect(resultCountLine(null, 'bill')).toEqual({ figure: UNKNOWN_RESULT_COUNT, unit: null });
    expect(UNKNOWN_RESULT_COUNT).toBe('\u00a0');
  });

  it('still prints a verified zero as 0', () => {
    expect(resultCountLine(0, 'bill')).toEqual({ figure: '0', unit: 'bills' });
  });

  it('pluralizes on everything but exactly one', () => {
    expect(resultCountLine(1, 'legislator')).toEqual({ figure: '1', unit: 'legislator' });
    expect(resultCountLine(2, 'legislator')).toEqual({ figure: '2', unit: 'legislators' });
    expect(resultCountLine(10491, 'bill')).toEqual({ figure: '10,491', unit: 'bills' });
  });

  it('keeps both search screens passing an unknown count rather than a zero', () => {
    expect(source('screens/redesign/SearchBillsScreen.tsx')).toContain(
      'count={billsQuery.data ? resultCount : null}',
    );
    expect(source('screens/redesign/SearchLegislatorsScreen.tsx')).toContain(
      'count={rosterQuery.data ? filtered.length : null}',
    );
    // The unit noun is what the header hides while the figure is unknown, so it
    // cannot print a bare "bills" with nothing in front of it.
    expect(source('components/search/searchPieces.tsx')).toContain('resultCountLine(count, noun)');
  });
});
