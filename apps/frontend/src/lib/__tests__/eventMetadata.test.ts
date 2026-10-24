import { describe, expect, it } from 'vitest';
import { EVENTS } from '../events';
import { eventPageMetadata, eventsPageMetadata } from '../eventMetadata';
import { pageJsonLd, renderPageHead } from '../pageHead';
import { homePageMetadata } from '../share';

const event = EVENTS[0];
const before = Date.parse('2026-10-07T18:00:00-05:00');

describe('event search and share metadata', () => {
  it('identifies the announcement with its own canonical address and original flyer dimensions', () => {
    const head = renderPageHead(eventPageMetadata(event, before));
    expect(head).toContain(
      '<link rel="canonical" href="https://www.alethical.com/blog/events/forward-debate-2026"',
    );
    expect(head).toContain(`property="og:image" content="https://www.alethical.com${event.image}"`);
    expect(head).toContain('property="og:image:width" content="1080"');
    expect(head).toContain('property="og:image:height" content="1920"');
    expect(head).toContain('rel="preload" as="image"');
    expect(head).not.toContain('name="robots" content="noindex"');
  });

  it('gives search engines the same Central Time, venue and free signup as the announcement', () => {
    const [schema] = pageJsonLd(eventPageMetadata(event, before));
    expect(schema).toMatchObject({
      '@type': 'Event',
      name: 'The Forward Debate',
      startDate: '2026-10-15T18:00:00-05:00',
      endDate: '2026-10-15T20:00:00-05:00',
      isAccessibleForFree: true,
      location: {
        name: 'Riverside Terrace',
        address: {
          streetAddress: '195 River Ave S',
          addressLocality: 'Sauk Rapids',
          addressRegion: 'MN',
          postalCode: '56379',
          addressCountry: 'US',
        },
      },
      offers: { url: 'https://luma.com/3w69g6dw', price: 0, priceCurrency: 'USD' },
    });
    expect(schema).not.toHaveProperty('performer');
    expect(schema).not.toHaveProperty('sponsor');
    expect(schema).not.toHaveProperty('offers.availability');
  });

  it('keeps the past event findable without an active registration offer', () => {
    const meta = eventPageMetadata(event, Date.parse(event.endDate));
    expect(meta.noindex).toBe(false);
    expect(pageJsonLd(meta)[0]).not.toHaveProperty('offers');
    expect(pageJsonLd(meta)[0]).toHaveProperty('endDate', event.endDate);
    expect(pageJsonLd(eventsPageMetadata())).toEqual([]);
  });

  it('retains the default site image and home schema for existing pages', () => {
    const meta = homePageMetadata();
    expect(pageJsonLd(meta)).toHaveLength(2);
    expect(renderPageHead(meta)).toContain('property="og:image:width" content="1200"');
    expect(renderPageHead(meta)).toContain('property="og:image:height" content="630"');
  });
});
