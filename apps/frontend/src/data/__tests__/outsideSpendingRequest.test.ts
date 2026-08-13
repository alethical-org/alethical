import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const apiOrigin = 'https://api.example.test';

// What the outside-spending mapper must never turn a response into (#1332, #1454).
//
// The one that made this file necessary: the web app and the API deploy separately, so
// this page can briefly meet a server that predates the split payment counts. Defaulting
// those to 0 made every figure look like a checked zero and printed "nobody spent
// anything" over real money. Found by an adversarial review.

function payload(overrides: Record<string, unknown> = {}) {
  return {
    data: {
      legislator_id: 'leg-1',
      year: 2025,
      state: 'reported',
      snapshot_id: 'snap-1',
      supporting: '487974.8200',
      opposing: '162841.9500',
      direction_not_recorded: '0',
      payment_count: 101,
      supporting_payments: 74,
      opposing_payments: 27,
      direction_not_recorded_payments: 0,
      source_url: 'https://cfb.mn.gov/independent-expenditures.csv',
      fetched_at: '2026-08-12T02:54:00Z',
      committees: [
        {
          registration_number: '18488',
          committee_name: 'Fateh, Omar Senate Committee',
          office: 'State Senator',
          first_payment_on: '2025-02-03',
          last_payment_on: '2025-10-28',
        },
      ],
      ...overrides,
    },
  };
}

describe('getLegislatorOutsideSpendingFromApi', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv('EXPO_PUBLIC_API_URL', apiOrigin);
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockReset();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  async function read(body: unknown) {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    const { getLegislatorOutsideSpendingFromApi } = await import('../api');
    return getLegislatorOutsideSpendingFromApi('leg-1', 2025);
  }

  it('carries the figures, the committees that back them, and the download identity', async () => {
    const year = await read(payload());
    expect(year.state).toBe('reported');
    expect(year.supporting).toBe(487974.82);
    expect(year.supportingPayments).toBe(74);
    expect(year.snapshotId).toBe('snap-1');
    expect(year.committees).toEqual([
      {
        registrationNumber: '18488',
        name: 'Fateh, Omar Senate Committee',
        office: 'State Senator',
      },
    ]);
    // The span comes from the committees, so a member holding several gets one range
    // across all of them rather than any one committee's.
    expect(year.firstPaymentOn).toBe('2025-02-03');
    expect(year.lastPaymentOn).toBe('2025-10-28');
  });

  it('refuses a reported year that arrived without every payment count', async () => {
    // Exactly what the server on main returns: `payment_count` and no split. Defaulting
    // the splits to 0 made the page print "nobody spent anything" over $487,974.82.
    const year = await read(
      payload({
        supporting_payments: undefined,
        opposing_payments: undefined,
        direction_not_recorded_payments: undefined,
      }),
    );
    expect(year.state).toBe('load_failed');
    expect(year.supporting).toBeNull();
    expect(year.supportingPayments).toBeNull();
    expect(year.year).toBe(2025);
  });

  it('refuses when even one of the 3 counts is missing', async () => {
    const year = await read(payload({ opposing_payments: null }));
    expect(year.state).toBe('load_failed');
    expect(year.opposing).toBeNull();
  });

  it('keeps a state it does not recognise out of the figures', async () => {
    // A state we cannot read is our gap, never a figure about a person.
    const year = await read(payload({ state: 'something_new' }));
    expect(year.state).toBe('unavailable');
  });

  it('passes an unconfirmed link through untouched, counts and all', async () => {
    // Today's answer for every legislator. It has no counts, and that must not be
    // mistaken for the missing-counts case above and relabelled as a failed load.
    const year = await read(
      payload({
        state: 'link_unconfirmed',
        supporting: null,
        opposing: null,
        direction_not_recorded: null,
        payment_count: null,
        supporting_payments: null,
        opposing_payments: null,
        direction_not_recorded_payments: null,
        committees: [],
      }),
    );
    expect(year.state).toBe('link_unconfirmed');
    expect(year.supporting).toBeNull();
    expect(year.sourceUrl).toContain('cfb.mn.gov');
  });
});
