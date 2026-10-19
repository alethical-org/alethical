import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import { PUBLISHED_EVENTS, eventPath } from '../events';
import { renderEventsCollection } from '../eventMarkup';
import { renderEventArticle } from '../eventArticle';
import fixture from './fixtures/eventReplay.json';
import sitemap from '../../../../../api/sitemap';

const { readPageShell } = vi.hoisted(() => ({ readPageShell: vi.fn() }));
vi.mock('node:fs/promises', () => ({ readFile: readPageShell }));
const SHELL =
  '<!DOCTYPE html><html><head><!--alethical:page-head--><!--/alethical:page-head--></head><body><div id="root"><!--alethical:page-snapshot--><!--/alethical:page-snapshot--></div><!--alethical:page-data--><!--/alethical:page-data--></body></html>';
const now = Date.parse('2026-10-19T18:00:00-05:00');

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
  vi.doUnmock('../eventReplayContent');
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function serve(path: string, t?: string) {
  const { default: page } = await import('../../../../../api/page');
  const output = recorder();
  await page({ query: { path, ...(t ? { t } : {}) } }, output.response);
  return output.read();
}

describe('public event pages before JavaScript', () => {
  it('serves the final recording outside the replaced application root with actual search facts', async () => {
    const { body, status } = await serve(eventPath(PUBLISHED_EVENTS[0]));
    expect(status).toBe(200);
    expect(body).toContain(
      renderEventArticle(PUBLISHED_EVENTS[0], now, { origin: 'https://www.alethical.com' }),
    );
    expect(body).toContain('Republican-endorsed write-in candidate');
    expect(body).toContain('href="https://luma.com/3w69g6dw"');
    expect(body).toContain('href="https://forwardcoalition.com/candidates"');
    expect(body).toContain('aria-label="Site"');
    const doc = new JSDOM(body).window.document;
    const content = doc.body.innerHTML;
    expect(content.indexOf(PUBLISHED_EVENTS[0].image)).toBeGreaterThan(content.indexOf('<h1'));
    expect(content).not.toMatch(/PRIVATE DRAFT|being prepared|not ready|will appear/i);
    expect(body).not.toContain('name="robots" content="noindex"');
    expect(body).toContain('Trent Dilks &amp; Aaron Brutger: The Forward Debate | Alethical');
    expect(body).toContain('"@type":"VideoObject"');
    expect(body).toContain('"uploadDate":"2026-10-19T11:13:45-07:00"');
    const stable = doc.getElementById('stable-event-document');
    expect(stable?.querySelector('iframe')?.src).toContain('/embed/y66-Wf9bNio?');
    expect(doc.getElementById('root')?.contains(stable)).toBe(false);
    expect(doc.querySelectorAll('iframe')).toHaveLength(1);
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

it('keeps actual video timestamps in initial HTML, with a bare canonical and shared Clip times', async () => {
  const replay = { ...fixture, video: { ...fixture.video, publishedAt: '2026-10-18T18:00:00Z' } };
  vi.doMock('../eventReplayContent', () => ({ eventReplayBySlug: () => replay }));
  const { body, status } = await serve(eventPath(PUBLISHED_EVENTS[0]), '20');
  expect(status).toBe(200);
  expect(body).toContain('start=20');
  expect(body).toContain(
    'rel="canonical" href="https://www.alethical.com/blog/events/forward-debate-2026"',
  );
  expect(body).toContain('"@type":"VideoObject"');
  expect(body).toContain('"startOffset":20');
  expect(body).toContain('Uncertain words and speakers are marked.');
  expect(body).toContain(fixture.transcript.turns[0].paragraphs[0]);
});

it('publishes the video sitemap with the final recording and actual publication time', async () => {
  const index = recorder();
  await sitemap({ query: {} }, index.response);
  expect(index.read().body).toContain('/sitemaps/videos.xml');
  const videos = recorder();
  await sitemap({ query: { section: 'videos' } }, videos.response);
  expect(videos.read().status).toBe(200);
  const doc = new JSDOM(videos.read().body, { contentType: 'text/xml' }).window.document;
  expect(doc.getElementsByTagName('video:player_loc')[0].textContent).toContain(
    '/embed/y66-Wf9bNio?',
  );
  expect(doc.getElementsByTagName('video:publication_date')[0].textContent).toBe(
    '2026-10-19T11:13:45-07:00',
  );
  expect(doc.getElementsByTagName('video:duration')[0].textContent).toBe('7401');
  expect(videos.read().body).not.toContain('content_loc');
});
