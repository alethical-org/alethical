import { describe, expect, it } from 'vitest';

import {
  buildAnswerShareContent,
  buildBillShareContent,
  buildLegislatorShareContent,
  buildShareIntents,
  publicPageUrl,
  renderSocialPreviewHtml,
  X_SHORT_LINK_LENGTH,
} from '../share';

describe('shared page text', () => {
  it('shares a bill with its plain title and first summary sentence', () => {
    const content = buildBillShareContent({
      identifier: 'HF 719',
      title: 'Funds local infrastructure projects across Minnesota',
      summary:
        'Funds roads, bridges, water systems, and public buildings across Minnesota. It also sets reporting rules.',
      url: publicPageUrl('/bills/94-2025-HF719'),
    });

    expect(content).toEqual({
      subject: 'bill',
      title: 'HF 719: Funds local infrastructure projects across Minnesota',
      description: 'Funds roads, bridges, water systems, and public buildings across Minnesota.',
      url: 'https://www.alethical.com/bills/94-2025-HF719',
    });
  });

  it('uses an honest fallback when a bill has no generated summary', () => {
    const content = buildBillShareContent({
      identifier: 'SF 1',
      title: 'Education funding',
      summary: null,
      url: publicPageUrl('/bills/94-2025-SF1'),
    });

    expect(content.description).toBe(
      'See what SF 1 would do and where it stands in the Minnesota Legislature.',
    );
  });

  it('uses fixed factual context for legislator and Ask pages', () => {
    expect(
      buildLegislatorShareContent({
        displayName: 'Rep. Patti Anderson',
        partyLabel: 'Republican',
        districtLine: 'House District 33A',
        url: publicPageUrl('/legislators/patti-anderson'),
      }),
    ).toMatchObject({
      title: 'Rep. Patti Anderson: Republican, House District 33A',
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
});

describe('platform links', () => {
  const content = buildBillShareContent({
    identifier: 'HF 719',
    title: 'A very long plain-language bill title that still needs room for a useful summary',
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

describe('social preview HTML', () => {
  it('publishes escaped page data for link preview crawlers', () => {
    const html = renderSocialPreviewHtml({
      subject: 'answer',
      title: 'What does <HF 1> do?',
      description: 'Read the cited answer & official sources.',
      url: 'https://www.alethical.com/ask?q=HF%201',
    });

    expect(html).toContain('property="og:title" content="What does &lt;HF 1&gt; do?"');
    expect(html).toContain(
      'property="og:description" content="Read the cited answer &amp; official sources."',
    );
    expect(html).toContain('property="og:url" content="https://www.alethical.com/ask?q=HF%201"');
    expect(html).toContain('property="og:image"');
    expect(html).toContain('name="twitter:card" content="summary_large_image"');
    expect(html).not.toContain('<HF 1>');
  });
});
