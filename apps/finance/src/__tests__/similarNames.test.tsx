import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { clearReadCache } from '../api/read';
import { SimilarNames } from '../pages/payments/SimilarNames';
import { PaymentsUnderName } from '../pages/PaymentsUnderName';
import { matchRoute } from '../routes';
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const session = {
  apiBaseUrl: 'https://api.example.test',
  accessToken: 'token',
  retry: vi.fn(),
};
vi.mock('../auth/session', () => ({ useFinanceSession: () => session }));
let container: HTMLDivElement, root: Root;
let requests: URL[];
const json = (data: unknown) => new Response(JSON.stringify({ data }), { status: 200 });
const similar = (url: URL, overrides = {}) => ({
  name: url.searchParams.get('name'),
  role: url.searchParams.get('role'),
  year: url.searchParams.has('year') ? Number(url.searchParams.get('year')) : null,
  version: 'aaaaaaaaaaaaaaaa',
  excluded_names: url.searchParams.getAll('exclude_name'),
  release_id: url.searchParams.get('release_id') ?? 'release-a',
  filer: url.searchParams.get('filer'),
  dataset: url.searchParams.get('dataset'),
  offset: Number(url.searchParams.get('offset')),
  limit: 3,
  has_more: false,
  sources: [],
  rows: [
    {
      name: ' Example ',
      records: 2,
      identities: [
        {
          id: 'one',
          name: 'First Identity',
          kind: 'person',
          records: 1,
          reference: 'A1',
        },
        {
          id: 'two',
          name: 'Second Identity',
          kind: 'organization',
          records: 1,
          reference: 'A2',
        },
      ],
    },
    { name: 'Example Zero', records: 0, identities: [] },
  ],
  ...overrides,
});
async function settle() {
  for (let i = 0; i < 5; i++)
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
}
async function render(
  path: string,
  answer: (url: URL) => Response | Promise<Response> = (url) => json(similar(url)),
) {
  window.history.replaceState(null, '', path);
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string) => {
      const url = new URL(input);
      requests.push(url);
      if (url.pathname.endsWith('/similar-names')) return answer(url);
      return json({
        name: 'Example',
        role: url.searchParams.get('role'),
        year: null,
        filer: null,
        identities: [],
        state: 'not_reported',
        payments: [],
        page: { limit: 200, offset: 0, has_more: false, total_payments: null },
        linkable_registration_numbers: [],
        dataset: 'expenditures',
        release_id: 'r1',
      });
    }),
  );
  await act(async () =>
    root.render(<PaymentsUnderName match={matchRoute(path.split(/[?#]/)[0])!} />),
  );
  await settle();
}
beforeEach(() => {
  clearReadCache();
  HTMLElement.prototype.scrollIntoView = vi.fn();
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
const card = () => container.querySelector<HTMLElement>('#similar-names')!;
const button = (label: string) =>
  [...card().querySelectorAll('button')].find((x) => x.textContent === label)!;
it('shows one closest same-role spelling without identity status, then reveals the rest', async () => {
  await render('/money/names/Example?role=donor&year=2024');
  expect(
    requests
      .find((url) => url.pathname.endsWith('/similar-names'))
      ?.searchParams.get('exclude_strong'),
  ).toBeNull();
  expect(card()?.textContent).toContain('Similar donor names');
  expect(card().textContent).toContain('“ Example ”');
  expect(card().querySelectorAll('a')).toHaveLength(1);
  expect(card().textContent).toContain('2 records');
  expect(card().textContent).not.toContain('confirmed');
  expect(card().textContent).not.toContain('Each name keeps');
  await act(async () => button('Show more').click());
  await settle();
  expect(card().textContent).toContain('Example ZeroNo records');
  expect(card().textContent).toContain('In 2024');
  const link = card().querySelector('a')!;
  const url = new URL(link.href);
  expect(decodeURIComponent(url.pathname)).toBe('/money/names/ Example ');
  expect(url.searchParams.get('role')).toBe('donor');
  expect(url.searchParams.get('year')).toBe('2024');
  expect(url.searchParams.get('from')).toContain('#similar-names');
});
it('pins Show more and replaces all pages after a source change', async () => {
  let changed = false;
  await render('/money/names/Example', (url) => {
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
            name: changed ? 'Fresh name' : 'Old name',
            records: 1,
            identities: [],
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
  expect(card().textContent).toContain('Old name');
  expect(card().textContent).toContain('These records changed');
  await act(async () => button('Try again').click());
  await settle();
  expect(card().textContent).toContain('Fresh name');
  expect(card().textContent).not.toContain('Old name');
  expect(
    requests
      .filter((x) => x.pathname.endsWith('/similar-names'))
      .at(-1)
      ?.searchParams.has('version'),
  ).toBe(false);
});
it('keeps prior-year names labelled on ordinary failure, but clears them on revoked access', async () => {
  await render('/money/names/Example?year=2024');
  await act(async () => button('Show more').click());
  await settle();
  await render('/money/names/Example?year=2025', () => new Response(null, { status: 500 }));
  expect(card().textContent).toContain('In 2024');
  expect(card().textContent).toContain('Previous results are shown');
  expect(card().querySelectorAll('a')).toHaveLength(2);
  expect(card().textContent).toContain('“ Example ”');
  await render('/money/names/Example?year=2026', () => new Response(null, { status: 403 }));
  expect(card().textContent).not.toContain('Example Zero');
  expect(session.retry).toHaveBeenCalled();
});
it('reports first-load failure as retryable, never as no similar names', async () => {
  await render('/money/names/Example', () => new Response(null, { status: 503 }));
  expect(card()?.textContent).toContain('We couldn’t load similar names');
  expect(card().textContent).not.toContain('None found');
  expect(button('Try again')).toBeTruthy();
});
it('appends the next pinned page and focuses a newly revealed name when Show more disappears', async () => {
  await render('/money/names/Example', (url) =>
    json(
      similar(url, {
        has_more: url.searchParams.get('offset') === '0',
        rows: [
          {
            name: url.searchParams.get('offset') === '0' ? 'First spelling' : 'Second spelling',
            records: 1,
            identities: [],
          },
        ],
      }),
    ),
  );
  await act(async () => {
    button('Show more').focus();
    button('Show more').click();
  });
  await settle();
  expect(card().textContent).toContain('First spelling');
  expect(card().textContent).toContain('Second spelling');
  expect(card().querySelectorAll('a')).toHaveLength(2);
  expect(document.activeElement?.textContent).toContain('Second spelling');
});
it('keeps zero results distinct from failure and clears prior-account results immediately', async () => {
  await render('/money/names/Example', (url) => json(similar(url, { rows: [] })));
  expect(card().textContent).toContain('None found');
  await render('/money/names/Example?year=2024');
  expect(card().textContent).toContain('“ Example ”');
  session.accessToken = 'another-account';
  await render('/money/names/Example', () => new Response(null, { status: 500 }));
  expect(card().textContent).not.toContain('Example Zero');
  expect(card().textContent).not.toContain('None found');
});
it('returns to the starting spelling and Similar names heading without building a chain of hops', async () => {
  await render('/money/names/Example?role=donor&year=2024');
  const first = new URL(card().querySelector('a')!.href);
  await render(first.pathname + first.search);
  const back = container.querySelector<HTMLAnchorElement>('.f-back')!;
  expect(back.textContent).toContain('Back to payments under Example');
  expect(back.getAttribute('href')).toBe('/money/names/Example?role=donor&year=2024#similar-names');
  const second = new URL(card().querySelector('a')!.href);
  expect(second.searchParams.get('from')).toBe(first.searchParams.get('from'));
});
it('names a differing Similar names source copy instead of borrowing the payments date', async () => {
  await render('/money/names/Example', (url) =>
    json(
      similar(url, {
        sources: [{ dataset: 'expenditures', copied_at: '2026-10-31T12:00:00Z' }],
      }),
    ),
  );
  expect(card().textContent?.replace(/\u00a0/g, ' ')).toContain(
    'Spending file copied Oct 31, 2026',
  );
});
it('starts from the first page when returning to a name after Show more', async () => {
  const answer = (url: URL) =>
    json(similar(url, { has_more: Number(url.searchParams.get('offset')) === 0 }));
  await render('/money/names/Example', answer);
  await act(async () => button('Show more').click());
  await settle();
  const link = new URL(card().querySelector('a')!.href);
  await render(link.pathname + link.search, answer);
  await render('/money/names/Example#similar-names', answer);
  expect(
    requests
      .filter((url) => url.pathname.endsWith('/similar-names'))
      .at(-1)
      ?.searchParams.get('offset'),
  ).toBe('0');
  expect(card().textContent).not.toContain('Names similar to');
});

it('preserves the shown committee and file scope in Similar reads and links', async () => {
  await render('/money/names/Example?role=payee&year=2024&filer=19369&dataset=independent');
  const request = requests.find((url) => url.pathname.endsWith('/similar-names'))!;
  expect(request.searchParams.get('filer')).toBe('19369');
  expect(request.searchParams.get('dataset')).toBe('independent');
  const link = new URL(card().querySelector('a')!.href);
  expect(link.searchParams.get('filer')).toBe('19369');
  expect(link.searchParams.get('dataset')).toBe('independent');
  await render(
    '/money/names/Example?role=payee&year=2024&filer=30558&dataset=expenditures',
    () => new Response(null, { status: 500 }),
  );
  expect(card().textContent).toContain('Filed by committee 19369');
  expect(card().textContent).toContain('Outside spending file');
});

it('does not broaden a recognized incompatible file on a direct link or a role change', async () => {
  await render('/money/names/Example?role=payee&dataset=contributions', (url) =>
    json(similar(url, { rows: [] })),
  );
  expect(requests.filter((url) => url.pathname.endsWith('/payments-under-name'))).toHaveLength(0);
  expect(container.textContent).toContain(
    'This file does not contain records for the selected record type',
  );
  expect(container.textContent).not.toContain('No confirmed identity for this spelling');
  expect(
    requests.find((url) => url.pathname.endsWith('/similar-names'))?.searchParams.get('dataset'),
  ).toBe('contributions');
  await render('/money/names/Example?role=donor&dataset=contributions');
  expect(
    requests.some(
      (url) =>
        url.pathname.endsWith('/payments-under-name') &&
        url.searchParams.get('role') === 'contributor',
    ),
  ).toBe(true);
  requests.length = 0;
  await render('/money/names/Example?role=payee&dataset=contributions', (url) =>
    json(similar(url, { rows: [] })),
  );
  expect(requests.filter((url) => url.pathname.endsWith('/payments-under-name'))).toHaveLength(0);
});

it('does not carry a pending Show more focus target into another payment name', async () => {
  await render('/money/names/Example', (url) =>
    Number(url.searchParams.get('offset')) > 0
      ? new Promise<Response>(() => {})
      : json(similar(url, { has_more: true })),
  );
  await act(async () => button('Show more').click());
  await settle();
  await act(async () => button('Show more').click());
  await settle();
  await render('/money/names/Other', (url) =>
    json(
      similar(url, {
        rows: Array.from({ length: 4 }, (_, i) => ({
          name: `Other ${i}`,
          records: 1,
          identities: [],
        })),
      }),
    ),
  );
  expect(card().querySelectorAll('li')).toHaveLength(1);
  expect(document.activeElement).toBe(document.body);
});

it('keeps expanded comparisons on resize and resets after name, role, year or file changes', async () => {
  for (const path of [
    '/money/names/Example',
    '/money/names/Other',
    '/money/names/Other?role=donor',
    '/money/names/Other?role=donor&year=2024',
    '/money/names/Other?role=donor&year=2024&filer=123',
  ]) {
    await render(path);
    expect(card().querySelectorAll('a')).toHaveLength(1);
    await act(async () => button('Show more').click());
    await settle();
    expect(card().querySelectorAll('a')).toHaveLength(2);
    await act(async () => window.dispatchEvent(new Event('resize')));
    expect(card().querySelectorAll('a')).toHaveLength(2);
  }
});

it('focuses the first revealed spelling even while more server pages remain', async () => {
  await render('/money/names/Example', (url) => json(similar(url, { has_more: true })));
  await act(async () => {
    button('Show more').focus();
    button('Show more').click();
  });
  await settle();
  expect(document.activeElement?.textContent).toContain('Example Zero');
  expect(button('Show more')).toBeTruthy();
});

it('excludes already displayed spellings before choosing the one secondary example', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string) => json(similar(new URL(input)))),
  );
  await act(async () =>
    root.render(
      <SimilarNames
        name="Example"
        role="donor"
        year={null}
        here="/money/names/Example"
        filer={null}
        dataset={null}
        copyDates={{}}
        sourceReleaseId="release-a"
        excludedNames={[' Example ']}
      />,
    ),
  );
  await settle();
  expect(card().querySelectorAll('a')).toHaveLength(1);
  expect(card().textContent).toContain('Example Zero');
  expect(card().textContent).not.toContain('“ Example ”');
  expect(button('Show more')).toBeUndefined();
});

it('requests only displayed spelling exclusions and restores a link when that group is no longer displayed', async () => {
  let complete: ((response: Response) => void) | undefined;
  let failFiltered = true;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string) => {
      const url = new URL(input);
      requests.push(url);
      if (url.searchParams.has('exclude_name') && failFiltered)
        return new Promise<Response>((resolve) => {
          complete = resolve;
        });
      return json(similar(url));
    }),
  );
  const show = async (excludedNames: string[]) => {
    await act(async () =>
      root.render(
        <SimilarNames
          name="Example"
          role="donor"
          year={null}
          here="/money/names/Example"
          filer={null}
          dataset={null}
          copyDates={{}}
          sourceReleaseId="release-a"
          excludedNames={excludedNames}
        />,
      ),
    );
    await settle();
  };
  await show([]);
  expect(card().querySelector('a')?.textContent).toContain('“ Example ”');
  expect(requests.at(-1)?.searchParams.getAll('exclude_name')).toEqual([]);
  await show([' Example ']);
  expect(card().textContent).toContain('Updating');
  expect(card().textContent).not.toContain('“ Example ”');
  expect(card().querySelector('a')?.textContent).toContain('Example Zero');
  expect(requests.at(-1)?.searchParams.getAll('exclude_name')).toEqual([' Example ']);
  await act(async () => complete!(new Response(null, { status: 503 })));
  await settle();
  expect(card().textContent).toContain('Previous results are shown');
  expect(card().querySelector('a')?.textContent).toContain('Example Zero');
  failFiltered = false;
  await act(async () => button('Try again').click());
  await settle();
  await show([]);
  expect(card().querySelector('a')?.textContent).toContain('“ Example ”');
  expect(requests.every((url) => !url.searchParams.has('exclude_strong'))).toBe(true);
});

it('refreshes the main source after an exclusion pin changes, then reads the new release', async () => {
  const refreshSource = vi.fn();
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string) => {
      const url = new URL(input);
      requests.push(url);
      return url.searchParams.get('release_id') === 'release-a'
        ? new Response(
            JSON.stringify({
              type: 'https://api.alethical.com/problems/records-changed',
            }),
            { status: 409 },
          )
        : json(similar(url));
    }),
  );
  const show = async (sourceReleaseId: string) => {
    await act(async () =>
      root.render(
        <SimilarNames
          name="Example"
          role="donor"
          year={null}
          here="/money/names/Example"
          filer={null}
          dataset={null}
          copyDates={{}}
          excludedNames={[' Example ']}
          sourceReleaseId={sourceReleaseId}
          onRefreshSource={refreshSource}
        />,
      ),
    );
    await settle();
  };
  await show('release-a');
  expect(card().textContent).toContain('These records changed');
  expect(card().textContent).not.toContain('Previous results are shown');
  await act(async () => button('Try again').click());
  expect(refreshSource).toHaveBeenCalledOnce();
  await show('release-b');
  expect(card().textContent).toContain('Example Zero');
  expect(card().textContent).not.toContain('These records changed');
  expect(requests.at(-1)?.searchParams.get('release_id')).toBe('release-b');
});
