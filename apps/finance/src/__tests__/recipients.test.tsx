import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { clearReadCache } from '../api/read';
import { navigate } from '../router';
import {
  countLine,
  pageCount,
  pageFromParam,
  recordsLine,
  Recipients,
  sourceLines,
  tabCount,
  tabFromParam,
  type NameGroup,
} from '../pages/Recipients';
import { matchRoute } from '../routes';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const API = 'https://api.example.test';

vi.mock('../auth/session', () => ({
  useFinanceSession: () => ({ apiBaseUrl: 'https://api.example.test', accessToken: 'token' }),
}));

function names(count: number, prefix = 'Acme Media') {
  return Array.from({ length: count }, (_, index) => ({
    kind: 'payment_name',
    name: `${prefix} ${String(index + 1).padStart(2, '0')}`,
    role: 'vendor',
    payment_count: index + 1,
  }));
}

function group(kind: string, overrides: Partial<NameGroup> = {}): NameGroup {
  return {
    kind,
    state: 'reported',
    results: [],
    total: 0,
    at_least: null,
    has_more: false,
    fetched_at: '2026-10-09T21:05:10Z',
    reason: null,
    ...overrides,
  };
}

function search(spending: Partial<NameGroup>, outside: Partial<NameGroup> = {}) {
  return {
    state: 'reported',
    q: 'media',
    min_query_length: 3,
    groups: [
      group('people'),
      group('committees'),
      group('gave'),
      group('got_paid', spending),
      group('got_paid_independent', outside),
      group('lobbyists'),
      group('principals'),
    ],
  };
}

const SUMMARY = {
  freshness: {
    payment_copied_at: {
      expenditures: '2026-10-09T21:05:10Z',
      independent_expenditures: '2026-10-09T21:05:10Z',
    },
  },
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify({ data }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

let container: HTMLDivElement;
let root: Root;
let requests: string[];

beforeEach(() => {
  clearReadCache();
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  requests = [];
  window.scrollTo = vi.fn() as unknown as typeof window.scrollTo;
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

type Answer = (url: string) => Response | Promise<Response>;

async function settle() {
  for (let index = 0; index < 3; index += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

async function render(path: string, answer: Answer) {
  window.history.replaceState(null, '', path);
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string) => {
      requests.push(input);
      if (input.includes('/campaign-finance/summary')) return json(SUMMARY);
      return answer(input);
    }),
  );
  const match = matchRoute('/money/recipients')!;
  await act(async () => {
    root.render(<Recipients match={match} />);
  });
  await settle();
}

function searchRequests() {
  return requests.filter((url) => url.includes('/campaign-finance/search'));
}

describe('Vendors and payees helpers', () => {
  it('reads the address safely', () => {
    expect(tabFromParam('outside')).toBe('outside');
    expect(tabFromParam('vendors')).toBe('spending');
    expect(pageFromParam('3')).toBe(3);
    expect(pageFromParam('-2')).toBe(1);
    expect(pageCount(0)).toBe(1);
    expect(pageCount(21)).toBe(3);
  });

  it('counts names exactly or as a floor, and records only when every name is listed', () => {
    const complete = group('got_paid', { results: names(2), total: 2 });
    expect(countLine(complete, 'media')).toBe('2 recipients · 3 payment records matching “media”');
    const one = group('got_paid', { results: names(1), total: 1 });
    expect(countLine(one, 'media')).toBe('1 recipient · 1 payment record matching “media”');
    const partial = group('got_paid', { results: names(50), total: 88, has_more: true });
    expect(countLine(partial, 'media')).toBe('88 recipients matching “media”');
    const capped = group('got_paid', {
      results: names(50),
      total: null,
      at_least: 200,
      has_more: true,
    });
    expect(countLine(capped, 'media')).toBe('More than 200 recipients matching “media”');
    expect(tabCount(capped)).toBe('200+');
    expect(tabCount(partial)).toBe('88');
    expect(tabCount(group('got_paid', { state: 'unavailable', total: null }))).toBeNull();
    expect(recordsLine(1)).toBe('1 payment record');
    expect(recordsLine(null)).toBe('Payment records not counted');
  });

  it('dates the 2 payment files together or apart, never borrowing a date', () => {
    expect(sourceLines(SUMMARY)).toEqual([
      'Payment records from the expenditure and independent expenditure files, copied Oct 9, 2026.',
    ]);
    expect(
      sourceLines({
        freshness: {
          payment_copied_at: {
            expenditures: '2026-10-09T21:05:10Z',
            independent_expenditures: null,
          },
        },
      }),
    ).toEqual(['Spending file copied Oct 9, 2026', 'Outside-spending file copy date unavailable']);
    expect(sourceLines(null)).toEqual([]);
  });
});

describe('Vendors and payees page', () => {
  it('asks for a name before searching', async () => {
    await render('/money/recipients', () => json(search({})));
    expect(container.querySelector('h1')?.textContent).toBe('Vendors and payees');
    expect(container.textContent).toContain('Type a name to search');
    expect(searchRequests()).toHaveLength(0);
    expect(container.querySelector('[role="tablist"]')).toBeNull();
    expect(container.textContent).toContain(
      'Payment records from the expenditure and independent expenditure files, copied Oct 9, 2026.',
    );
  });

  it('says a short query is too short instead of claiming no matches', async () => {
    await render('/money/recipients?q=ab', () => json(search({})));
    expect(container.textContent).toContain('Type at least 3 characters');
    expect(container.textContent).not.toContain('No matching records');
    expect(searchRequests()).toHaveLength(0);
  });

  it('lists printed names from the spending file, paged, with counts kept per file', async () => {
    await render('/money/recipients?q=media', () =>
      json(
        search({ results: names(12), total: 12 }, { results: names(3, 'Outside Media'), total: 3 }),
      ),
    );
    const text = container.textContent ?? '';
    expect(searchRequests()[0]).toBe(`${API}/api/v1/campaign-finance/search?q=media&limit=50`);
    const tabs = [...container.querySelectorAll('[role="tab"]')].map((tab) => tab.textContent);
    expect(tabs).toEqual(['Campaign spending12', 'Outside spending3']);
    expect(text).not.toContain('Confirmed vendors');
    expect(text).toContain('12 recipients · 78 payment records matching “media”');
    const rows = container.querySelectorAll('[role="table"] [role="row"]');
    expect(rows).toHaveLength(11);
    const link = container.querySelector<HTMLAnchorElement>('[role="cell"] a');
    expect(link?.textContent).toBe('Acme Media 01');
    expect(link?.getAttribute('href')).toBe(
      '/money/names/Acme%20Media%2001?role=payee&from=%2Fmoney%2Frecipients%3Fq%3Dmedia',
    );
    expect(container.querySelector('[role="cell"] .f-mark-printed')).not.toBeNull();
    expect(text).toContain('Printed name');
    expect(text).toContain('Page 1 of 2');
    expect(text).toContain('A recipient is not a vendor unless confirmed.');
    expect(text).toContain('The count is records, not separate payments or people.');
    expect(text).not.toContain('Only the first 50 names');
  });

  it('opens the outside-spending file on its own tab and page 2 from the address', async () => {
    await render('/money/recipients?q=media&tab=outside&page=2', () =>
      json(
        search({ results: names(2), total: 2 }, { results: names(14, 'Outside Media'), total: 14 }),
      ),
    );
    const text = container.textContent ?? '';
    expect(text).toContain('14 recipients');
    expect(text).toContain('Outside Media 11');
    expect(text).not.toContain('Acme Media');
    expect(text).toContain('Page 2 of 2');
    expect(text).toContain('so the 2 files are not added together');
  });

  it('says only the first 50 names are listed when more match', async () => {
    await render('/money/recipients?q=media', () =>
      json(search({ results: names(50), total: null, at_least: 200, has_more: true })),
    );
    const text = container.textContent ?? '';
    expect(text).toContain('More than 200 recipients matching “media”');
    expect(text).toContain('Only the first 50 names, A to Z, are listed.');
    expect(text).toContain('Page 1 of 5');
  });

  it('shows No matching records when nothing carries the spelling', async () => {
    await render('/money/recipients?q=zzzz', () =>
      json(search({ state: 'not_reported', results: [], total: 0 })),
    );
    expect(container.textContent).toContain('No matching records');
    expect(container.querySelector('[role="table"]')).toBeNull();
  });

  it('shows a failed load with Try again, never as no matches', async () => {
    await render('/money/recipients?q=media', () => new Response('down', { status: 500 }));
    const text = container.textContent ?? '';
    expect(text).toContain('We couldn’t load these results');
    expect(text).toContain('Try again');
    expect(text).not.toContain('No matching records');
  });

  it('says when one file could not be searched', async () => {
    await render('/money/recipients?q=media', () =>
      json(search({ state: 'unavailable', total: null, reason: 'no_release' })),
    );
    expect(container.textContent).toContain(
      'We could not search this part of our records just now. This does not mean there are no matching records.',
    );
  });

  it('shows the loading rows while the first search runs', async () => {
    await render('/money/recipients?q=media', () => new Promise<Response>(() => {}));
    expect(container.querySelector('.f-skeleton')).not.toBeNull();
  });

  it('keeps the earlier results while the next search updates, and if it fails', async () => {
    let second: (response: Response) => void = () => {};
    await render('/money/recipients?q=media', (url) =>
      url.includes('q=medium')
        ? new Promise<Response>((resolve) => {
            second = resolve;
          })
        : json(search({ results: names(2), total: 2 })),
    );
    await act(async () => navigate('/money/recipients?q=medium', { replace: true }));
    await settle();
    let text = container.textContent ?? '';
    expect(text).toContain('Updating results…');
    expect(text).toContain('Acme Media 01');
    expect(container.querySelector('[role="table"]')?.hasAttribute('data-stale')).toBe(true);
    await act(async () => second(new Response('down', { status: 500 })));
    await settle();
    text = container.textContent ?? '';
    expect(text).toContain('We couldn’t update these results');
    expect(text).toContain('Acme Media 01');
  });
});
