import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { clearReadCache } from '../api/read';
import { AgencySimilarNames } from '../pages/media/AgencySimilarNames';
import { PrintedAgency } from '../pages/StationRecords';
import { matchRoute } from '../routes';
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const session = {
  apiBaseUrl: 'https://api.example.test',
  accessToken: 'token',
  retry: vi.fn(),
};
vi.mock('../auth/session', () => ({ useFinanceSession: () => session }));
let container: HTMLDivElement, root: Root, requests: URL[];
const json = (data: unknown) => new Response(JSON.stringify({ data }), { status: 200 });
const similar = (url: URL, overrides = {}) => ({
  key: 'agency',
  name: 'Exact Agency',
  version: 'aaaaaaaaaaaaaaaa',
  excluded_keys: url.searchParams.getAll('exclude_key'),
  offset: Number(url.searchParams.get('offset')),
  limit: 3,
  has_more: false,
  rows: [
    {
      key: 'other',
      label: ' Exact Agency ',
      file_count: 2,
      stations: ['KARE', 'KSTP-TV'],
      unchecked: true,
    },
    {
      key: 'checked',
      label: 'Agency Checked',
      file_count: 1,
      stations: ['KARE'],
      unchecked: false,
    },
  ],
  ...overrides,
});
async function settle() {
  for (let i = 0; i < 5; i++)
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
}
async function render(answer: (url: URL) => Response = (url) => json(similar(url))) {
  window.history.replaceState(null, '', '/media-buys/agencies/agency');
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string) => {
      const url = new URL(input);
      requests.push(url);
      if (url.pathname.endsWith('/similar-names')) return answer(url);
      return json({
        key: 'agency',
        name: 'Exact Agency',
        unchecked: true,
        groups: [],
        addresses: [],
      });
    }),
  );
  await act(async () =>
    root.render(<PrintedAgency match={matchRoute('/media-buys/agencies/agency')!} />),
  );
  await settle();
}
beforeEach(() => {
  clearReadCache();
  session.accessToken = 'token';
  session.retry.mockClear();
  requests = [];
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});
const card = () => container.querySelector<HTMLElement>('[aria-labelledby="agency-similar-h"]')!;
const button = (name: string) =>
  [...card().querySelectorAll('button')].find((x) => x.textContent === name)!;
it('lists source spelling, held files/stations and checked status without inferring identity', async () => {
  await render();
  expect(
    requests
      .find((url) => url.pathname.endsWith('/similar-names'))
      ?.searchParams.get('exclude_strong'),
  ).toBeNull();
  expect(card()?.textContent).toContain('Similar agency names');
  expect(card().querySelectorAll('a')).toHaveLength(1);
  await act(async () => button('Show more').click());
  await settle();
  const links = card().querySelectorAll('a');
  expect(links[0].textContent).toContain('“ Exact Agency ”');
  expect(links[0].textContent).toContain('2 files · KARE, KSTP-TV · Not checked');
  expect(links[1].textContent).toContain('1 file · KARE · Checked');
  expect(links[0].getAttribute('href')).toContain('/media-buys/agencies/other?from=');
  expect(card().textContent).not.toContain('Each name keeps');
});
it('pins further names and replaces the complete list after a source change', async () => {
  let changed = false;
  await render((url) => {
    if (url.searchParams.get('offset') === '3' && !changed) {
      changed = true;
      return new Response(
        JSON.stringify({
          type: 'https://api.alethical.com/problems/records-changed',
        }),
        { status: 409 },
      );
    }
    return json(
      similar(url, {
        has_more: !changed,
        rows: [
          {
            key: 'row',
            label: changed ? 'Fresh agency' : 'Old agency',
            file_count: 1,
            stations: ['KARE'],
            unchecked: true,
          },
        ],
      }),
    );
  });
  await act(async () => button('Show more').click());
  await settle();
  expect(
    requests.find((x) => x.searchParams.get('offset') === '3')?.searchParams.get('version'),
  ).toBe('aaaaaaaaaaaaaaaa');
  expect(card().textContent).toContain('Old agency');
  expect(card().textContent).toContain('These records changed');
  await act(async () => button('Try again').click());
  await settle();
  expect(card().textContent).toContain('Fresh agency');
  expect(card().textContent).not.toContain('Old agency');
});
it('keeps prior rows after a failed next page and clears them after access is revoked', async () => {
  let denied = false;
  await render((url) =>
    url.searchParams.get('offset') === '3'
      ? new Response(null, { status: denied ? 403 : 500 })
      : json(similar(url, { has_more: true })),
  );
  await act(async () => button('Show more').click());
  await settle();
  await act(async () => button('Show more').click());
  await settle();
  expect(card().textContent).toContain('Previous results are shown');
  expect(card().textContent).toContain('Agency Checked');
  denied = true;
  await act(async () => button('Try again').click());
  await settle();
  expect(card().textContent).not.toContain('Agency Checked');
  expect(session.retry).toHaveBeenCalled();
});
it('keeps unavailable reads distinct from no matches', async () => {
  await render(() => new Response(null, { status: 503 }));
  expect(card()?.textContent).toContain('We couldn’t load similar agency names');
  expect(card().textContent).not.toContain('None found');
});

it('labels held names with their own agency during a slow scope change and restarts at the first page on return', async () => {
  let finish: ((value: Response) => void) | undefined;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string) => {
      const url = new URL(input);
      requests.push(url);
      if (url.pathname.includes('/new-agency/'))
        return new Promise<Response>((resolve) => {
          finish = resolve;
        });
      return json(
        similar(url, {
          has_more: Number(url.searchParams.get('offset')) === 0,
        }),
      );
    }),
  );
  const show = async (key: string) => {
    await act(async () =>
      root.render(<AgencySimilarNames agencyKey={key} here={`/media-buys/agencies/${key}`} />),
    );
    await settle();
  };
  await show('agency');
  await act(async () => button('Show more').click());
  await settle();
  await show('new-agency');
  expect(card().textContent).toContain('Similar to Exact Agency');
  expect(card().textContent).toContain('Updating');
  expect(card().textContent).toContain('Agency Checked');
  await act(async () =>
    finish!(
      json(
        similar(new URL('https://example.test?offset=0'), {
          key: 'new-agency',
          name: 'New Agency',
          rows: [],
          has_more: false,
        }),
      ),
    ),
  );
  await settle();
  expect(card().textContent).not.toContain('Exact Agency');
  await show('agency');
  expect(card().querySelectorAll('li')).toHaveLength(1);
  expect(button('Show more')).toBeTruthy();
});

it('does not carry a pending Show more focus target into another agency', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string) => {
      const url = new URL(input);
      if (url.searchParams.get('offset') === '3') return new Promise<Response>(() => {});
      const changed = url.pathname.includes('/new-agency/');
      return json(
        similar(url, {
          key: changed ? 'new-agency' : 'agency',
          has_more: !changed,
          rows: Array.from({ length: changed ? 4 : 2 }, (_, i) => ({
            key: `name-${i}`,
            label: `Name ${i}`,
            file_count: 1,
            stations: [],
            unchecked: true,
          })),
        }),
      );
    }),
  );
  await act(async () =>
    root.render(<AgencySimilarNames agencyKey="agency" here="/media-buys/agencies/agency" />),
  );
  await settle();
  await act(async () => button('Show more').click());
  await settle();
  await act(async () => button('Show more').click());
  await settle();
  await act(async () =>
    root.render(
      <AgencySimilarNames agencyKey="new-agency" here="/media-buys/agencies/new-agency" />,
    ),
  );
  await settle();
  expect(card().querySelectorAll('li')).toHaveLength(1);
  expect(document.activeElement).toBe(document.body);
});

it('prints a common served check day only for a fully checked spelling', async () => {
  await render((url) =>
    json(
      similar(url, {
        rows: [
          {
            key: 'one',
            label: 'Common day',
            file_count: 2,
            stations: ['KARE'],
            unchecked: false,
            checked_on: '2026-11-03',
          },
          {
            key: 'two',
            label: 'Different days',
            file_count: 2,
            stations: ['KARE'],
            unchecked: false,
            checked_on: null,
          },
          {
            key: 'three',
            label: 'Unchecked',
            file_count: 1,
            stations: ['KARE'],
            unchecked: true,
            checked_on: '2026-11-03',
          },
        ],
      }),
    ),
  );
  await act(async () => button('Show more').click());
  await settle();
  const rows = [...card().querySelectorAll('li')];
  expect(rows[0].textContent).toContain('Checked on Nov 3, 2026');
  expect(rows[1].textContent).toContain('Checked');
  expect(rows[1].textContent).not.toContain('Checked on');
  expect(rows[2].textContent).toContain('Not checked');
  expect(rows[2].textContent).not.toContain('Checked on');
});

it('keeps expansion on resize and focuses the next agency while more pages remain', async () => {
  await render((url) => json(similar(url, { has_more: true })));
  expect(card().querySelectorAll('a')).toHaveLength(1);
  await act(async () => {
    button('Show more').focus();
    button('Show more').click();
  });
  await settle();
  expect(card().querySelectorAll('a')).toHaveLength(2);
  expect(document.activeElement?.textContent).toContain('Agency Checked');
  expect(button('Show more')).toBeTruthy();
  await act(async () => window.dispatchEvent(new Event('resize')));
  expect(card().querySelectorAll('a')).toHaveLength(2);
});

it('excludes already displayed agencies before choosing the one secondary example', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string) => json(similar(new URL(input)))),
  );
  await act(async () =>
    root.render(
      <AgencySimilarNames
        agencyKey="agency"
        here="/media-buys/agencies/agency"
        sourceVersion="aaaaaaaaaaaaaaaa"
        excludedKeys={['other']}
      />,
    ),
  );
  await settle();
  expect(card().querySelectorAll('a')).toHaveLength(1);
  expect(card().textContent).toContain('Agency Checked');
  expect(card().textContent).not.toContain('“ Exact Agency ”');
  expect(button('Show more')).toBeUndefined();
});

it('changes exclusion scope only for displayed agencies and retains links through refresh failure', async () => {
  let complete: ((response: Response) => void) | undefined;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string) => {
      const url = new URL(input);
      requests.push(url);
      if (url.searchParams.has('exclude_key'))
        return new Promise<Response>((resolve) => {
          complete = resolve;
        });
      return json(similar(url));
    }),
  );
  const show = async (excludedKeys: string[]) => {
    await act(async () =>
      root.render(
        <AgencySimilarNames
          agencyKey="agency"
          here="/media-buys/agencies/agency"
          sourceVersion="aaaaaaaaaaaaaaaa"
          excludedKeys={excludedKeys}
        />,
      ),
    );
    await settle();
  };
  await show([]);
  expect(card().querySelector('a')?.textContent).toContain('“ Exact Agency ”');
  await show(['other']);
  expect(card().textContent).toContain('Updating');
  expect(card().querySelector('a')?.textContent).toContain('Agency Checked');
  expect(requests.at(-1)?.searchParams.getAll('exclude_key')).toEqual(['other']);
  await act(async () => complete!(new Response(null, { status: 503 })));
  await settle();
  expect(card().textContent).toContain('Previous results are shown');
  expect(card().querySelector('a')?.textContent).toContain('Agency Checked');
  await show([]);
  expect(card().querySelector('a')?.textContent).toContain('“ Exact Agency ”');
  expect(requests.every((url) => !url.searchParams.has('exclude_strong'))).toBe(true);
});

it('refreshes the main agency source when its exclusion version changes', async () => {
  const refreshSource = vi.fn();
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string) => {
      const url = new URL(input);
      requests.push(url);
      return url.searchParams.get('version') === 'aaaaaaaaaaaaaaaa'
        ? new Response(
            JSON.stringify({
              type: 'https://api.alethical.com/problems/records-changed',
            }),
            { status: 409 },
          )
        : json(similar(url, { version: 'bbbbbbbbbbbbbbbb' }));
    }),
  );
  const show = async (sourceVersion: string) => {
    await act(async () =>
      root.render(
        <AgencySimilarNames
          agencyKey="agency"
          here="/media-buys/agencies/agency"
          excludedKeys={['other']}
          sourceVersion={sourceVersion}
          onRefreshSource={refreshSource}
        />,
      ),
    );
    await settle();
  };
  await show('aaaaaaaaaaaaaaaa');
  expect(card().textContent).toContain('These records changed');
  expect(card().textContent).not.toContain('Previous results are shown');
  await act(async () => button('Try again').click());
  expect(refreshSource).toHaveBeenCalledOnce();
  await show('bbbbbbbbbbbbbbbb');
  expect(card().textContent).toContain('Agency Checked');
  expect(card().textContent).not.toContain('These records changed');
  expect(requests.at(-1)?.searchParams.get('version')).toBe('bbbbbbbbbbbbbbbb');
});
