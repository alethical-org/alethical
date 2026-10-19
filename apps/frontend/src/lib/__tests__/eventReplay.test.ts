import { describe, expect, it } from 'vitest';
import { JSDOM } from 'jsdom';
import fixture from './fixtures/eventReplay.json';
import suppliedTranscript from '../eventReplayData/forwardDebate2026.json';
import { forwardDebateReadingOmissions } from '../eventReplayData/forwardDebate2026ReadingEdition';
import { EVENTS } from '../events';
import { eventPageMetadata } from '../eventMetadata';
import { renderEventArticle, publishedEventMetadata } from '../eventArticle';
import { eventReplayBySlug } from '../eventReplayContent';
import type { EventReplay } from '../eventReplay';
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
  r.captions!.uploaded = true;
  r.video!.publishedAt = '2026-10-18T18:00:00Z';
  return r;
};

describe('replay content and publication boundaries', () => {
  it('omits video search details until actual publication facts exist', () => {
    expect(parseEventReplay(draft())).toEqual(fixture);
    expect(() => assertReplayReady(parseEventReplay(draft()))).toThrow('Publication needs');
    expect(JSON.stringify(replayPageMetadata(EVENTS[0], parseEventReplay(draft())))).not.toContain(
      'VideoObject',
    );
    expect(() => replayVideoSitemap(EVENTS[0], parseEventReplay(draft()))).toThrow();
  });
  it('rejects mismatched exports and malformed or impossible timed text', () => {
    const r = draft();
    r.captions.exportId = 'old-cut';
    expect(() => parseEventReplay(r)).toThrow('match');
    for (const start of [-1, 60, NaN]) {
      const r = draft();
      r.transcript!.turns[1].start = start;
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
    expect(metadata.structuredData?.[1]).toMatchObject({
      uploadDate: r.video!.publishedAt,
      duration: 'PT60S',
      hasPart: [
        { startOffset: 0, endOffset: 20 },
        { startOffset: 20, endOffset: 40 },
        { startOffset: 40, endOffset: 60 },
      ],
    });
    r.video!.publishedAt = '2099-01-01T00:00:00Z';
    expect(JSON.stringify(replayPageMetadata(EVENTS[0], r))).not.toContain('VideoObject');
  });
  it('uses the replay publication date without changing historical event dates', () => {
    const event = EVENTS[0];
    const replay = eventReplayBySlug(event.slug)!;
    expect(replay.publishedOn).toBe('2026-10-19');
    expect(replayPageMetadata(event, replay).article?.publishedOn).toBe('2026-10-19');
    expect(eventPageMetadata(event).article?.publishedOn).toBe('2026-10-07');
    expect(replayPageMetadata(event, replay).structuredData?.[0]).toHaveProperty(
      'startDate',
      event.startDate,
    );
    const document = new JSDOM(renderEventReplay(event, replay)).window.document;
    expect(document.querySelector('.event-published')?.textContent).toBe(
      'Published October 19, 2026',
    );
    expect(document.body.textContent).toContain('on October 15, 2026');
    expect(
      new JSDOM(
        renderEventReplay({ ...event, updatedOn: '2026-10-20' as typeof event.updatedOn }, replay),
      ).window.document.querySelector('.event-published')?.textContent,
    ).toBe('Published October 19, 2026 · Updated October 20, 2026');
    for (const publishedOn of ['2026-02-30', 'bad', '2026-10-19T12:00:00Z'])
      expect(() => parseEventReplay({ ...replay, publishedOn })).toThrow('valid date');
  });
  it('shows the approved invitation only for the enabled replay, between recording and topics', () => {
    const replay = eventReplayBySlug(EVENTS[0].slug)!;
    const document = new JSDOM(renderEventReplay(EVENTS[0], replay)).window.document;
    const invitation = document.querySelector('aside[aria-labelledby="community-debate"]')!;
    expect(invitation.querySelector('h2')?.textContent).toBe('Want a debate in your community?');
    expect(invitation.previousElementSibling?.querySelector('#watch')).not.toBeNull();
    expect(invitation.nextElementSibling?.querySelector('#topics')).not.toBeNull();
    const link = invitation.querySelector('a')!;
    expect(link.textContent).toBe('Contact Alethical');
    expect(link.href).toBe('https://www.alethical.com/about/contact?purpose=host-debate');
    expect(link.hasAttribute('target')).toBe(false);
    expect(invitation.querySelector('img')?.alt).toBe('');
    expect(invitation.querySelector('img')?.getAttribute('src')).toBe('/alethical-mark-green.png');
    for (const html of [
      renderEventReplay(EVENTS[0], ready()),
      renderEventReplay(EVENTS[0], replay, { example: true }),
    ])
      expect(new JSDOM(html).window.document.querySelector('.replay-invitation')).toBeNull();
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
  it('connects the final recording and uploaded captions with actual publication facts', () => {
    const replay = eventReplayBySlug(EVENTS[0].slug)!;
    expect(replay.video).toEqual({
      id: 'y66-Wf9bNio',
      exportId: 'forward-debate-2026-final-2026-10-19',
      publishedAt: '2026-10-19T11:13:45-07:00',
    });
    expect(replay.captions).toEqual({
      exportId: 'forward-debate-2026-final-2026-10-19',
      uploaded: true,
    });
    expect(
      new JSDOM(renderEventArticle(EVENTS[0])).window.document.querySelector('iframe')?.src,
    ).toContain('https://www.youtube-nocookie.com/embed/y66-Wf9bNio?');
    expect(publishedEventMetadata(EVENTS[0]).structuredData?.[1]).toMatchObject({
      '@type': 'VideoObject',
      uploadDate: '2026-10-19T11:13:45-07:00',
      duration: 'PT7401.85S',
      thumbnailUrl: ['https://www.alethical.com/forward-debate-2026-thumbnail.jpg'],
      hasPart: replay.chapters!.items.map((chapter, index, all) => ({
        startOffset: chapter.start,
        endOffset: all[index + 1]?.start ?? replay.duration,
        url: `https://www.alethical.com/blog/events/forward-debate-2026?t=${chapter.start}`,
      })),
    });
    expect(publishedEventMetadata(EVENTS[0]).title).toBe(
      'Trent Dilks & Aaron Brutger: The Forward Debate | Alethical',
    );
    expect(eventPageMetadata(EVENTS[0]).structuredData?.[0]).toHaveProperty('@type', 'Event');
    expect(JSON.stringify(eventPageMetadata(EVENTS[0]))).not.toContain('VideoObject');
  });
});

describe('replay HTML and shareable timestamps', () => {
  it('renders real text in the initial HTML and escapes speaker/title/body content', () => {
    const r = parseEventReplay(draft());
    r.transcript!.turns[0].speaker = '<img onerror=bad>';
    r.transcript!.turns[0].paragraphs = ['<script>bad</script>'];
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
  it('omits unavailable media and unfinished notices', () => {
    const content = eventReplayBySlug(EVENTS[0].slug)!;
    const doc = new JSDOM(
      renderEventReplay(EVENTS[0], { title: content.title, introduction: content.introduction }),
    ).window.document;
    expect(doc.querySelector('iframe')).toBeNull();
    expect(doc.querySelectorAll('.replay-turn')).toHaveLength(0);
    expect(doc.body.textContent).not.toMatch(/being prepared|not ready|will appear|PRIVATE DRAFT/i);
    expect(doc.querySelector('#watch,#topics,#transcript')).toBeNull();
    expect(doc.querySelector('h1')?.textContent).toBe('The Forward Debate');
    expect(doc.querySelector('.event-published')?.textContent).toBe(
      'Debate held October 15, 2026 · Updated October 19, 2026',
    );
    expect(doc.body.textContent).not.toContain('October 7, 2026');
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
    r.transcript!.turns[0].start = 0.25;
    r.transcript!.turns[1].start = 0.25;
    const doc = new JSDOM(renderEventReplay(EVENTS[0], r)).window.document;
    const ids = [...doc.querySelectorAll('[id]')].map((el) => el.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(doc.querySelectorAll('.replay-turn')).toHaveLength(3);
    expect(doc.querySelector('[data-replay-seek="0.25"]')).not.toBeNull();
    expect(doc.body.textContent).not.toContain('Open the published announcement');
  });
});

describe('independent media availability', () => {
  const published = eventReplayBySlug(EVENTS[0].slug)!;
  const base = { title: published.title, introduction: published.introduction };
  for (const parts of [
    [],
    ['video'],
    ['transcript'],
    ['chapters'],
    ['video', 'chapters'],
    ['transcript', 'chapters'],
    ['video', 'transcript', 'chapters'],
  ] as const) {
    it(`renders only supplied sections: ${parts.join(', ') || 'article'}`, () => {
      const full = ready();
      const content: EventReplay = { ...base, exportId: full.exportId, duration: full.duration };
      for (const part of parts) Object.assign(content, { [part]: full[part] });
      const doc = new JSDOM(renderEventReplay(EVENTS[0], content)).window.document;
      for (const [part, id] of [
        ['video', 'watch'],
        ['transcript', 'transcript'],
        ['chapters', 'topics'],
      ])
        expect(Boolean(doc.getElementById(id))).toBe((parts as readonly string[]).includes(part));
      expect(doc.body.textContent).not.toMatch(
        /being prepared|not ready|will appear|PRIVATE DRAFT/i,
      );
      expect(doc.querySelectorAll('h1')).toHaveLength(1);
      expect(doc.querySelectorAll('.event-downloads a')).toHaveLength(2);
      if (!(parts as readonly string[]).includes('video'))
        expect(doc.querySelector('[href*="#watch"]')).toBeNull();
      if ((parts as readonly string[]).includes('transcript')) {
        expect(doc.querySelectorAll('.replay-turn')).toHaveLength(3);
        expect(doc.body.textContent).toContain('Uncertain words and speakers are marked.');
      }
    });
  }
  it('retains marked uncertainty and fractional duration without a listening gate', () => {
    const content = ready();
    content.duration = 60.25;
    content.transcript!.turns[0].speaker = '[speaker uncertain]';
    content.transcript!.turns[0].paragraphs = ['The number was [unclear]'];
    expect(() => assertReplayReady(content)).not.toThrow();
    expect(renderEventReplay(EVENTS[0], content)).toContain('The number was [unclear]');
    expect(replayPageMetadata(EVENTS[0], content).structuredData?.[1]).toHaveProperty(
      'duration',
      'PT60.25S',
    );
  });
});

describe('accepted Forward Debate media edition', () => {
  it('preserves the accepted reading edition verbatim with matching video timestamps', () => {
    const replay = eventReplayBySlug(EVENTS[0].slug)!;
    const doc = new JSDOM(renderEventArticle(EVENTS[0])).window.document;
    expect(replay.duration).toBe(7401.85);
    const omitted = [
      269.96, 1370.7, 1943.24, 2048.76, 3989.62, 4941.38, 4943.26, 4954.62, 5749.32, 6252.32,
      6512.66, 6892.56,
    ];
    expect(forwardDebateReadingOmissions.map(({ start }) => start)).toEqual(omitted);
    expect(suppliedTranscript.turns).toHaveLength(100);
    expect(replay.transcript!.turns).toEqual(
      suppliedTranscript.turns.filter((turn) => !omitted.includes(turn.start)),
    );
    expect(doc.querySelector('#transcript')?.textContent).toBe('Edited transcript');
    expect(
      new JSDOM(renderEventReplay(EVENTS[0], ready())).window.document.querySelector('#transcript')
        ?.textContent,
    ).toBe('Full transcript');
    for (const start of omitted)
      expect(doc.querySelector(`[data-replay-seek="${start}"]`)).toBeNull();
    for (const start of [3954.78, 6769.98]) {
      const turn = suppliedTranscript.turns.find((turn) => turn.start === start)!;
      expect(replay.transcript!.turns.find((turn) => turn.start === start)).toEqual(turn);
      expect(doc.body.textContent).toContain(turn.paragraphs[0]);
    }
    expect(doc.querySelectorAll('.replay-turn')).toHaveLength(88);
    expect(doc.querySelectorAll('.replay-turn p')).toHaveLength(114);
    expect(doc.querySelectorAll('[aria-labelledby="transcript"] h3')).toHaveLength(28);
    expect(doc.querySelector('.replay-topics')?.tagName).toBe('OL');
    expect(doc.querySelector('.replay-topics')?.getAttribute('role')).toBe('list');
    expect(doc.querySelectorAll('.replay-topics a')).toHaveLength(28);
    for (const [index, a] of [...doc.querySelectorAll('.replay-topics a')].entries()) {
      const start = replay.chapters!.items[index].start;
      expect(a.getAttribute('data-replay-seek')).toBe(String(start));
      expect(a.getAttribute('href')).toBe(`?t=${start}#watch`);
    }
    expect(doc.body.textContent).toContain('Uncertain words and speakers are marked.');
    expect(
      [...doc.querySelectorAll('.replay-speaker')].filter(
        (s) => s.textContent === '[speaker uncertain]',
      ),
    ).toHaveLength(2);
    const closing = replay.transcript!.turns.find(
      (t) => t.speaker === 'Aaron Brutger' && t.start >= 6891,
    )!;
    expect(closing.paragraphs.join(' ')).toContain('for hosting, [unclear]');
    expect(doc.querySelectorAll('iframe')).toHaveLength(1);
    expect(doc.querySelector('iframe')?.src).not.toContain('autoplay=1');
    expect(doc.querySelectorAll('[data-replay-copy]')).toHaveLength(88);
    expect(doc.querySelector('[download]')).toBeNull();
    expect(JSON.stringify(publishedEventMetadata(EVENTS[0]))).toContain('VideoObject');
    expect(publishedEventMetadata(EVENTS[0]).socialImage?.url).toBe(
      'https://www.alethical.com/forward-debate-2026-thumbnail.jpg',
    );
  });
});
