import { existsSync, readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EVENTS, PUBLISHED_EVENTS, eventBySlug, orderedEvents } from '../events';
import { PUBLISHED_EVENT_INDEX, eventIndexBySlug } from '../eventsIndex';
import { targetFromPathname } from '../../navigation/webRoutes';
import sitemap from '../../../../../api/sitemap';

vi.mock('node:fs/promises', () => ({
  readFile: vi
    .fn()
    .mockResolvedValue(
      '<!DOCTYPE html><html><head><!--alethical:page-head--><!--/alethical:page-head--></head><body><div id="root"><!--alethical:page-snapshot--><!--/alethical:page-snapshot--></div><!--alethical:page-data--><!--/alethical:page-data--></body></html>',
    ),
}));

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
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('data unavailable')));
});
afterEach(() => vi.unstubAllGlobals());

describe('candidate approval publication hold', () => {
  it('retains the complete event but excludes it from public selections', () => {
    expect(EVENTS[0].name).toBe('The Forward Debate');
    expect(EVENTS[0].candidates).toHaveLength(2);
    expect(EVENTS[0].published).toBe(false);
    expect(PUBLISHED_EVENT_INDEX).toEqual([]);
    expect(PUBLISHED_EVENTS).toEqual([]);
    expect(orderedEvents()).toEqual([]);
    expect(eventBySlug(EVENTS[0].slug)).toBeUndefined();
    expect(eventIndexBySlug(EVENTS[0].slug)).toBeUndefined();
  });

  it.each(['/blog/events/forward-debate-2026', '/blog/events'])(
    'removes direct access and search metadata at %s',
    async (path) => {
      expect(targetFromPathname(path)).toEqual({ kind: 'notFound', path });
      const { default: page } = await import('../../../../../api/page');
      const output = recorder();
      await page({ query: { path } }, output.response);
      expect(output.read().status).toBe(404);
      expect(output.read().body).toContain('content="noindex"');
      expect(output.read().body).not.toContain('Trent Dilks');
      expect(output.read().body).not.toContain('"@type":"Event"');
    },
  );

  it('removes event links from the Blog and public sitemap', async () => {
    const { default: page } = await import('../../../../../api/page');
    const blog = recorder();
    await page({ query: { path: '/blog' } }, blog.response);
    expect(blog.read().status).toBe(200);
    expect(blog.read().body).not.toContain('href="/blog/events');
    const map = recorder();
    await sitemap({ query: { section: 'pages' } }, map.response);
    expect(map.read().body).not.toContain('/blog/events');
  });

  it('keeps the flyer outside public assets and excludes held comments', () => {
    expect(
      existsSync(new URL('../../../assets/event-drafts/forward-debate-2026.webp', import.meta.url)),
    ).toBe(true);
    expect(
      existsSync(new URL('../../../public/events/forward-debate-2026.webp', import.meta.url)),
    ).toBe(false);
    const identities = JSON.parse(
      readFileSync(
        new URL('../../../../../alethical/data/editorial_articles.json', import.meta.url),
        'utf8',
      ),
    );
    expect(
      identities.some((item: { article_id: string }) => item.article_id === EVENTS[0].articleId),
    ).toBe(false);
  });
});
