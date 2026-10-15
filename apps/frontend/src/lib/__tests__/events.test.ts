import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { JSDOM } from 'jsdom';
import { EVENTS } from '../events';
import { renderEventArticle, renderEventList, renderEventsCollection } from '../eventMarkup';
import { LINK_ARROW_PATH, LINK_ARROW_SIZE } from '../linkArrowGeometry';

describe('accessible event announcement', () => {
  const event = EVENTS[0];
  it('opens the uncropped flyer and repeats important image details as real text', () => {
    const document = new JSDOM(renderEventArticle(event, Date.parse('2026-10-07'))).window.document;
    const flyer = document.querySelector('.event-flyer')!;
    expect(flyer.getAttribute('width')).toBe('1080');
    expect(flyer.getAttribute('height')).toBe('1920');
    expect(flyer.closest('a')?.getAttribute('href')).toBe(event.image);
    for (const text of [
      'Trent Dilks',
      'Aaron Brutger',
      'Republican-endorsed write-in candidate',
      'DFL-endorsed candidate',
      'Also invited: Jared Gapinski, Senate Republican primary winner.',
      'CEO and Founder of Alethical',
      'Alethical.com',
      'Alethical hosts its first debate',
      'Updated October 15, 2026',
      '195 River Ave S',
      '6–8 PM CDT',
      'Free admission',
      'Hear Minnesota Senate District 13 candidates discuss their views and priorities at Alethical’s first public debate.',
    ]) {
      expect(document.body.textContent).toContain(text);
    }
    expect(document.querySelector(`a[href="${event.signupUrl}"]`)?.textContent).toContain('RSVP');
    expect(document.body.textContent).not.toContain('AI helped prepare this article');
  });
  it('offers both supplied PDFs near the introduction, including after the event', () => {
    for (const now of [Date.parse('2026-10-15'), Date.parse(event.endDate)]) {
      const document = new JSDOM(renderEventArticle(event, now)).window.document;
      const links = document.querySelectorAll('.event-downloads a');
      expect(links).toHaveLength(2);
      event.downloads.forEach((file, index) => {
        expect(links[index].getAttribute('href')).toBe(file.href);
        expect(links[index].getAttribute('download')).toBe(file.filename);
        expect(links[index].textContent).toBe(`Download ${file.title} (PDF)`);
        const bytes = readFileSync(new URL(`../../../public${file.href}`, import.meta.url));
        expect(bytes.subarray(0, 5).toString()).toBe('%PDF-');
      });
      const html = document.body.innerHTML;
      expect(html.indexOf('event-downloads')).toBeLessThan(html.indexOf(event.introduction));
    }
  });
  it('keeps named return destinations separate from decorative chevrons', () => {
    for (const [markup, href, label] of [
      [renderEventArticle(event), '/blog/events', 'Back to Events'],
      [renderEventsCollection(), '/blog', 'Back to Blog'],
    ]) {
      const document = new JSDOM(markup).window.document;
      const link = document.querySelector('.event-back')!;
      expect(link.getAttribute('href')).toBe(href);
      expect(link.textContent).toBe(label);
      expect(link.querySelector('span')?.textContent).toBe(label);
      expect(link.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
      expect(link.querySelector('svg')?.getAttribute('focusable')).toBe('false');
    }
  });
  it('uses the shared destination arrow without adding it to the RSVP link name', () => {
    const document = new JSDOM(renderEventArticle(event, Date.parse('2026-10-15'))).window.document;
    const link = document.querySelector('.event-action')!;
    expect(link.getAttribute('href')).toBe(event.signupUrl);
    expect(link.textContent).toBe('RSVP for free on Luma');
    expect(link.querySelector('span')?.textContent).toBe('RSVP for free on Luma');
    expect(link.querySelector('svg')?.getAttribute('width')).toBe(String(LINK_ARROW_SIZE));
    expect(link.querySelector('path')?.getAttribute('d')).toBe(LINK_ARROW_PATH);
    expect(link.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
  });
  it('groups meaningful facts in both event list sizes and the article', () => {
    for (const markup of [
      renderEventList(),
      renderEventList(Date.now(), true),
      renderEventArticle(event),
    ]) {
      const document = new JSDOM(markup).window.document;
      const groups = [...document.querySelectorAll('.event-keep')].map((node) => node.textContent);
      expect(groups).toContain('October 15, 2026 ·');
      expect(groups).toContain('6–8 PM CDT');
      expect(groups).toContain('Free admission');
    }
    const document = new JSDOM(renderEventArticle(event)).window.document;
    expect([...document.querySelectorAll('.event-keep')].map((node) => node.textContent)).toContain(
      'Sauk Rapids, MN 56379',
    );
  });
  it('keeps publication labels with their dates', () => {
    const document = new JSDOM(renderEventArticle(event)).window.document;
    expect(
      [...document.querySelectorAll('.event-published > .event-keep')].map(
        (node) => node.textContent,
      ),
    ).toEqual(['Published October 7, 2026 ·', 'Updated October 15, 2026']);
  });
  it('keeps an expired announcement readable without inviting a late RSVP', () => {
    const document = new JSDOM(renderEventArticle(event, Date.parse(event.endDate))).window
      .document;
    expect(document.body.textContent).toContain('This event has ended');
    expect(document.body.textContent).not.toContain('RSVP for free');
    expect(document.body.textContent).not.toContain('you’re welcome to attend');
    expect(document.body.textContent).not.toContain('Join Alethical');
    expect(document.querySelector('.event-flyer')).not.toBeNull();
  });
});
