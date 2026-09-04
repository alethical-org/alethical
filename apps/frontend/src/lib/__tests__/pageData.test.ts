// @vitest-environment jsdom

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

import { committeeRegisterQueryKey } from '../committeeList';
import { moneyByRaceQueryKey } from '../moneyByRace';
import { campaignFinanceFilingsQueryKey, campaignFinanceSummaryQueryKey } from '../moneyLanding';
import { outsideSpendingRecordQueryKey } from '../outsideSpending';
import {
  PAGE_DATA_ELEMENT_ID,
  PAGE_DATA_MARKER_END,
  PAGE_DATA_MARKER_START,
  injectPageData,
  renderPageData,
  resetSeededPayloadsForTests,
  seededQueryData,
  takeSeededPayload,
} from '../pageData';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');

function source(path: string) {
  return readFileSync(join(ROOT, path), 'utf8');
}

/** The one document the reader's browser parses, rebuilt from a served block. */
function loadPage(dataBlock: string) {
  document.body.innerHTML = dataBlock;
  resetSeededPayloadsForTests();
}

afterEach(() => {
  document.body.innerHTML = '';
  resetSeededPayloadsForTests();
});

describe('handing a page the records the server already read', () => {
  it('carries the payload for one key and hands it back once', () => {
    const key = committeeRegisterQueryKey({ page: 1, pageSize: 50 });
    loadPage(renderPageData([{ key, payload: { state: 'reported', register_total: 1603 } }]));

    expect(takeSeededPayload(key)).toEqual({ state: 'reported', register_total: 1603 });
    // Consumed, so a later refetch of the same list goes to the data service and a
    // reader who sits on the page is not held on the first response's copy.
    expect(takeSeededPayload(key)).toBeUndefined();
  });

  it('is a data block, not a script the page runs', () => {
    const block = renderPageData([{ key: ['k'], payload: { a: 1 } }]);

    // `vercel.json` allows inline scripts only by hash. A block with a
    // non-executable type is never run, so it needs no hash and adds nothing to
    // `script-src` — the same reason the shell's application/ld+json blocks work.
    expect(block).toContain(`<script type="application/json" id="${PAGE_DATA_ELEMENT_ID}">`);
    expect(block).not.toContain('<script>');
  });

  it('escapes a payload that would otherwise close the block early', () => {
    const nasty = { name: '</script><script>alert(1)</script>', note: 'a & b' };
    const block = renderPageData([{ key: ['k'], payload: nasty }]);

    expect(block).not.toContain('</script><script>');
    expect(block.match(/<\/script>/g)).toHaveLength(1);

    loadPage(block);
    expect(takeSeededPayload(['k'])).toEqual(nasty);
  });

  it('serves nothing at all when the page read nothing', () => {
    expect(renderPageData([])).toBe('');
  });

  it('leaves a key the app did not ask for unread', () => {
    loadPage(
      renderPageData([
        { key: committeeRegisterQueryKey({ page: 2, pageSize: 50 }), payload: { state: 'ok' } },
      ]),
    );

    // Page 2's rows must never answer page 1's question. A key that does not match
    // is simply absent, so the app fetches exactly as it did before.
    expect(takeSeededPayload(committeeRegisterQueryKey({ page: 1, pageSize: 50 }))).toBeUndefined();
  });

  it('falls back to fetching on a block that cannot be read', () => {
    for (const broken of [
      `<script type="application/json" id="${PAGE_DATA_ELEMENT_ID}">not json</script>`,
      `<script type="application/json" id="${PAGE_DATA_ELEMENT_ID}">{"key":["k"]}</script>`,
      `<script type="application/json" id="${PAGE_DATA_ELEMENT_ID}">[{"payload":{}}]</script>`,
      `<script type="application/json" id="${PAGE_DATA_ELEMENT_ID}">[{"key":["k"],"payload":7}]</script>`,
      '',
    ]) {
      loadPage(broken);
      expect(takeSeededPayload(['k'])).toBeUndefined();
    }
  });

  it('drops a payload its shaper cannot read rather than half-drawing it', () => {
    loadPage(renderPageData([{ key: ['k'], payload: { rows: null } }]));
    const read = seededQueryData(['k'], () => {
      throw new Error('unreadable');
    });

    // `undefined` is how React Query is told there is no initial data, so the
    // query fetches. Never a blank screen and never a half-shaped figure.
    expect(read()).toBeUndefined();
  });

  it('shapes the payload with the app’s own reader, so a seeded figure equals a fetched one', () => {
    const payload = { state: 'reported', register_total: 1603 };
    loadPage(renderPageData([{ key: ['k'], payload }]));

    expect(seededQueryData(['k'], (raw: typeof payload) => raw.register_total)()).toBe(1603);
  });

  it('takes the block out of the document once it is read', () => {
    loadPage(renderPageData([{ key: ['k'], payload: { a: 1 } }]));
    takeSeededPayload(['k']);

    // A 271 KB payload has no business sitting in the page for the rest of the visit.
    expect(document.getElementById(PAGE_DATA_ELEMENT_ID)).toBeNull();
  });

  it('refuses a shell with no slot for the block', () => {
    expect(() => injectPageData('<html></html>', '<script></script>')).toThrow();
    expect(
      injectPageData(
        `<body>${PAGE_DATA_MARKER_START}${PAGE_DATA_MARKER_END}</body>`,
        '<script>x</script>',
      ),
    ).toContain(`${PAGE_DATA_MARKER_START}<script>x</script>`);
  });
});

describe('the seeded keys are the keys the app asks for', () => {
  /**
   * A key written out twice is 2 chances to drift, and a drifted key seeds
   * nothing and improves nothing — silently, because the page still works. So one
   * builder per read, shared by the hook and by `api/page.ts`, and these are the
   * exact keys the hooks used before the builders existed.
   */
  it('builds the money keys the hooks had written out by hand', () => {
    expect(campaignFinanceSummaryQueryKey()).toEqual(['campaign-finance-summary']);
    expect(campaignFinanceFilingsQueryKey(5)).toEqual(['campaign-finance-filings', 5]);
    expect(moneyByRaceQueryKey({ year: 2026 })).toEqual(['campaign-finance-races', 2026, 'all']);
    expect(moneyByRaceQueryKey({ year: 2026, office: 'senate' })).toEqual([
      'campaign-finance-races',
      2026,
      'senate',
    ]);
    expect(committeeRegisterQueryKey({ page: 1, pageSize: 50 })).toEqual([
      'campaign-finance-committees',
      'all',
      '',
      1,
      50,
    ]);
    expect(
      committeeRegisterQueryKey({ kind: 'party_unit', query: 'dfl', page: 3, pageSize: 50 }),
    ).toEqual(['campaign-finance-committees', 'party_unit', 'dfl', 3, 50]);
    expect(outsideSpendingRecordQueryKey({ year: null, sort: 'newest', page: 1 })).toEqual([
      'outside-spending-record',
      null,
      null,
      null,
      'newest',
      1,
    ]);
    expect(
      outsideSpendingRecordQueryKey({ about: '20963', year: 2026, sort: 'largest', page: 2 }),
    ).toEqual(['outside-spending-record', '20963', null, 2026, 'largest', 2]);
  });

  it('leaves no money query key written out inside the hooks', () => {
    const hooks = source('hooks/useAppQueries.ts');

    for (const builder of [
      'campaignFinanceSummaryQueryKey',
      'campaignFinanceFilingsQueryKey',
      'moneyByRaceQueryKey',
      'committeeRegisterQueryKey',
      'outsideSpendingRecordQueryKey',
    ]) {
      expect(hooks).toContain(`${builder}(`);
    }
    for (const literal of [
      "queryKey: ['campaign-finance-summary']",
      "queryKey: ['campaign-finance-filings'",
      "queryKey: ['campaign-finance-races'",
      "queryKey: ['campaign-finance-committees'",
      "'outside-spending-record',",
    ]) {
      expect(hooks).not.toContain(literal);
    }
  });
});
