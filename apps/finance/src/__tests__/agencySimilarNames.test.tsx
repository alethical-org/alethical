import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { clearReadCache } from '../api/read';
import { PrintedAgency } from '../pages/StationRecords';
import { matchRoute } from '../routes';
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const session = { apiBaseUrl: 'https://api.example.test', accessToken: 'token', retry: vi.fn() };
vi.mock('../auth/session', () => ({ useFinanceSession: () => session }));
let container: HTMLDivElement, root: Root, requests: URL[];
const json = (data: unknown) => new Response(JSON.stringify({ data }), { status: 200 });
const similar = (url: URL, overrides = {}) => ({
  key: 'agency',
  name: 'Exact Agency',
  version: 'aaaaaaaaaaaaaaaa',
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
  expect(card()?.textContent).toContain('Similar agency names');
  const links = card().querySelectorAll('a');
  expect(links[0].textContent).toContain('“ Exact Agency ”');
  expect(links[0].textContent).toContain('2 files · KARE, KSTP-TV · Not checked');
  expect(links[1].textContent).toContain('1 file · KARE · Checked');
  expect(links[0].getAttribute('href')).toContain('/media-buys/agencies/other?from=');
  expect(card().textContent).toContain('may belong to a different person or organization');
});
it('pins further names and replaces the complete list after a source change', async () => {
  let changed = false;
  await render((url) => {
    if (url.searchParams.get('offset') === '3' && !changed) {
      changed = true;
      return new Response(
        JSON.stringify({ type: 'https://api.alethical.com/problems/records-changed' }),
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
