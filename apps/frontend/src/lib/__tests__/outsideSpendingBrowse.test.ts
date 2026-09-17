import { describe, expect, it } from 'vitest';
import {
  outsideBrowseChange,
  outsideBrowseMode,
  outsideBrowsePeriod,
  outsideBrowseReturn,
} from '../outsideSpendingBrowse';
import { outsideSpendingRecordPageFromPayload } from '../outsideSpending';
import { pathForRoute, stateFromPathname } from '../../navigation/webRoutes';

describe('outside-spending browse addresses', () => {
  it('shares both role and name searches without treating punctuation as address syntax', () => {
    const params = { browse: 'committees', year: '2024', q: 'A & B / 100% #1', page: '3' };
    const path = pathForRoute({ name: 'OutsideSpending', params });
    expect(path).toContain('browse=committees');
    const url = new URL(path, 'https://www.alethical.com');
    expect(stateFromPathname(url.pathname + url.search).routes.at(-1)?.params).toMatchObject(
      params,
    );
  });
  it('clears the old page and subject when filters change, with safe defaults', () => {
    expect(outsideBrowseMode('unknown')).toBe('groups');
    expect(
      outsideBrowseChange(
        { browse: 'groups', q: 'old', page: '9', year: '2024', spender: '1' },
        { browse: 'committees', q: undefined },
      ),
    ).toMatchObject({
      browse: 'committees',
      q: undefined,
      page: undefined,
      year: '2024',
      spender: undefined,
    });
  });
  it('accepts only local browse returns and gives shared subject links a role/year fallback', () => {
    expect(outsideBrowseReturn({ spender: '-9', year: '2024' })).toBe(
      '/money/outside-spending?browse=groups&year=2024',
    );
    expect(
      outsideBrowseReturn({
        about: '1',
        year: '2025',
        returnTo: 'https://evil.test/money/outside-spending',
      }),
    ).toBe('/money/outside-spending?browse=committees&year=2025');
    expect(
      outsideBrowseReturn({ spender: '1', returnTo: '/money/outside-spending?spender=2' }),
    ).toBe('/money/outside-spending?browse=groups');
    expect(
      outsideBrowseReturn({
        spender: '1',
        returnTo: '/money/outside-spending?browse=groups&q=ma&page=2',
      }),
    ).toBe('/money/outside-spending?browse=groups&q=ma&page=2');
  });
  it('retains the source identity and labels the actual served period', () => {
    const page = outsideSpendingRecordPageFromPayload({
      state: 'reported',
      snapshot_id: 'source-1',
      year: 2024,
    });
    expect(page.snapshotId).toBe('source-1');
    expect(outsideBrowsePeriod(page)).toBe('2024');
    expect(outsideBrowsePeriod({ ...page, year: null })).toBe('All years');
  });
});
