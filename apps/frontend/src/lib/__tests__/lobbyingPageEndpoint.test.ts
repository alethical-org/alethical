import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import live from '../../data/__tests__/fixtures/lobbying-live.json';
import { escapeHtml } from '../share';

const shell = vi.hoisted(() => vi.fn());
vi.mock('node:fs/promises', () => ({ readFile: shell }));
const SHELL =
  '<html><head><!--alethical:page-head--><title>Alethical</title><!--/alethical:page-head--></head><body><div id="root"><!--alethical:page-snapshot--><!--/alethical:page-snapshot--></div><!--alethical:page-data--><!--/alethical:page-data--><script src="/app.js"></script></body></html>';
let handler: typeof import('../../../../../api/page').default;
beforeEach(async () => {
  vi.resetModules();
  shell.mockResolvedValue(SHELL);
  handler = (await import('../../../../../api/page')).default;
});
afterEach(() => vi.unstubAllGlobals());

async function serve(query: Record<string, string>) {
  const headers = new Map<string, string>();
  let body = '';
  let status = 0;
  const response = {
    setHeader: (key: string, value: string) => {
      headers.set(key, value);
    },
    status: (code: number) => {
      status = code;
      return response;
    },
    send: (value: string) => {
      body = value;
    },
  };
  await handler({ query }, response);
  return { headers, body, status };
}
function answer(data: unknown) {
  const fetcher = vi.fn(
    async (_url: string) =>
      new Response(JSON.stringify({ data }), { headers: { 'content-type': 'application/json' } }),
  );
  vi.stubGlobal('fetch', fetcher);
  return fetcher;
}
function seeds(body: string): { key: unknown[]; payload: unknown }[] {
  const json = body.match(
    /<script type="application\/json" id="alethical-page-data">([\s\S]*?)<\/script>/,
  )?.[1];
  return json ? JSON.parse(json) : [];
}
function snapshot(body: string) {
  return (
    body.split('<!--alethical:page-snapshot-->')[1]?.split('<!--/alethical:page-snapshot-->')[0] ??
    ''
  );
}
const destinations: {
  path: string;
  api: string;
  data: Record<string, unknown>;
  key: unknown[];
  title: string;
  query: Record<string, string>;
}[] = [
  {
    path: '/money/lobbying',
    api: '/lobbying/summary',
    data: live.summary,
    key: ['lobbying-summary'],
    title: 'Lobbying | Alethical',
    query: {},
  },
  {
    path: '/money/lobbying/principals',
    api: '/lobbying/principals?limit=50&offset=50',
    data: live.principals_page_2,
    key: ['lobbying-principals', '', 2],
    title: 'Principals — page 2 — lobbying | Alethical',
    query: { page: '2' },
  },
  {
    path: '/money/lobbying/lobbyists',
    api: '/lobbying/lobbyists?limit=50&offset=50',
    data: live.lobbyists_page_2,
    key: ['lobbying-lobbyists', '', 2],
    title: 'Lobbyists — page 2 — lobbying | Alethical',
    query: { page: '2' },
  },
  {
    path: '/money/lobbying/principals/american-express-2263',
    api: '/lobbying/principals/2263',
    data: live.principal,
    key: ['lobbying-principal', '2263'],
    title: 'American Express — Lobbying principal | Alethical',
    query: {},
  },
  {
    path: '/money/lobbying/lobbyists/unlisted-999999999',
    api: '/lobbying/lobbyists/999999999',
    data: live.absent,
    key: ['lobbying-lobbyist', '999999999'],
    title: 'Registration 999999999 — Minnesota lobbyist | Alethical',
    query: {},
  },
];

describe('every lobbying address works before the app loads', () => {
  it.each(destinations)(
    'serves $path with its own title, exact source and matching seed',
    async (entry) => {
      const fetcher = answer(entry.data);
      const result = await serve({ path: entry.path, ...entry.query });
      expect(result.status).toBe(200);
      expect(result.body).toContain(`<title>${entry.title}</title>`);
      expect(seeds(result.body)).toEqual([{ key: entry.key, payload: { data: entry.data } }]);
      expect(fetcher).toHaveBeenCalledTimes(1);
      expect(fetcher.mock.calls[0][0]).toMatch(`/api/v1${entry.api}`);
      expect(snapshot(result.body).length).toBeGreaterThan(100);
      if (entry.data !== live.absent) {
        expect(result.body).toContain(
          `<link rel="canonical" href="https://www.alethical.com${entry.path}${entry.query.page ? '?page=2' : ''}"`,
        );
        expect(result.headers.has('X-Robots-Tag')).toBe(false);
      }
    },
  );

  it('resolves only the trailing number and uses the source spelling for the canonical address', async () => {
    const fetcher = answer(live.principal);
    const result = await serve({ path: '/money/lobbying/principals/mistyped-name-2263' });
    expect(result.status).toBe(200);
    expect(fetcher.mock.calls[0][0]).toMatch('/lobbying/principals/2263');
    expect(result.body).toContain(
      'https://www.alethical.com/money/lobbying/principals/american-express-2263',
    );
    expect(result.body).not.toContain('mistyped-name');
  });

  it('keeps a lobbyist absent from the copied list readable without indexing it', async () => {
    answer(live.absent);
    const result = await serve({ path: '/money/lobbying/lobbyists/unlisted-999999999' });
    expect(result.status).toBe(200);
    expect(result.headers.get('X-Robots-Tag')).toBe('noindex');
    expect(result.body).not.toContain('rel="canonical"');
    expect(snapshot(result.body)).toContain('not listed on the copy date');
    expect(snapshot(result.body)).toContain('names no donation under this registration number');
    expect(seeds(result.body)[0].payload).toEqual({ data: live.absent });
  });

  it('keeps a registered lobbyist readable when a separate donation section cannot be read', async () => {
    // The identity is the live 141 row on American Express's current lobbyist list.
    // The section failures are deliberate variants, not statements about its payments.
    const identity = live.principal.lobbyists.rows.find(
      (row) => row.registration_number === '141',
    )!;
    const data = {
      ...live.absent,
      state: 'reported',
      registration_number: identity.registration_number,
      name: identity.name,
      formatted_name: identity.formatted_name,
      principals: { state: 'unavailable', total: null, rows: [] },
      contributions: {
        ...live.absent.contributions,
        state: 'unavailable',
        payment_count: null,
        committee_count: null,
        years: [],
      },
    };
    answer(data);
    const result = await serve({ path: '/money/lobbying/lobbyists/old-spelling-141' });
    expect(result.status).toBe(200);
    expect(result.body).toContain('<title>Kozak, Andrew — Minnesota lobbyist | Alethical</title>');
    expect(result.body).toContain(
      'https://www.alethical.com/money/lobbying/lobbyists/kozak-andrew-141',
    );
    expect(result.headers.has('X-Robots-Tag')).toBe(false);
    expect(snapshot(result.body)).toContain(
      escapeHtml(
        "We couldn't load the state's campaign contribution file. This does not mean no donation was filed under this registration number.",
      ),
    );
    expect(snapshot(result.body)).not.toContain('names no donation');
    expect(snapshot(result.body)).not.toContain('not listed on the copy date');
    expect(seeds(result.body)).toEqual([{ key: ['lobbying-lobbyist', '141'], payload: { data } }]);
  });

  it('keeps each principal page-2 link tied to spending rows and its own latest year', async () => {
    answer(live.principals_page_2);
    const result = await serve({ path: '/money/lobbying/principals', page: '2' });
    const html = snapshot(result.body);
    const unlinked = live.principals_page_2.principals.find((row) => !row.linkable)!;
    expect(html).toContain(escapeHtml(unlinked.name));
    expect(html).not.toMatch(new RegExp(`href="[^\"]*-${unlinked.entity_id}"`));
    expect(html).toContain(
      'No spending rows in the Board&#39;s file through 2025, so no page to open',
    );
    expect(html).toContain('href="/money/lobbying/principals/actwireless-7325"');
    expect(html).toContain('Latest spending year in these records: 2017');
    expect(html).toContain('Showing 51–100 of 3,443 principals');
    expect(html).toContain('href="/money/lobbying/principals?page=3"');
  });

  it.each(['principals', 'lobbyists'])(
    'leaves filtered %s to its own client query without seeding the unfiltered list',
    async (kind) => {
      const fetcher = answer(live.lobbyists_page_2);
      const result = await serve({ path: `/money/lobbying/${kind}`, q: 'Kozak', page: '2' });
      expect(result.status).toBe(200);
      expect(result.headers.get('X-Robots-Tag')).toBe('noindex');
      expect(fetcher).not.toHaveBeenCalled();
      expect(seeds(result.body)).toEqual([]);
      expect(snapshot(result.body)).toBe('');
    },
  );

  it.each(destinations)(
    'returns a retryable failure for a missing source at $path',
    async (entry) => {
      answer({ ...entry.data, state: 'unavailable' });
      const result = await serve({ path: entry.path, ...entry.query });
      expect(result.status).toBe(503);
      expect(result.headers.get('Cache-Control')).toBe('no-store');
      expect(result.headers.get('Retry-After')).toBe('120');
      expect(result.body).toBe('This page is temporarily unavailable.');
      expect(seeds(result.body)).toEqual([]);
    },
  );

  it('does not call a timed-out source an absent principal', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new DOMException('timeout', 'TimeoutError');
      }),
    );
    const result = await serve({ path: '/money/lobbying/principals/american-express-2263' });
    expect(result.status).toBe(503);
    expect(result.body).not.toContain('not found');
  });

  it('returns not found only when the principal has no held spending rows', async () => {
    answer({
      ...live.principal,
      state: 'no_spending_rows',
      spending: { state: 'no_spending_rows', rows: [] },
    });
    const result = await serve({ path: '/money/lobbying/principals/unknown-2263' });
    expect(result.status).toBe(404);
    expect(seeds(result.body)).toEqual([]);
  });

  it.each(['principals', 'lobbyists'])(
    'rejects an out-of-range %s page instead of claiming the whole list is empty',
    async (kind) => {
      answer({
        ...(kind === 'principals' ? live.principals_page_2 : live.lobbyists_page_2),
        [kind]: [],
        offset: 49950,
      });
      const result = await serve({ path: `/money/lobbying/${kind}`, page: '1000' });
      expect(result.status).toBe(404);
      expect(snapshot(result.body)).not.toContain('No principal matches');
      expect(snapshot(result.body)).not.toContain('No lobbyist matches');
    },
  );
});
