import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { clearReadCache } from '../api/read';
import {
  NO_ADDRESS_LINE,
  Person,
  serviceTitle,
  SPLIT_LEAD,
  SPLIT_TITLE,
  timelineRows,
  type PersonRecord,
} from '../pages/Person';
import { loadSpelling } from '../pages/organization/data';
import { clearOrganizationLoads } from '../pages/organization/useLoad';
import { isBuilt, matchRoute } from '../routes';
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
vi.mock('../auth/session', () => ({
  useFinanceSession: () => ({ apiBaseUrl: 'https://api.example.test', accessToken: 'token' }),
}));
const profile: PersonRecord = {
  id: 'p',
  name: 'Example Person',
  service: [
    {
      id: 's',
      status: 'former',
      office: 'State Representative',
      votingArea: 'District 1A',
      startDate: '2021-01-01',
      endDate: '2024-01-01',
    },
  ],
  elections: [
    {
      candidateId: 'c',
      election: { id: 'e', date: '2024-11-05', type: 'general' },
      office: 'State Representative',
      votingArea: 'District 1A',
      source: { authority: 'Minnesota Secretary of State', checkedDate: '2024-11-20' },
      result: { status: 'certified', outcome: 'not-elected' },
    },
  ],
  legislator: { slug: 'example-person' },
};
let container: HTMLDivElement, root: Root;
beforeEach(() => {
  clearReadCache();
  clearOrganizationLoads();
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  window.history.replaceState(null, '', '/people/p');
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});
const json = (data: unknown, wrapped = true) =>
  new Response(JSON.stringify(wrapped ? { data } : data), {
    headers: { 'Content-Type': 'application/json' },
  });
async function render(answer: (url: URL) => Response) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string) => answer(new URL(input))),
  );
  await act(async () => root.render(<Person match={matchRoute('/people/p')!} />));
  for (let n = 0; n < 6; n++)
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
}
it('shows elections and service without treating a result as current service', async () => {
  await render((url) =>
    url.pathname.endsWith('/people/p')
      ? json(profile, false)
      : url.pathname.endsWith('/lookup')
        ? json(null)
        : json({ link_state: 'unconfirmed', years: [] }),
  );
  expect(container.textContent).toContain('Example Person');
  expect(container.textContent).toContain('Formerly served as State Representative');
  expect(container.textContent).toContain('Not elected · State Representative');
  expect(container.textContent).toContain('General election · District 1A · Election results');
  expect(container.textContent).not.toContain('Currently serving');
  expect(container.querySelector('a[href^="/candidates/c"]')).toBeTruthy();
  expect(container.querySelector('a[href^="/legislators/example-person"]')).toBeTruthy();
  // No link leaves for alethical.com or any of its subdomains (finance-architecture §7).
  const hosts = [...container.querySelectorAll('a')].map((a) => new URL(a.href).hostname);
  expect(hosts.some((host) => host === 'alethical.com' || host.endsWith('.alethical.com'))).toBe(
    false,
  );
});
it('reads a Finance person independently of a public candidate profile', async () => {
  await render((url) =>
    url.pathname.endsWith('/people/p')
      ? new Response(null, { status: 404 })
      : json({
          id: 'p',
          kind: 'person',
          name: 'Confirmed Payee',
          status: 'active',
          confirmations: [],
        }),
  );
  expect(container.textContent).toContain('Confirmed Payee');
  expect(container.textContent).not.toContain('This record is no longer available');
});
it('never turns a failed lookup into an empty or missing profile', async () => {
  await render(() => new Response(null, { status: 503 }));
  expect(container.textContent).toContain('We couldn’t load this record');
  expect(container.textContent).not.toContain('This record is no longer available');
});
it('does not infer current service from an election', () => {
  expect(serviceTitle({ ...profile.service[0], status: 'elected' })).toBe(
    'Elected to State Representative',
  );
  expect(serviceTitle({ ...profile.service[0], status: 'unknown' })).toContain(
    'Current service not confirmed',
  );
  expect(timelineRows(profile, null)[0].kind).toBe('ELECTION');
});
it('reads every identity fingerprint page with a pinned snapshot before choosing money rows', async () => {
  const paths: URL[] = [];
  const get = vi.fn(async (path: string) => {
    const url = new URL(path, 'https://api.example.test');
    paths.push(url);
    if (url.pathname.endsWith('/records'))
      return {
        state: 'ok' as const,
        data: {
          snapshot_id: 'same',
          pages: 2,
          page: Number(url.searchParams.get('page') ?? 1),
          fingerprints:
            url.searchParams.get('page') === '2'
              ? [
                  {
                    fingerprint: 'f',
                    fields: { amount: '8', receipt_date: '2026-01-01' },
                    confirmation: { identity: { id: 'person' } },
                    rows: [{ row_number: 3 }],
                  },
                ]
              : [],
        },
      };
    return {
      state: 'ok' as const,
      data: {
        state: 'reported',
        payments: [{ record_number: 3, amount: '8', received_on: '2026-01-01' }],
        page: { has_more: false },
        release_id: 'r',
        linkable_registration_numbers: [],
        source_url: null,
        fetched_at: null,
      },
    };
  });
  const result = await loadSpelling(get as never, 'person', { kind: 'donor_name', key: 'Person' });
  expect(paths[1].searchParams.get('snapshot_id')).toBe('same');
  expect(result?.payments).toHaveLength(1);
});
it('withholds records if the identity source changes between pages', async () => {
  let n = 0;
  const get = vi.fn(async () => ({
    state: 'ok',
    data: { snapshot_id: ++n === 1 ? 'first' : 'changed', pages: 2, page: n, fingerprints: [] },
  }));
  expect(await loadSpelling(get as never, 'p', { kind: 'donor_name', key: 'P' })).toBeNull();
});
const missing = () => new Response(null, { status: 404 });
it('a split record’s old reference opens the choice of the person meant', async () => {
  await render((url) =>
    url.pathname.endsWith('/people/p')
      ? missing()
      : json({
          id: 'p',
          kind: 'person',
          name: 'Split Person',
          status: 'split',
          split_into: [
            {
              id: 'a',
              reference: 'PER-0007',
              kind: 'person',
              name: 'Split Person A',
              status: 'active',
              confirmed_records: 3,
            },
            {
              id: 'b',
              reference: 'ORG-0012',
              kind: 'organization',
              name: 'Split Organization B',
              status: 'active',
              confirmed_records: null,
            },
            {
              id: 'c',
              reference: 'ORG-0013',
              kind: 'organization',
              name: 'Merged Organization C',
              status: 'merged',
              confirmed_records: null,
              redirect_to: 'd',
              redirect_to_reference: 'ORG-0020',
            },
          ],
          confirmations: [],
        }),
  );
  expect(container.querySelector('h1')?.textContent).toBe(SPLIT_TITLE);
  expect(container.textContent).toContain(SPLIT_LEAD);
  expect(container.textContent).toContain('Split Person A');
  const lines = [...container.querySelectorAll('.person-split-link')].map((row) => row.textContent);
  // The served reference and count; no count held reads the reference alone, never 0.
  expect(lines).toEqual([
    'Split Person APER-0007 · 3 confirmed records',
    'Split Organization BORG-0012',
    'Merged Organization CORG-0013',
  ]);
  // A part later merged opens the record it became.
  expect(container.querySelector('a[href^="/organizations/d"]')).not.toBeNull();
  // An organization part opens its profile; a person part links only once Person is on.
  expect(container.querySelector('a[href^="/organizations/b"]')?.getAttribute('href')).toBe(
    isBuilt('person') ? '/organizations/b?from=%2Fpeople%2Fp' : '/organizations/b',
  );
  expect(container.querySelector('a[href^="/people/a"]') !== null).toBe(isBuilt('person'));
  expect(container.textContent).not.toContain('Sources and updates');
});
it('a merged record’s reference opens the surviving record', async () => {
  window.history.replaceState(null, '', '/people/p?from=%2Fpeople');
  await render((url) =>
    url.pathname.endsWith('/people/p')
      ? missing()
      : json({
          id: 'p',
          kind: 'person',
          name: 'Merged Person',
          status: 'merged',
          redirect_to: 'survivor',
          confirmations: [],
        }),
  );
  expect(window.location.pathname).toBe('/people/survivor');
  expect(window.location.search).toBe('?from=%2Fpeople');
});
it('lists connected records as two-line rows and keeps the no-address line on its own', async () => {
  await render((url) =>
    url.pathname.endsWith('/people/p')
      ? json(profile, false)
      : url.pathname.endsWith('/lookup')
        ? json(null)
        : json({ link_state: 'unconfirmed', years: [] }),
  );
  const rows = [...container.querySelectorAll('.lg2-related .f-row-link')];
  expect(rows.map((row) => row.querySelector('.f-row-link-name')?.textContent)).toEqual([
    'View candidate profile',
    'View legislator profile',
  ]);
  expect(rows[0].querySelector('.f-row-link-note')?.textContent).toBe('2024 general');
  const lines = [...container.querySelectorAll('.f-sources .f-sources-line')].map(
    (p) => p.textContent,
  );
  expect(lines[lines.length - 1]).toBe(NO_ADDRESS_LINE);
  expect(container.textContent).toContain(
    'Candidacy and election results do not prove current service',
  );
  expect(container.textContent).not.toContain('current service.');
});
it('says Running for while an upcoming election’s result is pending', () => {
  const upcoming = {
    ...profile,
    elections: [
      {
        ...profile.elections[0],
        election: { id: 'e2', date: '2026-11-03', type: 'general' as const },
        result: { status: 'pending' as const },
      },
    ],
  };
  expect(timelineRows(upcoming, null, '2026-11-02')[0].title).toBe(
    'Running for State Representative',
  );
  expect(timelineRows(upcoming, null, '2026-11-02')[0].detail).toBe(
    'General election · District 1A · Election results pending',
  );
});
it('names each seat fact once when the served office repeats the voting area', () => {
  // The live record's shape: the office carries the district, and the voting area
  // names it again with its chamber.
  const live = {
    ...profile,
    elections: [
      {
        ...profile.elections[0],
        office: 'State Representative District 56A',
        votingArea: 'House District 56A',
        election: { id: 'e3', date: '2026-11-03', type: 'general' as const },
        result: { status: 'pending' as const },
      },
    ],
  };
  const [row] = timelineRows(live, null, '2026-11-02');
  expect(row.title).toBe('Running for State Representative');
  expect(row.detail).toBe('General election · District 56A · Election results pending');
});
it('returns to People when opened with no earlier page', async () => {
  window.history.replaceState(null, '', '/people/p');
  await render((url) =>
    url.pathname.endsWith('/people/p')
      ? json(profile, false)
      : url.pathname.endsWith('/lookup')
        ? json(null)
        : json({ link_state: 'unconfirmed', years: [] }),
  );
  const back = container.querySelector<HTMLAnchorElement>('.f-back');
  expect(back?.textContent).toBe('Back to People');
  expect(back?.getAttribute('href')).toBe('/people');
});
