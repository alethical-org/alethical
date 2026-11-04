import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { routePath } from '../../navigation/links';
import { citationSectionHref, phoneBillSection } from '../billText';

/**
 * Every shared Bill Text link says `?tab=text`: a summary citation's link and the
 * Ask answer page's "Bill text" link alike. The phone bill page names that
 * section `fulltext`, and read only its own names, so a phone visit to any of
 * those links opened on Summary instead of Bill Text (grounded-answers rule 5:
 * the location must be reachable by its URL).
 */

const SCREEN = readFileSync(
  join(__dirname, '..', '..', 'screens', 'redesign', 'BillDetailScreen.tsx'),
  'utf8',
);

/** The phone page's own section ids, read from its SECTIONS list. */
const PHONE_SECTIONS = [
  ...(SCREEN.match(/const SECTIONS = \[([\s\S]*?)\] as const;/)?.[1] ?? '').matchAll(
    /id: '([a-z]+)'/g,
  ),
].map((match) => match[1]);

const tabOf = (href: string) =>
  new URLSearchParams(href.slice(href.indexOf('?') + 1).split('#')[0]).get('tab');

describe('phone bill page opens Bill Text from a ?tab=text link', () => {
  it('reads the section list the phone page draws', () => {
    expect(PHONE_SECTIONS).toEqual(['summary', 'actions', 'votes', 'versions', 'fulltext']);
  });

  it('lands a citation link and the Ask answer link on Bill Text', () => {
    const citation = citationSectionHref('94-2026-HF4138', {
      sectionId: 'laws.0.2.0',
      sectionOrder: 2,
    })!;
    const ask = routePath.bill('94-2026-HF4138', { tab: 'text' });
    expect(tabOf(citation)).toBe('text');
    expect(tabOf(ask)).toBe('text');
    expect(phoneBillSection(tabOf(citation), PHONE_SECTIONS)).toBe('fulltext');
    expect(phoneBillSection(tabOf(ask), PHONE_SECTIONS)).toBe('fulltext');
  });

  it('keeps the phone page’s own names and ignores anything else', () => {
    for (const id of PHONE_SECTIONS) expect(phoneBillSection(id, PHONE_SECTIONS)).toBe(id);
    expect(phoneBillSection('nope', PHONE_SECTIONS)).toBeNull();
    expect(phoneBillSection(undefined, PHONE_SECTIONS)).toBeNull();
    expect(phoneBillSection(['text'], PHONE_SECTIONS)).toBeNull();
  });

  it('is how the phone page picks its first section', () => {
    expect(SCREEN).toMatch(/const initialTab = phoneBillSection\(\s*params\.tab,/);
  });
});
