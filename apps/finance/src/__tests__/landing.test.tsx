import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { SupabaseClient } from '@supabase/supabase-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SessionProvider } from '../auth/session';
import { screensApproved } from '../config';
import {
  copyDate,
  fetchCounts,
  figureGroups,
  recordsHeading,
  type ServedCounts,
} from '../landing/counts';
import { FinanceSite, PublicSite } from '../landing/PublicSite';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const API = 'https://api.example.test';

const SERVED: ServedCounts = {
  national_fcc_filings: {
    state: 'reported',
    count: 19647383,
    first_year: 2012,
    last_year: 2026,
    copied_at: null,
    as_of: '2026-11-22',
  },
  election_races_with_results: {
    state: 'reported',
    count: 5023,
    first_year: 2026,
    last_year: 2026,
    copied_at: '2026-11-18T15:00:00+00:00',
    election_label: 'November 2026 general election',
    results_status: 'unofficial',
  },
  campaign_money_records: {
    state: 'reported',
    count: 1084277,
    first_year: 2015,
    last_year: 2026,
    copied_at: '2026-09-01T11:30:00+00:00',
  },
  lobbying_spending_reports: {
    state: 'reported',
    count: 17842,
    first_year: 2014,
    last_year: 2025,
    copied_at: '2026-08-28T15:00:00+00:00',
    organizations: 3184,
  },
  current_legislature_bills: {
    state: 'reported',
    count: 10518,
    first_year: 2025,
    last_year: 2026,
    copied_at: '2026-07-14T18:48:17+00:00',
    roll_calls: 568,
  },
  tv_station_files: {
    state: 'unavailable',
    count: null,
    first_year: null,
    last_year: null,
    copied_at: null,
  },
};

function fakeSupabase(session: { access_token: string; user: { email: string } } | null = null) {
  return {
    auth: {
      getSession: vi.fn(async () => ({ data: { session } })),
      onAuthStateChange: vi.fn(() => ({
        data: { subscription: { unsubscribe() {} } },
      })),
      signOut: vi.fn(async () => ({ error: null })),
    },
  } as unknown as SupabaseClient;
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

async function renderAt(
  path: string,
  counts: unknown = { data: SERVED },
  status = 200,
  {
    session = null as Parameters<typeof fakeSupabase>[0],
    screens = false,
    accessStatus = 200,
  } = {},
) {
  window.history.replaceState(null, '', path);
  const fetcher = vi.fn(async (url: string) =>
    url.endsWith('/landing/counts')
      ? new Response(JSON.stringify(counts), { status })
      : new Response(null, { status: accessStatus }),
  );
  vi.stubGlobal('fetch', fetcher);
  await act(async () => {
    root.render(
      <SessionProvider supabase={fakeSupabase(session)} apiBaseUrl={API} screens={screens}>
        {screens ? <FinanceSite screens /> : <PublicSite />}
      </SessionProvider>,
    );
  });
  await act(async () => {});
  return fetcher;
}

describe('the public Finance site', () => {
  it('prints the hero, every heading and a line from each section', async () => {
    await renderAt('/');
    const text = container.textContent ?? '';
    for (const words of [
      'A clearer view of money and media in elections and legislation',
      'Today, bring your question to our team.',
      'Contact our team',
      'Start with a name, follow the connections',
      'We’re building an AI analyst to help researchers follow the same trail.',
      'See who gives, who spends and who gets paid',
      'Compare political money with election results',
      'What we’re building',
      'Bring your own research',
      'See what changed',
      'Finish a brief with your team',
      'More than 20 million public records',
      'NATIONWIDE',
      'MINNESOTA',
      'Share Alethical.AI',
      'Sources and updates',
      'Minnesota Campaign Finance and Public Disclosure Board',
      'Federal Communications Commission',
    ]) {
      expect(text).toContain(words);
    }
    for (const gone of [
      'Put your research to work',
      'Build on your research',
      'Go straight to the evidence',
      'Keep client work moving',
      'law firms',
      'Alethical Finance',
    ]) {
      expect(text).not.toContain(gone);
    }
    expect(text).toContain('Alethical.AI is the professional research product on the');
    expect(text).not.toContain('Printed names not yet confirmed');
    expect(text).not.toContain('alethical.ai');
    expect(document.title).toBe('Alethical.AI');
  });

  it('copies the primary Finance address from the landing page', async () => {
    const writeText = vi.fn(async () => {});
    vi.stubGlobal(
      'navigator',
      Object.assign(Object.create(navigator), {
        clipboard: { writeText },
      }),
    );
    await renderAt('/');
    const share = [...container.querySelectorAll('button')].find(
      (button) => button.textContent === 'Share Alethical.AI',
    );
    expect(share).toBeDefined();
    await act(async () => share!.click());
    expect(writeText).toHaveBeenCalledWith('https://alethical.ai/');
    expect(container.querySelector('[data-copied="true"]')?.textContent).toBe('Link copied');
  });

  it('links For investors from the header and Contact our team to the company form', async () => {
    await renderAt('/', { data: SERVED }, 200, { screens: true });
    const contact = [...container.querySelectorAll('a')].find(
      (a) => a.textContent === 'Contact our team',
    );
    expect(contact?.getAttribute('href')).toBe(
      'https://www.alethical.com/about/contact?purpose=alethical-ai',
    );
    expect(contact?.closest('.lp-hero-copy')).not.toBeNull();
    expect(container.querySelector('a[href="https://www.alethical.com/"]')?.textContent).toBe(
      'Alethical platform',
    );
    expect(
      [...container.querySelectorAll('a')].some((a) => a.textContent === 'Investor access'),
    ).toBe(false);
    const logos = container.querySelectorAll('[role="img"][aria-label="Alethical.AI"]');
    expect(logos.length).toBe(2);
    const investors = container.querySelector<HTMLAnchorElement>('.lp-top a[href="/investors"]')!;
    expect(investors.textContent).toBe('For investors');
    for (const link of container.querySelectorAll('.lp-bar a')) {
      expect(link.getAttribute('tabindex')).toBe('-1');
    }
    await act(async () => investors.click());
    expect(window.location.pathname).toBe('/investors');
    expect(document.title).toBe('Alethical.AI for investors');
    expect(container.querySelector('h1')?.textContent).toBe('Alethical.AI for investors');
    expect(container.querySelector('a[aria-current="page"]')?.textContent).toBe('For investors');
    expect(container.textContent).not.toMatch(/SAFE|minimum investment/i);
    const access = [...container.querySelectorAll('a')].filter(
      (a) => a.textContent === 'Investor access',
    );
    expect(access).toHaveLength(1);
    await act(async () => access[0].click());
    expect(window.location.pathname).toBe('/investor-access');
    expect(container.querySelector('h1')?.textContent).toBe('Investor access');
    expect(container.querySelector('label')?.textContent).toBe('Code');
    const home = container.querySelector<HTMLAnchorElement>('a[aria-label="Alethical.AI"]');
    expect(home?.getAttribute('href')).toBe('/');
    expect(document.activeElement).toBe(container.querySelector('h1'));
    expect(container.querySelector('#password')?.getAttribute('type')).toBe('text');
    expect(container.querySelector('input[type="email"]')).toBeNull();
    expect(container.textContent).not.toContain('Sign in with email');
    await act(async () => home!.click());
    expect(window.location.pathname).toBe('/');
  });

  it('reads the counts live and hides one the server could not read', async () => {
    const fetcher = await renderAt('/');
    expect(fetcher).toHaveBeenCalledWith(`${API}/api/v1/finance/landing/counts`);
    expect(fetcher).toHaveBeenCalledTimes(1);
    const text = container.textContent ?? '';
    expect(text).toContain('19.6 million');
    expect(text).toContain('Indexed nationwide since 2012');
    expect(text).toContain('As of Nov 22, 2026');
    expect(text).toContain('1,084,277');
    expect(text).toContain('From 3,184 organizations, 2014 to 2025');
    expect(text).toContain('2025–2026 Legislature, with 568 roll calls');
    expect(text).toContain(
      'November 2026 general election. Results were unofficial at the time of this count.',
    );
    // The Minnesota figures' dates differ, so the group gives their range and
    // each source says its own.
    expect(text).toContain('As of Jul 14 to Nov 18, 2026');
    expect(text).toContain('Campaign money copied Sep 1, 2026');
    expect(text).toContain('Lobbying copied Aug 28, 2026');
    expect(text).toContain('Copied Nov 18, 2026');
    expect(text).toContain('Updated Jul 14, 2026');
    expect(text).not.toContain('Nationwide index as of');
    // The station files stay named; their unsupported date is said, not guessed.
    expect(text).toContain('Station files: copy date not recorded');
    expect(text).not.toContain('TV station files on political ad time');
    const sourceLinks = [...container.querySelectorAll('.lp-sources a')].map((a) =>
      a.getAttribute('href'),
    );
    expect(sourceLinks).toEqual([
      'https://cfb.mn.gov/',
      'https://www.leg.mn.gov/',
      'https://publicfiles.fcc.gov/',
      'https://www.sos.state.mn.us/',
    ]);
  });

  it('shows no count tiles, and no 0, when the counts cannot be read', async () => {
    await renderAt('/', { detail: 'down' }, 503);
    const text = container.textContent ?? '';
    expect(text).not.toContain('million public records');
    expect(text).not.toContain('NATIONWIDE');
    expect(text).toContain('Sources and updates');
    expect(container.querySelector('.lp-figure-value')).toBeNull();
  });

  it.each(['/money', '/media-buys/review', '/search', '/nope'])(
    'shows not-found at %s until the screens are approved',
    async (path) => {
      await renderAt(path);
      expect(container.textContent).toContain('Couldn’t find that page');
      expect(container.querySelector('.lp')).toBeNull();
    },
  );

  it('focuses nothing on arrival, though the sign-in state settles after the first draw', async () => {
    await renderAt('/');
    expect(container.querySelector('.lp')).not.toBeNull();
    expect(document.activeElement).toBe(document.body);
  });

  it('moves focus to the new heading after Sign in is followed', async () => {
    await renderAt('/');
    const signIn = container.querySelector<HTMLAnchorElement>('.lp-top a[href="/sign-in"]')!;
    await act(async () => {
      signIn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }));
    });
    expect(window.location.pathname).toBe('/sign-in');
    expect(document.activeElement?.tagName).toBe('H1');
  });

  it.each(['/sign-in', '/auth/return'])('answers %s, not with not-found', async (path) => {
    await renderAt(path);
    expect(container.textContent).not.toContain('Couldn’t find that page');
    expect(container.querySelector('main h1')).not.toBeNull();
  });

  it('offers Try again on sign-in when a signed-in account’s access cannot be checked', async () => {
    await renderAt('/sign-in', undefined, 200, {
      session: { access_token: 't', user: { email: 'reader@example.test' } },
      accessStatus: 503,
    });
    expect(container.textContent).toContain('Couldn’t check your access');
    expect(container.textContent).toContain('Try again');
  });

  it('tells a signed-in account that is not on the list, at the landing address', async () => {
    await renderAt('/', undefined, 200, {
      session: { access_token: 't', user: { email: 'reader@example.test' } },
      accessStatus: 403,
    });
    expect(container.textContent).toContain('This account doesn’t have access');
  });

  it('serves the full app only when the screens are approved', async () => {
    await renderAt('/money', undefined, 200, { screens: true });
    expect(window.location.pathname).toBe('/sign-in');
    expect(container.textContent).not.toContain('Couldn’t find that page');
  });

  it('keeps the screens off unless the setting is on', () => {
    expect(screensApproved({})).toBe(false);
    expect(screensApproved({ VITE_FINANCE_SCREENS: 'off' })).toBe(false);
    expect(screensApproved({ VITE_FINANCE_SCREENS: 'yes' })).toBe(false);
    expect(screensApproved({ VITE_FINANCE_SCREENS: ' on ' })).toBe(true);
  });
});

describe('landing counts', () => {
  it('never draws a 0, a negative or a missing count', () => {
    const groups = figureGroups({
      campaign_money_records: { ...SERVED.campaign_money_records!, count: 0 },
      lobbying_spending_reports: {
        ...SERVED.lobbying_spending_reports!,
        count: -1,
      },
      current_legislature_bills: {
        ...SERVED.current_legislature_bills!,
        count: null,
      },
      election_races_with_results: { ...SERVED.election_races_with_results!, state: 'unavailable' },
      national_fcc_filings: { ...SERVED.national_fcc_filings!, count: null },
      tv_station_files: {
        state: 'reported',
        count: 5070,
        first_year: 2022,
        last_year: 2026,
        copied_at: null,
      },
    });
    expect(groups).toEqual([]);
    expect(recordsHeading(groups)).toBe('Public records');
  });

  it('drops clauses it cannot support and leaves an undated group undated', () => {
    const [group] = figureGroups({
      lobbying_spending_reports: {
        ...SERVED.lobbying_spending_reports!,
        organizations: 0,
        first_year: null,
      },
      current_legislature_bills: { ...SERVED.current_legislature_bills!, roll_calls: null },
      election_races_with_results: {
        ...SERVED.election_races_with_results!,
        results_status: 'official',
        copied_at: null,
      },
    });
    expect(group.figures.map((figure) => figure.span)).toEqual([
      '2025',
      '2025–2026 Legislature',
      'November 2026 general election',
    ]);
    expect(group.date).toBeNull();
  });

  it('rounds the nationwide count down and reads its day without shifting it', () => {
    const [national, minnesota] = figureGroups(SERVED);
    expect(national.figures[0].value).toBe('19.6 million');
    expect(national.date).toBe('Nov 22, 2026');
    expect(minnesota.date).toBe('Jul 14 to Nov 18, 2026');
    const sameDay = figureGroups({
      campaign_money_records: SERVED.campaign_money_records,
      lobbying_spending_reports: {
        ...SERVED.lobbying_spending_reports!,
        copied_at: '2026-09-01T15:00:00+00:00',
      },
    });
    expect(sameDay[0].date).toBe('Sep 1, 2026');
    const acrossYears = figureGroups({
      campaign_money_records: SERVED.campaign_money_records,
      lobbying_spending_reports: {
        ...SERVED.lobbying_spending_reports!,
        copied_at: '2025-12-30T15:00:00+00:00',
      },
    });
    expect(acrossYears[0].date).toBe('Dec 30, 2025 to Sep 1, 2026');
    expect(
      figureGroups({
        national_fcc_filings: { ...SERVED.national_fcc_filings!, count: 19999999 },
      })[0].figures[0].value,
    ).toBe('19.9 million');
    expect(recordsHeading([national, minnesota])).toBe('More than 20 million public records');
    const exact = [{ ...national, figures: [{ ...national.figures[0], count: 20_000_000 }] }];
    expect(recordsHeading(exact)).toBe('More than 19 million public records');
  });

  it('dates in Minnesota time', () => {
    // 2:00 UTC on 2 Sep is still 1 Sep in Minnesota.
    const counts: ServedCounts = {
      campaign_money_records: {
        ...SERVED.campaign_money_records!,
        copied_at: '2026-09-02T02:00:00+00:00',
      },
    };
    expect(copyDate(counts, 'campaign_money_records')).toBe('Sep 1, 2026');
    expect(copyDate(counts, 'tv_station_files')).toBeNull();
  });

  it('answers no counts when the request fails or the answer is malformed', async () => {
    const failing = vi.fn(async () => {
      throw new TypeError('offline');
    }) as unknown as typeof fetch;
    expect(await fetchCounts(API, failing)).toEqual({});
    const malformed = vi.fn(async () => new Response('not json')) as unknown as typeof fetch;
    expect(await fetchCounts(API, malformed)).toEqual({});
  });
});

describe('the connections diagram', () => {
  it('names the supported paths for phone readers and assistive technology', async () => {
    await renderAt('/');
    const diagram = container.querySelector('figure[aria-label="Records connected"]')!;
    const paths = [...diagram.querySelectorAll('.lp-named-paths > li')].map((row) => ({
      sources: row.querySelector('.lp-path-source')!.textContent!.replace(/:$/, '').split(', '),
      targets: [...row.querySelectorAll('.lp-path-targets > li')].map(
        (target) => target.textContent,
      ),
    }));
    const targetsOf = (source: string) =>
      paths.find(({ sources }) => sources.includes(source))!.targets;
    expect(
      paths.reduce((sum, { sources, targets }) => sum + sources.length * targets.length, 0),
    ).toBe(56);
    expect(targetsOf('Contributions')).toEqual([
      'Campaign committees',
      'Committees and Funds',
      'Party Units',
    ]);
    expect(targetsOf('Outside spending')).toEqual([
      'Supports Candidates',
      'Opposes Candidates',
      'Races and results',
    ]);
    expect(paths).toContainEqual({
      sources: [
        'Campaign committees',
        'Committees and Funds',
        'Party Units',
        'Media agencies',
        'Buyers and signers',
      ],
      targets: ['TV ad buys'],
    });
    expect(paths).toContainEqual({
      sources: ['People', 'Organizations'],
      targets: ['Testimony', 'Documented involvement Bills', 'Issues and regulatory activity'],
    });
  });
});
