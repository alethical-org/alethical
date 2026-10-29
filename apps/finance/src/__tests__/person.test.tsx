import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { clearReadCache } from '../api/read';
import { Person, serviceTitle, timelineRows, type PersonRecord } from '../pages/Person';
import { loadSpelling } from '../pages/organization/data';
import { clearOrganizationLoads } from '../pages/organization/useLoad';
import { matchRoute } from '../routes';
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
  expect(container.textContent).toContain('Not elected · Election results');
  expect(container.textContent).not.toContain('Currently serving');
  expect(container.querySelector('a[href^="/candidates/c"]')).toBeTruthy();
  expect(container.querySelector('a[href^="/legislators/example-person"]')).toBeTruthy();
  expect([...container.querySelectorAll('a')].some((a) => a.href.includes('alethical.com'))).toBe(
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
