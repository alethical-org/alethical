import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runInNewContext } from 'node:vm';

import { publishedReports, reportRunsText, reportSourceText } from '../moneyReports';
import { MONEY_ONLY_GOES_ONE_WAY } from '../reports/moneyOnlyGoesOneWay';
import { escapeHtml } from '../share';

const { readPageShell } = vi.hoisted(() => ({ readPageShell: vi.fn() }));

vi.mock('node:fs/promises', () => ({ readFile: readPageShell }));

type Handler = (
  request: { query?: Record<string, string> },
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
  '<link rel="preconnect" href="https://api.alethical.com" crossorigin />',
  '<link rel="preconnect" href="https://fonts.googleapis.com" />',
  '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Libre+Franklin" />',
  '</head><body><div id="root"><!--alethical:page-snapshot--><p>Home snapshot from shell</p><!--/alethical:page-snapshot--></div>',
  '<script type="module" src="https://static.cloudflareinsights.com/beacon.min.js" data-cf-beacon=\'{"token":"public-speed-token"}\'></script>',
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

/** Answers data-service requests from `api`; the page shell comes from the bundled file mock. */
function stubNetwork(api: (path: string) => { status: number; payload?: unknown }) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
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
  // The handler holds the bundled shell for the life of a warm instance, so each
  // test gets a fresh module rather than the previous test's cached copy.
  vi.resetModules();
  readPageShell.mockReset();
  readPageShell.mockResolvedValue(SHELL);
  handler = (await import('../../../../../api/page')).default as Handler;
});

afterEach(() => {
  vi.unstubAllGlobals();
});

async function serve(query: Record<string, string>) {
  const recorder = responseRecorder();
  await handler({ query }, recorder.response);
  return recorder.read();
}

function runEmailLinkBootstrap(body: string, address: string) {
  const source = body.match(
    /<script id="alethical-email-link-bootstrap">([\s\S]*?)<\/script>/,
  )?.[1];
  if (!source) throw new Error('email-link bootstrap was not found');

  const parsed = new URL(address, 'https://www.alethical.com');
  let cleanedAddress = '';
  const pageWindow = {
    location: {
      pathname: parsed.pathname,
      search: parsed.search,
      hash: parsed.hash,
    },
    history: {
      replaceState(_state: unknown, _title: string, nextAddress: string) {
        cleanedAddress = nextAddress;
      },
    },
    __alethicalEmailLink: undefined as
      | Readonly<{
          tokenHash: string | null;
          type: string | null;
          pendingReference: string | null;
        }>
      | undefined,
  };

  runInNewContext(source, { URLSearchParams, window: pageWindow });
  return { cleanedAddress, memory: pageWindow.__alethicalEmailLink };
}

function runForgotPasswordBootstrap(body: string, storageThrows = false) {
  const source = body.match(
    /<script id="alethical-forgot-password-bootstrap">([\s\S]*?)<\/script>/,
  )?.[1];
  if (!source) throw new Error('forgot-password bootstrap was not found');

  const storage = new Map<string, string>();
  let replacedAddress = '';
  runInNewContext(source, {
    window: {
      sessionStorage: {
        setItem(key: string, value: string) {
          if (storageThrows) throw new Error('storage unavailable');
          storage.set(key, value);
        },
      },
      location: {
        replace(nextAddress: string) {
          replacedAddress = nextAddress;
        },
      },
    },
  });
  return { replacedAddress, storage };
}

describe('private email-link page shell', () => {
  it.each([
    ['/confirm', 'private-confirmation', 'signup'],
    ['/reset', 'private-reset', 'recovery'],
  ])('protects the one-use secret before the app starts on %s', async (path, tokenHash, type) => {
    stubNetwork(() => ({ status: 500 }));

    const { body, headers, status } = await serve({ path });

    expect(status).toBe(200);
    expect(headers.get('Cache-Control')).toBe('no-store');
    expect(headers.get('Referrer-Policy')).toBe('no-referrer');
    expect(headers.get('X-Robots-Tag')).toBe('noindex, nofollow');
    expect(body).toContain('window.__alethicalEmailLink');
    expect(body).toContain('window.history.replaceState');
    expect(body).toContain('token_hash');
    expect(body).toContain('pending');
    expect(body.indexOf('window.__alethicalEmailLink')).toBeLessThan(
      body.indexOf('/_expo/static/js/web/index-abc.js'),
    );
    expect(body).not.toContain(tokenHash);
    expect(body).not.toContain('opaque-pending-action');
    expect(body).not.toContain('https://api.alethical.com');
    expect(body).not.toContain('https://fonts.googleapis.com');
    expect(body).not.toContain('https://static.cloudflareinsights.com');
    expect(body).not.toContain('public-speed-token');
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
  });

  it.each([
    {
      name: 'one-use token hash',
      address:
        '/confirm?kept=query#token_hash=private-confirmation&type=signup&pending=opaque-pending&kept=hash',
      cleanedAddress: '/confirm?kept=query#kept=hash',
      memory: {
        tokenHash: 'private-confirmation',
        type: 'signup',
        pendingReference: 'opaque-pending',
      },
    },
    {
      name: 'query-string token that has already reached the server',
      address:
        '/confirm?token_hash=private-query-token&type=signup&pending=private-query-pending&kept=query',
      cleanedAddress: '/confirm?kept=query',
      memory: { tokenHash: null, type: null, pendingReference: null },
    },
    {
      name: 'PKCE code and verifier',
      address: '/confirm?code=private-code&kept=query#code_verifier=private-verifier&kept=hash',
      cleanedAddress: '/confirm?kept=query#kept=hash',
      memory: { tokenHash: null, type: null, pendingReference: null },
    },
    {
      name: 'implicit access and refresh tokens',
      address:
        '/reset#access_token=private-access&refresh_token=private-refresh&token_type=bearer&expires_in=3600&expires_at=999999&type=recovery',
      cleanedAddress: '/reset',
      memory: { tokenHash: null, type: 'recovery', pendingReference: null },
    },
    {
      name: 'provider tokens',
      address:
        '/confirm?provider_token=private-provider&kept=query#provider_refresh_token=private-provider-refresh&kept=hash',
      cleanedAddress: '/confirm?kept=query#kept=hash',
      memory: { tokenHash: null, type: null, pendingReference: null },
    },
    {
      name: 'provider error details',
      address:
        '/confirm?error=access_denied&error_code=otp_expired&kept=query#error_description=private-description&kept=hash',
      cleanedAddress: '/confirm?kept=query#kept=hash',
      memory: { tokenHash: null, type: null, pendingReference: null },
    },
  ])('removes $name from both address parts before the app runs', async (testCase) => {
    stubNetwork(() => ({ status: 500 }));
    const { body } = await serve({ path: testCase.address.split(/[?#]/, 1)[0] });

    const result = runEmailLinkBootstrap(body, testCase.address);

    expect(result.cleanedAddress).toBe(testCase.cleanedAddress);
    expect(result.memory?.tokenHash).toBe(testCase.memory.tokenHash);
    expect(result.memory?.type).toBe(testCase.memory.type);
    expect(result.memory?.pendingReference).toBe(testCase.memory.pendingReference);
  });

  it('drops an unusual fragment when it contains a sign-in secret', async () => {
    stubNetwork(() => ({ status: 500 }));
    const { body } = await serve({ path: '/confirm' });

    const result = runEmailLinkBootstrap(
      body,
      '/confirm?kept=query#section?%61ccess_token=private-access',
    );

    expect(result.cleanedAddress).toBe('/confirm?kept=query');
  });
});

describe('retired forgot-password address', () => {
  it('opens the existing Forgot password panel before the app starts', async () => {
    stubNetwork(() => ({ status: 500 }));

    const { body, headers, status } = await serve({ path: '/forgot-password' });
    const result = runForgotPasswordBootstrap(body);

    expect(status).toBe(200);
    expect(headers.get('Cache-Control')).toBe('no-store');
    expect(headers.get('X-Robots-Tag')).toBe('noindex, nofollow');
    expect(body.indexOf('alethical-forgot-password-bootstrap')).toBeLessThan(
      body.indexOf('/_expo/static/js/web/index-abc.js'),
    );
    expect(result.storage.get('alethical.openSignIn')).toBe('forgot');
    expect(result.replacedAddress).toBe('/#auth_screen=forgot');
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
  });

  it('keeps the Forgot password destination when browser storage rejects the write', async () => {
    stubNetwork(() => ({ status: 500 }));

    const { body } = await serve({ path: '/forgot-password' });
    const result = runForgotPasswordBootstrap(body, true);

    expect(result.storage.size).toBe(0);
    expect(result.replacedAddress).toBe('/#auth_screen=forgot');
  });
});

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
            citations: [
              {
                id: 'laws.1.1.0-0',
                label: 'Art. 1, Sec. 1 · Capital improvement appropriations',
                url: 'https://www.revisor.mn.gov/bills/94/2025/0/HF/719/versions/2/',
                excerpt: 'Money is appropriated for public purposes.',
                section_id: 'laws.1.1.0',
                section_order: 1,
              },
            ],
          },
        },
      },
    }));

    const { body, headers, status } = await serve({ path: '/bills/94-2025-HF719' });

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
    expect(body).toContain('<h2>Cited sections</h2>');
    expect(body).toContain('href="/bills/94-2025-HF719?tab=text#ft-laws.1.1.0-1"');
    expect(body).toContain('/_expo/static/js/web/index-abc.js');
    expect(body).toContain('<link rel="stylesheet" href="/fonts.css" />');
    expect(headers.get('Cache-Control')).toContain('s-maxage=600');
    expect(headers.get('X-Robots-Tag')).toBeUndefined();
    expect(readPageShell).toHaveBeenCalledTimes(1);
    expect(vi.mocked(fetch)).not.toHaveBeenCalledWith(
      expect.stringContaining('/index.html'),
      expect.anything(),
    );
  });

  it('names a legislator, and canonicalises a UUID address to their readable one', async () => {
    const calls: string[] = [];
    stubNetwork((url) => {
      calls.push(url);
      return {
        status: 200,
        payload: {
          data: {
            slug: 'aisha-gomez',
            full_name: 'Aisha Gomez',
            biography: 'Community organizer and small business owner.',
            current_service: { chamber: 'house', district: { code: '62A' } },
            service_history: {
              term: 4,
              periods: [{ chamber: 'house', initial_year: 2018, reelection_years: [] }],
            },
          },
        },
      };
    });

    const { body } = await serve({ path: '/legislators/8c31565f-e674-462d-b71f-a1d1ebcc' });

    expect(body).toContain(
      '<title>Rep. Aisha Gomez, Minnesota House District 62A | Alethical</title>',
    );
    expect(body).toContain(
      'rel="canonical" href="https://www.alethical.com/legislators/aisha-gomez"',
    );
    expect(body).toContain('<h1>Rep. Aisha Gomez</h1>');
    expect(body).toContain('House District 62A');
    expect(body).toContain('<h2>Biography</h2>');
    expect(body).toContain('Community organizer and small business owner.');
    expect(body).toContain('Elected to the House: 2018');
    expect(body).toContain('Term: 4th');
    expect(calls[0]).toContain('include=current_service,committees,service_history');
  });

  it('serves a static page without asking the data service anything', async () => {
    const calls: string[] = [];
    stubNetwork((url) => {
      calls.push(url);
      return { status: 500 };
    });

    expect((await serve({ path: '/privacy' })).body).toContain(
      '<title>Privacy Policy | Alethical</title>',
    );
    expect((await serve({ path: '/site-metrics' })).body).toContain(
      '<title>Site Metrics | Alethical</title>',
    );
    expect((await serve({ path: '/privacy' })).body).toContain(
      '<div id="root"><!--alethical:page-snapshot--><!--/alethical:page-snapshot--></div>',
    );
    expect(calls).toHaveLength(0);
    expect(readPageShell).toHaveBeenCalledTimes(1);
  });

  // The research shelf moved out of the money section on 20 Aug 2026 (#1698).
  // The server looks its wording up by path string, so a mismatch between the
  // route's new path and the wording table's key would compile fine and serve
  // a page with no title at all.
  it('titles the research shelf at its own address, and at the old one', async () => {
    stubNetwork(() => ({ status: 500 }));

    for (const path of ['/reports', '/money/reports']) {
      const { body, status } = await serve({ path });
      expect(status).toBe(200);
      expect(body).toContain('<title>Campaign money reports | Alethical</title>');
      expect(body).toContain('<link rel="canonical" href="https://www.alethical.com/reports"');
    }
  });

  // Issue #1760: our own writing was the one thing on the site that reached a
  // search engine only after a crawler had run the app, while every bill page
  // sent its text straight away. These two checks are the `curl` measurement in
  // the issue, run on every pull request, because a silent reopening is exactly
  // how the gap arrived.
  it('sends the reports shelf its list, with a followable link per posted report', async () => {
    const calls: string[] = [];
    stubNetwork((url) => {
      calls.push(url);
      return { status: 500 };
    });

    const { body, status } = await serve({ path: '/reports' });

    expect(status).toBe(200);
    expect(body).toContain('<h1>Campaign money reports</h1>');
    expect(body).toContain('drawn from the filings Minnesota campaigns, parties and funds');
    expect(publishedReports().length).toBeGreaterThan(0);
    for (const report of publishedReports()) {
      expect(body).toContain(`href="/reports/${report.slug}"`);
      expect(body).toContain(report.title);
    }
    // Read from the registry the server already holds, so no data call.
    expect(calls).toHaveLength(0);
  });

  it('sends a report its whole body, not only its title', async () => {
    const calls: string[] = [];
    stubNetwork((url) => {
      calls.push(url);
      return { status: 500 };
    });

    const report = MONEY_ONLY_GOES_ONE_WAY;
    const { body, headers, status } = await serve({ path: `/reports/${report.slug}` });

    expect(status).toBe(200);
    expect(calls).toHaveLength(0);
    expect(body).toContain(`<h1>${report.title}</h1>`);
    expect(body).toContain('PUBLISHED AUG 20 2026 · RECORDS THROUGH JUL 20 2026');

    // Every sentence, bullet and section heading, read out of the registry so
    // the check cannot go stale against a report the team later revises.
    for (const section of report.sections) {
      expect(body).toContain(escapeHtml(section.heading));
    }
    const sentences = [report.shortVersion, ...report.sections.map((section) => section.blocks)]
      .flat()
      .flatMap((block) => {
        if (block.kind === 'paragraph') return [reportRunsText(block.runs)];
        if (block.kind === 'bullets') return block.items.map((item) => reportRunsText(item));
        return block.rows.flat();
      });
    expect(sentences.length).toBeGreaterThan(40);
    for (const sentence of sentences) {
      expect(body).toContain(escapeHtml(sentence));
    }
    for (const source of report.sources) {
      expect(body).toContain(escapeHtml(reportSourceText(source)));
    }

    // Whether a search engine may LIST the report is a separate, unchanged
    // decision: this report is still marked to be skipped.
    expect(report.indexed).toBe(false);
    expect(headers.get('X-Robots-Tag')).toBe('noindex');
    expect(body).toContain('<meta name="robots" content="noindex" />');
    // Rule 13 keeps a report's claims out of its share preview and tags.
    const head = body.slice(0, body.indexOf('</head>'));
    expect(head).toContain('Published Aug 20, 2026 · records through Jul 20, 2026.');
    expect(head).not.toContain('Six organizations');
  });

  it('still treats an unknown or unpublished report address as a missing page', async () => {
    stubNetwork(() => ({ status: 500 }));

    const { body, status } = await serve({ path: '/reports/no-such-report' });

    expect(status).toBe(404);
    expect(body).toContain('<title>Page not found | Alethical</title>');
    expect(body).not.toContain('Six organizations');
  });

  it('serves the normal missing-page response for the retired Traffic address', async () => {
    stubNetwork(() => ({ status: 500 }));

    const { body, headers, status } = await serve({ path: '/traffic' });

    expect(status).toBe(404);
    expect(headers.get('Location')).toBeUndefined();
    expect(body).toContain('<title>Page not found | Alethical</title>');
    expect(body).toContain('<h1>We couldn’t find that page</h1>');
  });

  it('serves the same fixed Find My Legislator introduction before the app loads', async () => {
    const calls: string[] = [];
    stubNetwork((url) => {
      calls.push(url);
      return { status: 500 };
    });

    const { body, status } = await serve({ path: '/find-my-legislator' });

    expect(status).toBe(200);
    expect(body).toContain('<h1>Find my legislator</h1>');
    expect(body).toContain(
      'Enter a full street address — a city or ZIP code alone can&#39;t identify your legislators',
    );
    expect(calls).toHaveLength(0);
  });

  it('serves one crawlable Bills page with the same 10-record page size as the app', async () => {
    const calls: string[] = [];
    const bills = Array.from({ length: 10 }, (_, index) => {
      const fileNumber = index + 11;
      return {
        id: `94-2025-HF${fileNumber}`,
        file_type: 'HF',
        file_number: fileNumber,
        title: `Statutory title ${fileNumber}`,
        ai_analysis: { short_title: `Plain title ${fileNumber}` },
      };
    });
    stubNetwork((url) => {
      calls.push(url);
      return {
        status: 200,
        payload: {
          data: bills,
          page: { limit: 10, offset: 10, has_more: true, total: 25 },
        },
      };
    });

    const { body, status } = await serve({ path: '/bills', page: '2' });

    expect(status).toBe(200);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain('/bills?');
    expect(calls[0]).toContain('scope=legislature');
    expect(calls[0]).toContain('sort=progress');
    expect(calls[0]).toContain('view=directory');
    expect(calls[0]).toContain('limit=10');
    expect(calls[0]).toContain('offset=10');
    expect(body).toContain('<h1>Search bills</h1>');
    expect(body).toContain('rel="canonical" href="https://www.alethical.com/bills?page=2"');
    expect(body.match(/href="\/bills\/94-2025-HF\d+"/g)).toHaveLength(10);
    expect(body).toContain('HF 11');
    expect(body).toContain('Plain title 11');
    expect(body).toContain('<a href="/bills">Previous</a>');
    expect(body).toContain('<a href="/bills?page=3">Next</a>');
    expect(body).not.toContain('Statutory title 11');
  });

  it('links deep Bills pages in jumps instead of a 1,000-page chain', async () => {
    stubNetwork(() => ({
      status: 200,
      payload: {
        data: Array.from({ length: 10 }, (_, index) => ({
          id: `94-2025-HF${index + 1}`,
          ai_analysis: { short_title: `Plain title ${index + 1}` },
        })),
        page: { limit: 10, offset: 0, has_more: true, total: 10_520 },
      },
    }));

    const { body } = await serve({ path: '/bills' });

    expect(body).toContain('<a href="/bills?page=11">Page 11</a>');
    expect(body).toContain('<a href="/bills?page=101">Page 101</a>');
    expect(body).toContain('<a href="/bills?page=1001">Page 1001</a>');
    expect(body).toContain('<a href="/bills?page=1052">Page 1052</a>');
  });

  it('normalises explicit resting Bills settings before deciding the page is filtered', async () => {
    stubNetwork(() => ({
      status: 200,
      payload: {
        data: [
          {
            id: '94-2025-HF5',
            ai_analysis: { short_title: 'A plain title' },
            session: {
              name: '94th Legislature 2025 First Special Session',
              year_start: 2025,
              year_end: 2025,
            },
          },
        ],
        page: { limit: 10, offset: 10, has_more: false, total: 11 },
      },
    }));

    const { body, status } = await serve({
      path: '/bills',
      page: '2',
      scope: 'legislature',
      sort: 'progress',
    });

    expect(status).toBe(200);
    expect(body).toContain('rel="canonical" href="https://www.alethical.com/bills?page=2"');
    expect(body).toContain('HF 5');
    expect(body).toContain('2025 First Special Session');
  });

  it('keeps regular and special-session bills with the same number distinct', async () => {
    stubNetwork(() => ({
      status: 200,
      payload: {
        data: [
          {
            id: '94-2025-HF5',
            ai_analysis: { short_title: 'Regular-session title' },
          },
          {
            id: '94-2025s1-HF5',
            ai_analysis: { short_title: 'Special-session title' },
            session: {
              name: '94th Legislature 2025 First Special Session',
              year_start: 2025,
              year_end: 2025,
            },
          },
        ],
        page: { limit: 10, offset: 0, has_more: false, total: 2 },
      },
    }));

    const { body, status } = await serve({ path: '/bills' });

    expect(status).toBe(200);
    expect(body).toContain('href="/bills/94-2025-HF5"');
    expect(body).toContain('href="/bills/94-2025s1-HF5"');
    expect(body).toContain('2025 First Special Session');
  });

  it('serves one crawlable Legislators page after applying the app name sort and 12-record page size', async () => {
    const legislators = Array.from({ length: 13 }, (_, index) => {
      const number = String(index + 1).padStart(2, '0');
      return {
        id: `member-${number}`,
        slug: `member-${number}`,
        full_name: `Member ${number}`,
        current_service: {
          chamber: index % 2 === 0 ? 'house' : 'senate',
          district: { code: number },
        },
      };
    });
    stubNetwork(() => ({
      status: 200,
      payload: {
        data: legislators.reverse(),
        page: { limit: 250, offset: 0, has_more: false, total: 13 },
      },
    }));

    const { body, status } = await serve({ path: '/legislators', page: '2' });

    expect(status).toBe(200);
    expect(body).toContain('<h1>Search legislators</h1>');
    expect(body).toContain('rel="canonical" href="https://www.alethical.com/legislators?page=2"');
    expect(body.match(/href="\/legislators\/member-\d+"/g)).toHaveLength(1);
    expect(body).toContain('Member 13');
    expect(body).toContain('House · District 13');
    expect(body).toContain('<a href="/legislators">Previous</a>');
    expect(body).not.toContain('>Next</a>');
  });

  it('keeps filtered directory combinations out of the index without a canonical conflict', async () => {
    const calls: string[] = [];
    stubNetwork((url) => {
      calls.push(url);
      return { status: 500 };
    });

    const { body, headers, status } = await serve({ path: '/bills', q: 'water', page: '2' });

    expect(status).toBe(200);
    expect(body).not.toContain('rel="canonical"');
    expect(headers.get('X-Robots-Tag')).toBe('noindex');
    expect(body).toContain(
      '<div id="root"><!--alethical:page-snapshot--><!--/alethical:page-snapshot--></div>',
    );
    expect(calls).toHaveLength(0);
  });

  it('returns 404 for a directory page beyond the real last page', async () => {
    stubNetwork(() => ({
      status: 200,
      payload: {
        data: [],
        page: { limit: 10, offset: 10, has_more: false, total: 10 },
      },
    }));

    const { body, headers, status } = await serve({ path: '/bills', page: '2' });

    expect(status).toBe(404);
    expect(body).toContain('<title>Page not found | Alethical</title>');
    expect(body).not.toContain('rel="canonical"');
    expect(headers.get('X-Robots-Tag')).toBe('noindex');
  });

  it('returns 404 for a Legislators page beyond the real last page', async () => {
    stubNetwork(() => ({
      status: 200,
      payload: {
        data: Array.from({ length: 12 }, (_, index) => ({
          id: `member-${index + 1}`,
          full_name: `Member ${index + 1}`,
        })),
        page: { limit: 250, offset: 0, has_more: false, total: 12 },
      },
    }));

    const { body, headers, status } = await serve({ path: '/legislators', page: '2' });

    expect(status).toBe(404);
    expect(body).toContain('<title>Page not found | Alethical</title>');
    expect(headers.get('X-Robots-Tag')).toBe('noindex');
  });

  it('keeps a filtered Legislators address out of the index without a canonical conflict', async () => {
    const calls: string[] = [];
    stubNetwork((url) => {
      calls.push(url);
      return { status: 500 };
    });

    const { body, headers, status } = await serve({
      path: '/legislators',
      party: 'DFL',
      page: '2',
    });

    expect(status).toBe(200);
    expect(body).not.toContain('rel="canonical"');
    expect(headers.get('X-Robots-Tag')).toBe('noindex');
    expect(body).not.toContain('class="ps-records"');
    expect(calls).toHaveLength(0);
  });

  it('tells robots not to list an answer page, in a header and in the page', async () => {
    stubNetwork(() => ({ status: 500 }));

    const { headers, body } = await serve({
      path: '/ask',
      q: 'What would HF 719 fund?',
    });

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

    const { status, body, headers } = await serve({ path: '/bills/94-2025-HF999999' });

    expect(status).toBe(404);
    expect(body).toContain('<title>Page not found | Alethical</title>');
    expect(body).not.toContain('rel="canonical"');
    // The app replaces this with its bill-specific missing state. The generic
    // snapshot is only for an address that is not a page shape at all.
    expect(body).toContain(
      '<div id="root"><!--alethical:page-snapshot--><!--/alethical:page-snapshot--></div>',
    );
    expect(headers.get('X-Robots-Tag')).toBe('noindex');
  });

  it('still serves a page when the shell has lost its snapshot slot', async () => {
    // The body text improves a page that already works, so its slot going missing
    // must not take the page down. A missing head marker still returns 503.
    readPageShell.mockResolvedValue(
      SHELL.replace(
        '<!--alethical:page-snapshot--><p>Home snapshot from shell</p><!--/alethical:page-snapshot-->',
        '',
      ),
    );
    stubNetwork(() => ({ status: 200, payload: { data: { id: '94-2025-HF719' } } }));

    const { status, body } = await serve({ path: '/bills/94-2025-HF719' });

    expect(status).toBe(200);
    expect(body).toContain('<title>HF 719 (2025) | Alethical</title>');
    expect(body).toContain('<div id="root"></div>');
    expect(body).not.toContain('page-snapshot');
  });

  it('returns 404 for an address with no page behind it', async () => {
    stubNetwork(() => ({ status: 500 }));
    const { status, body, headers } = await serve({ path: '/not-a-page' });

    expect(status).toBe(404);
    expect(body).toContain('<h1>We couldn’t find that page</h1>');
    expect(body).toContain('The address may be mistyped, or the page may have moved.');
    expect(body).toContain('<a href="/">Home</a>');
    expect(body).toContain('<a href="/bills">Browse bills</a>');
    expect(body).toContain('<a href="/legislators">Find legislators</a>');
    expect(headers.get('X-Robots-Tag')).toBe('noindex');
  });

  it.each(['/Home', '/BILLS/94-2025-HF719'])(
    'returns 404 for wrong-case address %s',
    async (path) => {
      stubNetwork(() => ({ status: 500 }));
      expect((await serve({ path })).status).toBe(404);
    },
  );

  it.each([
    ['/chat', '<title>Alethical: Minnesota’s legislative record in plain language</title>'],
    ['/chat/new', '<title>Alethical: Minnesota’s legislative record in plain language</title>'],
    [
      '/chat/sessions/abc-123',
      '<title>Alethical: Minnesota’s legislative record in plain language</title>',
    ],
    ['/account', '<title>Alethical: Minnesota’s legislative record in plain language</title>'],
  ])('keeps the retired address %s working', async (path, title) => {
    stubNetwork(() => ({ status: 500 }));
    const { status, body } = await serve({ path });

    expect(status).toBe(200);
    expect(body).toContain(title);
    expect(body).not.toContain('<h1>Grounded answers on Minnesota politics</h1>');
  });

  it('keeps a retired vote address on its bill page', async () => {
    stubNetwork(() => ({
      status: 200,
      payload: { data: { id: '94-2025-HF719' } },
    }));

    const result = await serve({ path: '/bills/94-2025-HF719/votes/abc-123' });

    expect(result.status).toBe(200);
    expect(result.body).toContain('<title>HF 719 (2025) | Alethical</title>');
  });
});

describe('when the data service is unwell', () => {
  // A hiccup that answered 404 would tell a search engine our pages are gone.
  it('returns 503, never 404, when the data service errors', async () => {
    stubNetwork(() => ({ status: 500 }));

    const { status, headers } = await serve({ path: '/bills/94-2025-HF719' });

    expect(status).toBe(503);
    expect(headers.get('Retry-After')).toBe('120');
    expect(headers.get('Cache-Control')).toBe('no-store');
  });

  it('returns 503 rather than an empty directory when its records cannot be read', async () => {
    stubNetwork(() => ({ status: 500 }));

    const { status, headers } = await serve({ path: '/bills' });

    expect(status).toBe(503);
    expect(headers.get('Retry-After')).toBe('120');
  });

  it.each(['/bills', '/legislators'])(
    'returns 503 rather than saying the directory itself is gone when %s data answers 404',
    async (path) => {
      stubNetwork(() => ({ status: 404 }));

      const { status, headers } = await serve({ path });

      expect(status).toBe(503);
      expect(headers.get('Retry-After')).toBe('120');
      expect(headers.get('X-Robots-Tag')).toBeUndefined();
    },
  );

  it('returns 503 when the data service cannot be reached at all', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('connection refused');
      }),
    );

    expect((await serve({ path: '/legislators/aisha-gomez' })).status).toBe(503);
  });

  it('returns 503 rather than a page with the wrong tags when the shell is unreadable', async () => {
    readPageShell.mockResolvedValue('<html><head></head></html>');
    stubNetwork(() => ({
      status: 200,
      payload: { data: [], page: { limit: 10, offset: 0, has_more: false, total: 0 } },
    }));

    expect((await serve({ path: '/bills' })).status).toBe(503);
  });
});
