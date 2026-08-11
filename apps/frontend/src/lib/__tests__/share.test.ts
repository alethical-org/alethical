import { describe, expect, it } from 'vitest';

import {
  buildAnswerShareContent,
  buildBillShareContent,
  buildLegislatorShareContent,
  buildShareIntents,
  publicPageUrl,
  X_SHORT_LINK_LENGTH,
} from '../share';

describe('shared page text', () => {
  it('shares a bill with its number, session year, plain title and first summary sentence', () => {
    const content = buildBillShareContent({
      identifier: 'HF 719',
      billId: '94-2025-HF719',
      shortTitle: 'Funds local infrastructure projects across Minnesota',
      summary:
        'Funds roads, bridges, water systems, and public buildings across Minnesota. It also sets reporting rules.',
      url: publicPageUrl('/bills/94-2025-HF719'),
    });

    expect(content).toEqual({
      subject: 'bill',
      title: 'HF 719 (2025): Funds local infrastructure projects across Minnesota',
      description: 'Funds roads, bridges, water systems, and public buildings across Minnesota.',
      url: 'https://www.alethical.com/bills/94-2025-HF719',
    });
  });

  it('uses an honest fallback when a bill has no generated summary', () => {
    const content = buildBillShareContent({
      identifier: 'SF 1',
      billId: '94-2025-SF1',
      shortTitle: 'Education funding',
      summary: null,
      url: publicPageUrl('/bills/94-2025-SF1'),
    });

    expect(content.description).toBe(
      'See what SF 1 would do and where it stands in the Minnesota Legislature.',
    );
  });

  // A bill with no plain-language short title is named by its number and year and
  // nothing else. The statutory title it used to fall back to is a paragraph of
  // legal cross-references — exactly what grounded-answers rule 10 keeps off the page.
  it('never falls back to a bill’s statutory title', () => {
    const content = buildBillShareContent({
      identifier: 'HF 2904',
      billId: '94-2025-HF2904',
      shortTitle: null,
      summary: null,
      url: publicPageUrl('/bills/94-2025-HF2904'),
    });

    expect(content.title).toBe('HF 2904 (2025)');
  });

  it('uses fixed factual context for legislator and Ask pages', () => {
    expect(
      buildLegislatorShareContent({
        displayName: 'Rep. Patti Anderson',
        districtLine: 'House District 33A',
        url: publicPageUrl('/legislators/patti-anderson'),
      }),
    ).toMatchObject({
      title: 'Rep. Patti Anderson, Minnesota House District 33A',
      description:
        'See Rep. Patti Anderson’s committee assignments, chief-authored bills, and contact information in the Minnesota Legislature.',
    });

    expect(
      buildAnswerShareContent({
        question: 'What would HF 719 fund?',
        url: publicPageUrl('/ask?q=What%20would%20HF%20719%20fund%3F'),
      }),
    ).toMatchObject({
      title: 'What would HF 719 fund?',
      description:
        'Read Alethical’s cited answer, with links to the Minnesota Legislature’s official record.',
    });
  });

  // The profile shows Biography, Committees, Chief-Authored Bills, Contact,
  // Legislative Service and Leadership. Votes appear only inside the unfinished
  // "On the roadmap" area, so promising them broke grounded-answers rule 6.
  it('does not promise recent votes on a legislator profile', () => {
    const content = buildLegislatorShareContent({
      displayName: 'Rep. Patti Anderson',
      districtLine: 'House District 33A',
      url: publicPageUrl('/legislators/patti-anderson'),
    });

    expect(content.description).not.toContain('votes');
  });
});

describe('platform links', () => {
  const content = buildBillShareContent({
    identifier: 'HF 719',
    billId: '94-2025-HF719',
    shortTitle: 'A very long plain-language bill title that still needs room for a useful summary',
    summary:
      'This intentionally long summary explains many parts of the bill so the X version must shorten the words before adding the link while email can keep the complete description for the reader.',
    url: publicPageUrl('/bills/94-2025-HF719'),
  });
  const intents = buildShareIntents(content);

  it('keeps X within 280 characters after its shortened link is counted', () => {
    const xUrl = new URL(intents.x);
    const text = xUrl.searchParams.get('text') ?? '';

    expect(text.length + 1 + X_SHORT_LINK_LENGTH).toBeLessThanOrEqual(280);
    expect(xUrl.searchParams.get('url')).toBe(content.url);
  });

  it('lets Facebook and LinkedIn build their card from the canonical URL', () => {
    expect(new URL(intents.facebook).searchParams.get('u')).toBe(content.url);
    expect(new URL(intents.linkedin).searchParams.get('url')).toBe(content.url);
    expect(intents.facebook).not.toContain('description');
    expect(intents.linkedin).not.toContain('summary');
  });

  it('gives email the full title, description, URL, and source', () => {
    const email = decodeURIComponent(intents.email);

    expect(email).toContain(content.title);
    expect(email).toContain(content.description);
    expect(email).toContain(content.url);
    expect(email).toContain('Shared from Alethical');
  });

  it('has no direct Instagram destination', () => {
    expect(intents).not.toHaveProperty('instagram');
  });
});
