import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runInNewContext } from 'node:vm';

import {
  READ_PAGE_NAME,
  piecePath,
  publishedResearch,
  researchRunsText,
  researchSourceText,
} from '../research';
import { MONEY_ONLY_GOES_ONE_WAY } from '../researchPieces/moneyOnlyGoesOneWay';
import { WHO_HAS_TO_REPORT_THEIR_MONEY } from '../researchPieces/whoHasToReportTheirMoney';
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
  '<!--alethical:page-data--><!--/alethical:page-data-->',
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

  // The /read page moved out of the money section on 20 Aug 2026 (#1698), off
  // /reports on the morning of 27 Aug 2026 and off /reading that evening. The
  // server looks its wording up by path string, so a mismatch between the
  // route's new path and the wording table's key would compile fine and serve a
  // page with no title at all. All 3 old addresses are checked because a host
  // with no forwards still has to serve them, and each one serves the /read
  // canonical rather than its own.
  it('titles the /read page at its own address, and at all 3 old ones', async () => {
    stubNetwork(() => ({ status: 500 }));

    for (const path of ['/read', '/reading', '/reports', '/money/reports']) {
      const { body, status } = await serve({ path });
      expect(status).toBe(200);
      // The tab carries the page's own name, because the page shows no title.
      expect(body).toContain(`<title>${READ_PAGE_NAME} | Alethical</title>`);
      expect(body).toContain('<link rel="canonical" href="https://www.alethical.com/read"');
    }
  });

  // Issue #1760: our own writing was the one thing on the site that reached a
  // search engine only after a crawler had run the app, while every bill page
  // sent its text straight away. These two checks are the `curl` measurement in
  // the issue, run on every pull request, because a silent reopening is exactly
  // how the gap arrived.
  it('sends the /read page its list, with a followable link per posted piece', async () => {
    const calls: string[] = [];
    stubNetwork((url) => {
      calls.push(url);
      return { status: 500 };
    });

    const { body, status } = await serve({ path: '/read' });

    expect(status).toBe(200);
    expect(body).toContain(`<h1>${READ_PAGE_NAME}</h1>`);
    expect(body).toContain('plus guides to how state government works');
    expect(publishedResearch().length).toBeGreaterThan(1);
    for (const piece of publishedResearch()) {
      // Each piece's own folder, so a crawler is never sent to an address the
      // router rejects.
      expect(body).toContain(`href="${piecePath(piece)}"`);
      expect(body).toContain(piece.title);
    }
    // Read from the registry the server already holds, so no data call.
    expect(calls).toHaveLength(0);
  });

  it('sends a piece its whole body, not only its title', async () => {
    const calls: string[] = [];
    stubNetwork((url) => {
      calls.push(url);
      return { status: 500 };
    });

    const piece = MONEY_ONLY_GOES_ONE_WAY;
    const { body, headers, status } = await serve({ path: `/read/research/${piece.slug}` });

    expect(status).toBe(200);
    expect(calls).toHaveLength(0);
    expect(body).toContain(`<h1>${piece.title}</h1>`);
    expect(body).toContain('PUBLISHED AUG 20 2026 · RECORDS THROUGH JUL 20 2026');

    // Every sentence, bullet and section heading, read out of the registry so
    // the check cannot go stale against a piece the team later revises.
    for (const section of piece.sections) {
      expect(body).toContain(escapeHtml(section.heading));
    }
    const sentences = [piece.shortVersion, ...piece.sections.map((section) => section.blocks)]
      .flat()
      .flatMap((block) => {
        if (block.kind === 'paragraph') return [researchRunsText(block.runs)];
        if (block.kind === 'bullets') return block.items.map((item) => researchRunsText(item));
        // A note's sentence must reach the first response like any other prose.
        if (block.kind === 'note') return [block.text];
        return block.rows.flat();
      });
    expect(sentences.length).toBeGreaterThan(40);
    for (const sentence of sentences) {
      expect(body).toContain(escapeHtml(sentence));
    }
    for (const source of piece.sources) {
      expect(body).toContain(escapeHtml(researchSourceText(source)));
    }

    // Every published piece is visible to search engines from the day it posts
    // (Eugene, 25 Aug 2026), so a posted piece carries no skip instruction and
    // does carry a canonical address.
    expect(piece.indexed).toBe(true);
    expect(headers.get('X-Robots-Tag')).toBeUndefined();
    expect(body).not.toContain('<meta name="robots" content="noindex" />');
    expect(body).toContain(
      '<link rel="canonical" href="https://www.alethical.com/read/research/the-money-only-goes-one-way" />',
    );
    // Rule 13 keeps a piece's claims out of its share preview and tags.
    const head = body.slice(0, body.indexOf('</head>'));
    expect(head).toContain('Published Aug 20, 2026 · records through Jul 20, 2026.');
    expect(head).not.toContain('Six organizations');
  });

  // The guide is the first piece whose closing block carries several links in one
  // sentence, so this is where "named and linked at its source" is measured for
  // the shape that holds most of them (grounded-answers rule 5, rule 13).
  it('sends a guide its whole body and every one of its source links', async () => {
    const calls: string[] = [];
    stubNetwork((url) => {
      calls.push(url);
      return { status: 500 };
    });

    const guide = WHO_HAS_TO_REPORT_THEIR_MONEY;
    const { body, headers, status } = await serve({ path: piecePath(guide) });

    expect(status).toBe(200);
    expect(calls).toHaveLength(0);
    expect(body).toContain(`<h1>${guide.title}</h1>`);
    // Kind, minutes and 1 date. No second date, and no piece number.
    expect(body).toContain('GUIDE · 5 MIN · WRITTEN AUGUST 2026');
    expect(body).not.toContain('RECORDS THROUGH');
    expect(body).not.toContain('piece 1');
    // The set's name, which is all a reader is told about where the piece sits.
    expect(body).toContain('How the Money Works');

    for (const section of guide.sections) {
      expect(body).toContain(escapeHtml(section.heading));
    }
    const sentences = [...(guide.intro ?? []), ...guide.sections.flatMap((s) => s.blocks)].flatMap(
      (block) => {
        if (block.kind === 'paragraph') return [researchRunsText(block.runs)];
        if (block.kind === 'bullets') return block.items.map((item) => researchRunsText(item));
        return [];
      },
    );
    expect(sentences.length).toBeGreaterThan(20);
    for (const sentence of sentences) {
      expect(body).toContain(escapeHtml(sentence));
    }

    // Every address the sources block holds, as a real anchor: 8 at the Board and
    // 3 at the statutes.
    const hrefs = (guide.sourceRuns ?? [])
      .flat()
      .filter((run) => run.kind === 'externalLink')
      .map((run) => (run as { href: string }).href);
    expect(hrefs).toHaveLength(11);
    for (const href of hrefs) {
      expect(body).toContain(`<a href="${escapeHtml(href)}">`);
    }
    expect(hrefs.filter((href) => href.includes('cfb.mn.gov'))).toHaveLength(8);
    expect(hrefs.filter((href) => href.includes('revisor.mn.gov'))).toHaveLength(3);

    expect(guide.indexed).toBe(true);
    expect(headers.get('X-Robots-Tag')).toBeUndefined();
    expect(body).toContain(
      '<link rel="canonical" href="https://www.alethical.com/read/guides/who-has-to-report-their-money" />',
    );
    // Title and dates only in the tags: no figure and no claim.
    const head = body.slice(0, body.indexOf('</head>'));
    expect(head).toContain('Written August 2026.');
    expect(head).not.toContain('$66,750');
  });

  // A piece answers on 1 address. The other folder is an absent page, not a
  // second way in.
  it('serves a missing page for a piece asked for under the wrong folder', async () => {
    stubNetwork(() => ({ status: 500 }));

    for (const path of [
      '/read/research/who-has-to-report-their-money',
      '/read/guides/the-money-only-goes-one-way',
      '/reading/research/who-has-to-report-their-money',
      '/reading/guides/the-money-only-goes-one-way',
      '/reports/who-has-to-report-their-money',
    ]) {
      const { body, status } = await serve({ path });
      expect(status).toBe(404);
      expect(body).toContain('<title>Page not found | Alethical</title>');
    }
  });

  it('still treats an unknown or unpublished piece address as a missing page', async () => {
    stubNetwork(() => ({ status: 500 }));

    for (const path of [
      '/read/research/no-such-piece',
      '/read/guides/no-such-guide',
      '/read/sets/no-such-set',
    ]) {
      const { body, status } = await serve({ path });
      expect(status).toBe(404);
      expect(body).toContain('<title>Page not found | Alethical</title>');
      expect(body).not.toContain('Six organizations');
    }
  });

  // The one posted piece is served in full at both addresses it used to answer
  // on, so a host without vercel.json's forwards still opens it.
  it('serves the posted piece at both of its old addresses too', async () => {
    stubNetwork(() => ({ status: 500 }));

    const piece = MONEY_ONLY_GOES_ONE_WAY;
    for (const path of [`/reports/${piece.slug}`, `/money/reports/${piece.slug}`]) {
      const { body, status } = await serve({ path });
      expect(status).toBe(200);
      expect(body).toContain(`<h1>${piece.title}</h1>`);
    }
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

  // A filtered view of one free-text spelling, not a record: an indexable page
  // per spelling would put an unbounded set of thin pages in front of search
  // engines, and a page indexed under a name reads as a profile of whoever
  // carries it — the one thing this page may never be
  // (page-metadata-for-search-and-sharing-decisions.md §22, §20.5 rule 4).
  it('keeps a payments-under-a-name address out of the index, and asks the API for nothing', async () => {
    const calls: string[] = [];
    stubNetwork((url) => {
      calls.push(url);
      return { status: 500 };
    });

    const { body, headers, status } = await serve({
      path: '/money/payments',
      name: 'Heat & Frost Insulators Local #34',
      role: 'contributor',
    });

    expect(status).toBe(200);
    expect(headers.get('X-Robots-Tag')).toBe('noindex');
    expect(body).not.toContain('rel="canonical"');
    expect(body).toContain(
      '<title>Money given under the name “Heat &amp; Frost Insulators Local #34” | Alethical</title>',
    );
    expect(body).toContain(
      '<div id="root"><!--alethical:page-snapshot--><!--/alethical:page-snapshot--></div>',
    );
    expect(calls).toHaveLength(0);
  });

  it('returns 404 for a payments-under-a-name address with no name or an unserved role', async () => {
    stubNetwork(() => ({ status: 500 }));
    expect((await serve({ path: '/money/payments' })).status).toBe(404);
    expect(
      (await serve({ path: '/money/payments', name: 'Facebook', role: 'employer' })).status,
    ).toBe(404);
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

/**
 * The reads the function already makes, handed to the app in the same response
 * (issue #1966). Before this, `/money/committees` fetched the identical URL a
 * second time 1,253 ms into the load and waited until 1,771 ms for it.
 */
describe('the records a money page hands to the app', () => {
  const COMMITTEE_REGISTER = {
    state: 'reported',
    ordered_by: 'name',
    committees: [
      {
        registration_number: '20963',
        name: '34th Senate District RPM',
        kind: 'party_unit',
        sub_type: null,
        office: null,
        district: null,
        is_closed: false,
        termination_date: null,
      },
    ],
    page: { has_more: true, total: 1 },
    register_total: 1603,
    by_kind: { party_unit: 1 },
    as_of: '2026-09-01',
  };

  const OUTSIDE_SPENDING = {
    state: 'reported',
    about: null,
    spender: null,
    year: null,
    sort: 'newest',
    rows: [],
    page: { number: 1, size: 50, has_more: false, total_rows: 4321 },
    figures: {
      row_count: 4321,
      rows_missing_an_amount: 0,
      amount_total: '12345678.90',
      supporting_count: 3000,
      supporting_amount: '9000000.00',
      opposing_count: 1321,
      opposing_amount: '3345678.90',
      direction_not_recorded_count: 0,
      direction_not_recorded_amount: null,
      in_kind_count: 12,
      first_year: 2015,
      last_year: 2026,
      committee_count: 400,
      spender_count: 120,
      committees_not_linkable: 3,
    },
    source_url: 'https://cfb.mn.gov/independent-expenditures.csv',
    fetched_at: '2026-09-01T12:00:00Z',
  };

  /** Every entry in the served data block, as the app's own reader parses it. */
  function servedData(body: string): { key: unknown[]; payload: Record<string, unknown> }[] {
    const block = body.match(
      /<script type="application\/json" id="alethical-page-data">([\s\S]*?)<\/script>/,
    )?.[1];
    if (!block) return [];
    return JSON.parse(block);
  }

  it('hands /money/committees the rows it read, under the key the list asks for', async () => {
    const calls: string[] = [];
    stubNetwork((url) => {
      calls.push(url);
      return { status: 200, payload: { data: COMMITTEE_REGISTER } };
    });

    const { body } = await serve({ path: '/money/committees' });

    expect(calls).toEqual([
      'https://api.alethical.com/api/v1/campaign-finance/committees?limit=50&offset=0',
    ]);
    expect(servedData(body)).toEqual([
      {
        key: ['campaign-finance-committees', 'all', '', 1, 50],
        // Byte for byte the service's own JSON: no figure is reshaped on the way
        // through, so a seeded figure cannot differ from a fetched one, and the
        // list's `as_of` date belongs to the very read the rows came from.
        payload: COMMITTEE_REGISTER,
      },
    ]);
    // The block sits after the app's mount point, so a large payload cannot delay
    // the snapshot text, and before the bundle, so it is there when the app runs.
    expect(body.indexOf('<div id="root">')).toBeLessThan(body.indexOf('id="alethical-page-data"'));
    expect(body.indexOf('id="alethical-page-data"')).toBeLessThan(
      body.indexOf('/_expo/static/js/web/index-abc.js'),
    );
  });

  it('hands page 2 the key for page 2', async () => {
    stubNetwork(() => ({
      status: 200,
      payload: {
        data: { ...COMMITTEE_REGISTER, page: { has_more: false, total: 51 } },
      },
    }));

    const { body } = await serve({ path: '/money/committees', page: '2' });

    expect(servedData(body)[0].key).toEqual(['campaign-finance-committees', 'all', '', 2, 50]);
  });

  it('hands a filtered committee address nothing, because it reads nothing', async () => {
    stubNetwork(() => ({ status: 200, payload: { data: COMMITTEE_REGISTER } }));

    const { body } = await serve({ path: '/money/committees', kind: 'party_unit' });

    expect(servedData(body)).toEqual([]);
    expect(body).toContain('<!--alethical:page-data--><!--/alethical:page-data-->');
  });

  it('hands /money/races its contests, so the 778 rows are not downloaded twice', async () => {
    const races = {
      state: 'reported',
      year: 2026,
      ordered_by: 'office, district, name',
      contest_count: 1,
      committee_count: 1,
      as_of: '2026-09-01',
      contests: [
        {
          office: 'State Senator',
          district: '34',
          seat: 'Senate District 34',
          committees: [
            {
              registration_number: '20963',
              name: 'Volunteers for Someone',
              reported_total: '1000.00',
              termination_date: null,
            },
          ],
        },
      ],
    };
    stubNetwork(() => ({ status: 200, payload: { data: races } }));

    const { body } = await serve({ path: '/money/races' });
    const served = servedData(body);

    expect(served).toHaveLength(1);
    expect(served[0].key).toEqual(['campaign-finance-races', 2026, 'all']);
    expect(served[0].payload).toEqual(races);
  });

  it('hands /money its 2 reads, made together', async () => {
    const summary = {
      register: { state: 'reported', filer_count: 1603 },
      legislator_committee_confirmations: {
        state: 'reported',
        confirmed_member_count: 0,
        sitting_member_count: 201,
        newest_confirmation_at: null,
      },
      freshness: { downloads_fetched_at: '2026-09-01T12:00:00Z' },
    };
    const filings = { state: 'reported', ordered_by: 'filed_date', filings: [] };
    stubNetwork((url) => ({
      status: 200,
      payload: { data: url.includes('/filings') ? filings : summary },
    }));

    const { body } = await serve({ path: '/money' });

    expect(servedData(body)).toEqual([
      { key: ['campaign-finance-summary'], payload: summary },
      { key: ['campaign-finance-filings', 5], payload: filings },
    ]);
  });

  it('still serves /money when a count cannot be read, and hands on nothing for it', async () => {
    stubNetwork(() => ({ status: 500 }));

    const { body, status } = await serve({ path: '/money' });

    expect(status).toBe(200);
    expect(servedData(body)).toEqual([]);
  });

  it('gives /money/outside-spending a body and its figures, robots unchanged', async () => {
    const calls: string[] = [];
    stubNetwork((url) => {
      calls.push(url);
      return { status: 200, payload: { data: OUTSIDE_SPENDING } };
    });

    const { body, headers, status } = await serve({ path: '/money/outside-spending' });

    expect(status).toBe(200);
    // The URL the app itself would have asked for, so the seeded payload answers
    // the app's own question rather than a near-miss of it.
    expect(calls).toEqual([
      'https://api.alethical.com/api/v1/campaign-finance/outside-spending?sort=newest',
    ]);
    expect(body).toContain('<h1>Spending by groups that are not the campaign</h1>');
    // The app's own money formatter, so the served figure is the drawn figure.
    expect(body).toContain('$12,345,678');
    expect(body).toContain('across 4,321 payments, 2015 through 2026');
    expect(body).toContain('href="/money/committees?kind=political_committee_or_fund"');
    expect(body).toContain('Read from the Board’s file');
    expect(servedData(body)).toEqual([
      {
        key: ['outside-spending-record', null, null, null, 'newest', 1],
        payload: OUTSIDE_SPENDING,
      },
    ]);
    // Unchanged from before this page had a body: the bare record is listable and
    // carries its own canonical address.
    expect(headers.get('X-Robots-Tag')).toBeUndefined();
    expect(body).toContain(
      'rel="canonical" href="https://www.alethical.com/money/outside-spending"',
    );
  });

  it('withholds a total the record does not report rather than printing 0', async () => {
    stubNetwork(() => ({
      status: 200,
      payload: { data: { ...OUTSIDE_SPENDING, state: 'not_reported', figures: null } },
    }));

    const { body } = await serve({ path: '/money/outside-spending' });

    expect(body).toContain('Nothing on record');
    expect(body).not.toContain('$0.00');
  });

  it('leaves a filtered outside-spending address head only and noindex', async () => {
    stubNetwork(() => ({ status: 200, payload: { data: OUTSIDE_SPENDING } }));

    const { body, headers } = await serve({ path: '/money/outside-spending', spender: '20963' });

    expect(body).not.toContain('<h1>Spending by groups that are not the campaign</h1>');
    expect(servedData(body)).toEqual([]);
    expect(headers.get('X-Robots-Tag')).toBe('noindex');
  });

  it('gives /money/search a body that says what it searches, still noindex', async () => {
    stubNetwork(() => ({ status: 500 }));

    const { body, headers, status } = await serve({ path: '/money/search' });

    expect(status).toBe(200);
    expect(body).toContain('<h1>Search these records by name</h1>');
    expect(body).toContain('Type a name to search');
    // The sentence the screen puts ABOVE its results, for the same reason: a
    // reader told nothing reads an empty answer as "they gave nothing".
    expect(body).toContain('What this record does not cover');
    expect(body).toContain('href="/money/committees"');
    // The results are whatever somebody typed, so the address stays unlistable.
    expect(headers.get('X-Robots-Tag')).toBe('noindex');
    expect(servedData(body)).toEqual([]);
  });

  it('serves a page whose shell has no slot for the block, as it did before', async () => {
    readPageShell.mockResolvedValue(SHELL.replace('<!--alethical:page-data-->', ''));
    stubNetwork(() => ({ status: 200, payload: { data: COMMITTEE_REGISTER } }));

    const { body, status } = await serve({ path: '/money/committees' });

    expect(status).toBe(200);
    expect(body).toContain('<h1>Committees</h1>');
    expect(servedData(body)).toEqual([]);
  });
});
