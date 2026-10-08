import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PUBLISHED_EVENTS, eventPath } from '../events';
import { renderEventArticle, renderEventsCollection } from '../eventMarkup';
import sitemap from '../../../../../api/sitemap';

const { readPageShell } = vi.hoisted(() => ({ readPageShell: vi.fn() }));
vi.mock('node:fs/promises', () => ({ readFile: readPageShell }));
const SHELL =
  '<!DOCTYPE html><html><head><!--alethical:page-head--><!--/alethical:page-head--></head><body><div id="root"><!--alethical:page-snapshot--><!--/alethical:page-snapshot--></div><!--alethical:page-data--><!--/alethical:page-data--></body></html>';
const now = Date.parse('2026-10-07T18:00:00-05:00');

function recorder() {
  let body = '';
  let status = 0;
  const response = {
    setHeader: vi.fn(),
    status(code: number) {
      status = code;
      return response;
    },
    send(value: string) {
      body = value;
    },
  };
  return { response, read: () => ({ body, status }) };
}

beforeEach(() => {
  vi.resetModules();
  vi.spyOn(Date, 'now').mockReturnValue(now);
  readPageShell.mockResolvedValue(SHELL);
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('No API data needed')));
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function serve(path: string) {
  const { default: page } = await import('../../../../../api/page');
  const output = recorder();
  await page({ query: { path } }, output.response);
  return output.read();
}

describe('public event pages before JavaScript', () => {
  it('serves the exact shared article with flyer before words and useful registration links', async () => {
    const { body, status } = await serve(eventPath(PUBLISHED_EVENTS[0]));
    expect(status).toBe(200);
    expect(body).toContain(renderEventArticle(PUBLISHED_EVENTS[0], now));
    expect(body).toContain('Republican primary candidate');
    expect(body).toContain('href="https://luma.com/3w69g6dw"');
    expect(body).toContain('href="https://forwardcoalition.com/candidates"');
    expect(body).toContain('aria-label="Site"');
    const content = body.slice(body.indexOf('<body>'));
    expect(content.indexOf(PUBLISHED_EVENTS[0].image)).toBeLessThan(content.indexOf('<h1'));
    expect(fetch).not.toHaveBeenCalled();
  });

  it('serves the shared event collection and crawlable blog links', async () => {
    const collection = await serve('/blog/events');
    expect(collection.status).toBe(200);
    expect(collection.body).toContain(renderEventsCollection(now));
    expect(collection.body).toContain('href="/blog/events/forward-debate-2026"');
    const blog = await serve('/blog');
    expect(blog.body).toContain('href="/blog/events"');
    expect(blog.body).toContain('href="/blog/events/forward-debate-2026"');
  });

  it('returns a real not-found response for an unknown announcement', async () => {
    const { body, status } = await serve('/blog/events/nonexistent-event');
    expect(status).toBe(404);
    expect(body).toContain('content="noindex"');
    expect(body).not.toContain('rel="canonical"');
    expect(body).not.toContain('"@type":"Event"');
  });

  it('lists the collection and each announcement in the public pages sitemap', async () => {
    const output = recorder();
    await sitemap({ query: { section: 'pages' } }, output.response);
    expect(output.read().status).toBe(200);
    expect(output.read().body).toContain('<loc>https://www.alethical.com/blog/events</loc>');
    for (const event of PUBLISHED_EVENTS) {
      expect(output.read().body).toContain(
        `<loc>https://www.alethical.com${eventPath(event)}</loc>`,
      );
    }
  });
});

// Exercise the reusable published route without lifting the real candidate-review hold.
vi.mock('../eventsIndex', async (importOriginal) => {
  const original = await importOriginal<typeof import('../eventsIndex')>();
  const index = original.EVENT_INDEX.map((event) => ({ ...event, published: true }));
  return {
    EVENT_INDEX: index,
    PUBLISHED_EVENT_INDEX: index,
    eventIndexBySlug: (slug: string) => index.find((event) => event.slug === slug),
  };
});
