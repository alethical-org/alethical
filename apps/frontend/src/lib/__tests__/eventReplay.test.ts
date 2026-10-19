import { describe, expect, it } from 'vitest';
import { JSDOM } from 'jsdom';
import fixture from './fixtures/eventReplay.json';
import { EVENTS } from '../events';
import { eventPageMetadata } from '../eventMetadata';
import { renderEventArticle } from '../eventMarkup';
import {
  assertReplayReady,
  parseEventReplay,
  replayEmbedUrl,
  replayPageMetadata,
  replayStart,
  replayTimestamp,
  replayVideoSitemap,
} from '../eventReplay';
import { renderEventReplay } from '../eventReplayMarkup';

const draft = () => structuredClone(fixture);
const ready = () => {
  const r = parseEventReplay(draft());
  r.captions.checked = true;
  r.captions.uploaded = true;
  r.transcript.checked = true;
  r.video.publishedAt = '2026-10-18T18:00:00Z';
  return r;
};

describe('replay content and publication boundaries', () => {
  it('allows a clearly unchecked private draft but prevents public recording claims', () => {
    expect(parseEventReplay(draft())).toEqual(fixture);
    expect(() => assertReplayReady(parseEventReplay(draft()))).toThrow('Publication needs');
    expect(() => replayPageMetadata(EVENTS[0], parseEventReplay(draft()))).toThrow();
    expect(() => replayVideoSitemap(EVENTS[0], parseEventReplay(draft()))).toThrow();
  });
  it('rejects mismatched exports and malformed or impossible timed text', () => {
    const r = draft();
    r.captions.exportId = 'old-cut';
    expect(() => parseEventReplay(r)).toThrow('match');
    for (const start of [-1, 60, NaN]) {
      const r = draft();
      r.transcript.turns[1].start = start;
      expect(() => parseEventReplay(r)).toThrow('Transcript');
    }
    const c = draft();
    c.chapters.items[1].start = 4;
    expect(() => parseEventReplay(c)).toThrow('chapters');
    for (const input of [
      null,
      {},
      { ...draft(), transcript: null },
      { ...draft(), thumbnail: { url: 'javascript:alert(1)' } },
    ]) {
      expect(() => parseEventReplay(input)).toThrow();
    }
  });
  it('keeps video publication separate from event and article dates', () => {
    const r = ready();
    const metadata = replayPageMetadata(EVENTS[0], r);
    expect(metadata.article?.publishedOn).toBe(EVENTS[0].publishedOn);
    expect(metadata.structuredData?.[0]).toMatchObject({
      uploadDate: r.video.publishedAt,
      duration: 'PT60S',
      hasPart: [
        { startOffset: 0, endOffset: 20 },
        { startOffset: 20, endOffset: 40 },
        { startOffset: 40, endOffset: 60 },
      ],
    });
    r.video.publishedAt = '2099-01-01T00:00:00Z';
    expect(() => replayPageMetadata(EVENTS[0], r)).toThrow('Publication needs');
  });
  it('escapes sitemap text and uses the same working topic times', () => {
    const r = ready();
    r.title = 'A & B <debate>';
    const xml = replayVideoSitemap(EVENTS[0], r);
    expect(xml).toContain('A &amp; B &lt;debate&gt;');
    const doc = new JSDOM(xml, { contentType: 'text/xml' }).window.document;
    expect(doc.querySelector('parsererror')).toBeNull();
    expect(doc.getElementsByTagName('video:player_loc')[0].textContent).toContain(
      '/embed/M7lc1UVf-VE?',
    );
    expect(xml).not.toContain('content_loc');
  });
  it('leaves the public announcement and its event-only metadata unchanged', () => {
    expect(renderEventArticle(EVENTS[0])).not.toContain('replay-player');
    expect(eventPageMetadata(EVENTS[0]).structuredData?.[0]).toHaveProperty('@type', 'Event');
    expect(JSON.stringify(eventPageMetadata(EVENTS[0]))).not.toContain('VideoObject');
  });
});

describe('replay HTML and shareable timestamps', () => {
  it('renders real text in the initial HTML and escapes speaker/title/body content', () => {
    const r = parseEventReplay(draft());
    r.transcript.turns[0].speaker = '<img onerror=bad>';
    r.transcript.turns[0].paragraphs = ['<script>bad</script>'];
    const doc = new JSDOM(
      renderEventReplay(EVENTS[0], r, { search: '?t=20', origin: 'http://127.0.0.1:4186' }),
    ).window.document;
    expect(doc.querySelectorAll('h1')).toHaveLength(1);
    expect(doc.querySelectorAll('script')).toHaveLength(0);
    expect(doc.querySelector('.replay-speaker')?.textContent).toBe('<img onerror=bad>');
    expect(doc.querySelectorAll('.replay-turn')).toHaveLength(3);
    expect(doc.querySelector('iframe')?.src).toContain('start=20');
    expect(doc.querySelector('iframe')?.src).not.toContain('autoplay=1');
    expect(doc.querySelector('[data-replay-seek="20"]')?.getAttribute('href')).toBe('?t=20#watch');
    expect(doc.querySelector('[download]')).toBeNull();
  });
  it('does not fabricate video, attendance, transcript or timing when media is pending', () => {
    const doc = new JSDOM(renderEventReplay(EVENTS[0])).window.document;
    expect(doc.querySelector('iframe')).toBeNull();
    expect(doc.querySelectorAll('.replay-turn')).toHaveLength(0);
    expect(doc.body.textContent).toContain('being prepared');
    expect(doc.body.textContent).toContain('Also invited: Jared Gapinski');
  });
  it('accepts bounded numeric timestamps and carries origin to the privacy-enhanced embed', () => {
    for (const query of ['?t=-1', '?t=60', '?t=20s', '?t=Infinity', '?t=9999999999999999'])
      expect(replayStart(query, 60)).toBe(0);
    expect(replayStart('?t=20', 60)).toBe(20);
    expect(replayStart('?t=1.25', 60)).toBe(1.25);
    expect(replayTimestamp(7380)).toBe('2:03:00');
    expect(replayTimestamp(0)).toBe('0:00');
    expect(replayEmbedUrl('M7lc1UVf-VE', 20, 'http://127.0.0.1:4186')).toContain(
      'origin=http%3A%2F%2F127.0.0.1%3A4186',
    );
    expect(() => replayEmbedUrl('bad')).toThrow();
  });
  it('retains overlapping speakers and fractional timings without duplicate element IDs', () => {
    const r = parseEventReplay(draft());
    r.transcript.turns[0].start = 0.25;
    r.transcript.turns[1].start = 0.25;
    const doc = new JSDOM(renderEventReplay(EVENTS[0], r)).window.document;
    const ids = [...doc.querySelectorAll('[id]')].map((el) => el.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(doc.querySelectorAll('.replay-turn')).toHaveLength(3);
    expect(doc.querySelector('[data-replay-seek="0.25"]')).not.toBeNull();
    expect(doc.body.textContent).not.toContain('Open the published announcement');
  });
});
