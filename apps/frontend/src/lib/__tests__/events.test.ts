import { describe, expect, it } from 'vitest';
import { JSDOM } from 'jsdom';
import { PUBLISHED_EVENTS } from '../events';
import { renderEventArticle } from '../eventMarkup';

describe('accessible event announcement', () => {
  const event = PUBLISHED_EVENTS[0];
  it('opens the uncropped flyer and repeats important image details as real text', () => {
    const document = new JSDOM(renderEventArticle(event, Date.parse('2026-10-07'))).window.document;
    const flyer = document.querySelector('.event-flyer')!;
    expect(flyer.getAttribute('width')).toBe('1080');
    expect(flyer.getAttribute('height')).toBe('1920');
    expect(flyer.closest('a')?.getAttribute('href')).toBe(event.image);
    for (const text of [
      'Trent Dilks',
      'Aaron Brutger',
      'Republican primary candidate',
      '195 River Ave S',
      '6–8 PM Central',
      'Free admission',
      'no pre-approved questions',
    ]) {
      expect(document.body.textContent).toContain(text);
    }
    expect(document.querySelector(`a[href="${event.signupUrl}"]`)?.textContent).toContain('RSVP');
    expect(document.body.textContent).not.toContain('AI helped prepare this article');
  });
  it('keeps an expired announcement readable without inviting a late RSVP', () => {
    const document = new JSDOM(renderEventArticle(event, Date.parse(event.endDate))).window
      .document;
    expect(document.body.textContent).toContain('This event has ended');
    expect(document.body.textContent).not.toContain('RSVP for free');
    expect(document.querySelector('.event-flyer')).not.toBeNull();
  });
});
