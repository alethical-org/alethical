import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type Handler = (
  request: { query?: Record<string, string>; headers?: Record<string, string> },
  response: {
    status: (code: number) => unknown;
    setHeader: (name: string, value: string) => void;
    send: (body: string) => void;
  },
) => Promise<void>;

const SHELL = [
  '<!DOCTYPE html><html><head>',
  '<!--alethical:page-head-->',
  '<title>Alethical</title>',
  '<!--/alethical:page-head-->',
  '<link rel="stylesheet" href="/fonts.css" />',
  '</head><body><div id="root"><!--alethical:page-snapshot--><!--/alethical:page-snapshot--></div>',
  '<script src="/_expo/static/js/web/index-abc.js"></script></body></html>',
].join('\n');

function responseRecorder() {
  const headers = new Map<string, string>();
  let body = '';
  let status = 0;
  const response = {
    setHeader(name: string, value: string) {
      headers.set(name, value);
    },
    status(code: number) {
      status = code;
      return response;
    },
    send(value: string) {
      body = value;
    },
  };
  return { response, read: () => ({ body, headers, status }) };
}

/** Answers the shell request from memory and the API request from `api`. */
function stubNetwork(api: (path: string) => { status: number; payload?: unknown }) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (url.endsWith('/index.html')) {
        return { ok: true, status: 200, text: async () => SHELL } as unknown as Response;
      }
      const result = api(url);
      return {
        ok: result.status >= 200 && result.status < 300,
        status: result.status,
        json: async () => result.payload,
      } as unknown as Response;
    }),
  );
}

let handler: Handler;

beforeEach(async () => {
  // The handler holds the fetched shell for the life of a warm instance, so each
  // test gets a fresh module rather than the previous test's cached copy.
  vi.resetModules();
  handler = (await import('../../../../../api/page')).default as Handler;
});

afterEach(() => {
  vi.unstubAllGlobals();
});

async function serve(query: Record<string, string>) {
  const recorder = responseRecorder();
  await handler({ query, headers: { host: 'www.alethical.com' } }, recorder.response);
  return recorder.read();
}

describe('first-response page tags', () => {
  it('gives a bill its own title and leaves the app body intact', async () => {
    stubNetwork(() => ({
      status: 200,
      payload: {
        data: {
          id: '94-2025-HF719',
          ai_analysis: {
            short_title: 'Statewide Capital Projects and Bonding Bill',
            summary: 'Authorizes borrowing for public buildings. More detail follows.',
          },
        },
      },
    }));

    const { body, headers, status } = await serve({ route: 'bill', id: '94-2025-HF719' });

    expect(status).toBe(200);
    expect(body).toContain(
      '<title>HF 719 (2025): Statewide Capital Projects and Bonding Bill | Alethical</title>',
    );
    expect(body).toContain('rel="canonical" href="https://www.alethical.com/bills/94-2025-HF719"');
    // Robots and people get the same page: the app still loads from this HTML,
    // and the snapshot sits inside its mount point, which React clears on render.
    expect(body).toContain(
      '<div id="root"><!--alethical:page-snapshot--><div class="page-snapshot">',
    );
    expect(body).toContain('<h1>Statewide Capital Projects and Bonding Bill</h1>');
    expect(body).toContain('Authorizes borrowing for public buildings.');
    expect(body).toContain('/_expo/static/js/web/index-abc.js');
    expect(body).toContain('<link rel="stylesheet" href="/fonts.css" />');
    expect(headers.get('Cache-Control')).toContain('s-maxage=600');
    expect(headers.get('X-Robots-Tag')).toBeUndefined();
  });

  it('names a legislator, and canonicalises a UUID address to their readable one', async () => {
    stubNetwork(() => ({
      status: 200,
      payload: {
        data: {
          slug: 'aisha-gomez',
          full_name: 'Aisha Gomez',
          current_service: { chamber: 'house', district: { code: '62A' } },
        },
      },
    }));

    const { body } = await serve({ route: 'legislator', id: '8c31565f-e674-462d-b71f-a1d1ebcc' });

    expect(body).toContain(
      '<title>Rep. Aisha Gomez, Minnesota House District 62A | Alethical</title>',
    );
    expect(body).toContain(
      'rel="canonical" href="https://www.alethical.com/legislators/aisha-gomez"',
    );
    expect(body).toContain('<h1>Rep. Aisha Gomez</h1>');
    expect(body).toContain('House District 62A');
  });

  it('serves list and static pages without asking the data service anything', async () => {
    const calls: string[] = [];
    stubNetwork((url) => {
      calls.push(url);
      return { status: 500 };
    });

    expect((await serve({ route: 'bills' })).body).toContain(
      '<title>Search Minnesota bills | Alethical</title>',
    );
    expect((await serve({ path: '/privacy' })).body).toContain(
      '<title>Privacy Policy | Alethical</title>',
    );
    // A list is a list of other records, so it has no snapshot of its own: the
    // mount point ships empty and the app fills it, exactly as before.
    expect((await serve({ route: 'bills' })).body).toContain(
      '<div id="root"><!--alethical:page-snapshot--><!--/alethical:page-snapshot--></div>',
    );
    expect(calls).toHaveLength(0);
  });

  it('tells robots not to list an answer page, in a header and in the page', async () => {
    stubNetwork(() => ({ status: 500 }));

    const { headers, body } = await serve({ route: 'ask', q: 'What would HF 719 fund?' });

    expect(headers.get('X-Robots-Tag')).toBe('noindex');
    expect(body).toContain('name="robots" content="noindex"');
    expect(body).toContain('<title>What would HF 719 fund? | Alethical</title>');
  });
});

describe('addresses that are not real pages', () => {
  // 10,471 bills means an unlimited supply of plausible-looking addresses. A 200
  // on every one of them is an unlimited supply of blank pages that look fine.
  it('returns 404 for a bill that does not exist', async () => {
    stubNetwork(() => ({ status: 404 }));

    const { status, body, headers } = await serve({ route: 'bill', id: '94-2025-HF999999' });

    expect(status).toBe(404);
    expect(body).toContain('<title>Page not found | Alethical</title>');
    expect(body).not.toContain('rel="canonical"');
    // Nothing to snapshot: the record is genuinely absent.
    expect(body).toContain(
      '<div id="root"><!--alethical:page-snapshot--><!--/alethical:page-snapshot--></div>',
    );
    expect(headers.get('X-Robots-Tag')).toBe('noindex');
  });

  it('returns 404 for an address with no page behind it', async () => {
    stubNetwork(() => ({ status: 500 }));
    expect((await serve({ path: '/not-a-page' })).status).toBe(404);
  });
});

describe('when the data service is unwell', () => {
  // A hiccup that answered 404 would tell a search engine our pages are gone.
  it('returns 503, never 404, when the data service errors', async () => {
    stubNetwork(() => ({ status: 500 }));

    const { status, headers } = await serve({ route: 'bill', id: '94-2025-HF719' });

    expect(status).toBe(503);
    expect(headers.get('Retry-After')).toBe('120');
    expect(headers.get('Cache-Control')).toBe('no-store');
  });

  it('returns 503 when the data service cannot be reached at all', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.endsWith('/index.html')) {
          return { ok: true, status: 200, text: async () => SHELL } as unknown as Response;
        }
        throw new Error('connection refused');
      }),
    );

    expect((await serve({ route: 'legislator', id: 'aisha-gomez' })).status).toBe(503);
  });

  it('returns 503 rather than a page with the wrong tags when the shell is unreadable', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.endsWith('/index.html')) {
          return {
            ok: true,
            status: 200,
            text: async () => '<html><head></head></html>',
          } as unknown as Response;
        }
        return { ok: true, status: 200, json: async () => ({ data: {} }) } as unknown as Response;
      }),
    );

    expect((await serve({ route: 'bills' })).status).toBe(503);
  });
});
