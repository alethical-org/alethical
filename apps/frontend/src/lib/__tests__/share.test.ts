import { describe, expect, it, vi } from 'vitest';

import {
  buildAnswerShareContent,
  buildBillShareContent,
  buildLegislatorShareContent,
  publicPageUrl,
  shareDialogLabel,
  type ShareContent,
} from '../share';
import {
  buildShareIntents,
  BLUESKY_POST_LENGTH,
  complementaryShareDescription,
  nativeShareText,
  X_SHORT_LINK_LENGTH,
} from '../shareIntents';

describe('shared page text', () => {
  it.each([
    'bill',
    'legislator',
    'answer',
    'research',
    'guide',
    'committee',
    'principal',
    'lobbyist',
    'results',
  ] as const)('keeps a subject-specific accessible label for %s', (subject) => {
    expect(shareDialogLabel(subject)).toBe(
      subject === 'results' ? 'Share these results' : `Share this ${subject}`,
    );
  });

  it.each([
    ['search', 'Share these search results'],
    ['payments', 'Share these payment records'],
    ['race', 'Share this race comparison'],
    ['outside-spending', 'Share these outside-spending results'],
  ] as const)(
    'identifies %s results without adding the heading to shared text',
    (resultsKind, label) => {
      expect(shareDialogLabel('results', resultsKind)).toBe(label);
      const content: ShareContent = {
        subject: 'results',
        resultsKind,
        title: 'Selected records',
        description: 'Minnesota’s official filings',
        url: publicPageUrl('/money/search?q=schools&year=2026'),
      };
      const links = buildShareIntents(content);
      for (const intent of Object.values(links)) {
        expect(decodeURIComponent(intent)).not.toContain(label);
      }
      expect(nativeShareText(content, false)).toBe(`${content.title}\n\n${content.description}`);
      expect(nativeShareText(content, true)).toBe(
        `${content.title}\n\n${content.description}\n\n${content.url}`,
      );
    },
  );

  it('shares a bill identity once with complementary record context', () => {
    const content = buildBillShareContent({
      identifier: 'HF 719',
      billId: '94-2025-HF719',
      shortTitle: 'Funds local infrastructure projects across Minnesota',
      cardLine: 'Funds roads, bridges, water systems, and public buildings across Minnesota.',
      url: publicPageUrl('/bills/94-2025-HF719'),
    });

    // The sentence adds what the title does not (roads, bridges, water systems,
    // buildings), so the card carries it (Eugene, 18 Sep 2026).
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
      cardLine: null,
      url: publicPageUrl('/bills/94-2025-SF1'),
    });

    expect(content.description).toBe('Bill text, legislative progress, and official sources');
  });

  it('does not repeat a bill title through a summary that paraphrases it', () => {
    const content = buildBillShareContent({
      identifier: 'SF 746',
      billId: '94-2025-SF746',
      shortTitle: 'Peace Officers Must Be US Citizens',
      // The sentence restates the title, so `billDescriptionLines` hands the card
      // nothing and the fixed label stands (its own test covers that decision).
      cardLine: '',
      url: publicPageUrl('/bills/94-2025-SF746'),
    });

    expect(content.description).toBe('Bill text, legislative progress, and official sources');
  });

  // A bill with no plain-language short title is named by its number and year and
  // nothing else. The statutory title it used to fall back to is a paragraph of
  // legal cross-references — exactly what grounded-answers rule 10 keeps off the page.
  it('never falls back to a bill’s statutory title', () => {
    const content = buildBillShareContent({
      identifier: 'HF 2904',
      billId: '94-2025-HF2904',
      shortTitle: null,
      cardLine: null,
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
      description: 'Committee assignments, chief-authored bills, and contact information',
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

  it('describes the selected money view without repeating the legislator name', () => {
    const content = buildLegislatorShareContent({
      displayName: 'Rep. Aaron Repinski',
      districtLine: 'House District 26A',
      moneyYear: 2024,
      url: publicPageUrl('/legislators/aaron-repinski?tab=money&year=2024'),
    });
    expect(content.title).toBe('Rep. Aaron Repinski, Minnesota House District 26A');
    expect(content.description).toBe(
      'Campaign money for filing year 2024, from Minnesota’s official filings',
    );
    expect(new URL(buildShareIntents(content).email).searchParams.get('body')).toBe(
      `${content.description}\n\n${content.url}`,
    );
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

describe('complementary sharing copy', () => {
  it.each([
    'O’Brien & García',
    '  O’Brien   &  García  ',
    'O’BRIEN & GARCÍA!',
    "O'Brien & García.",
  ])('suppresses a whole-line repeat despite harmless formatting: %s', (description) => {
    const content: ShareContent = {
      subject: 'committee',
      title: 'O’Brien & García',
      description,
      url: publicPageUrl('/money/committees/example-123?year=2026&tab=gave#payments'),
    };
    expect(complementaryShareDescription(content.title, description)).toBe('');
    const links = buildShareIntents(content);
    expect(new URL(links.x).searchParams.get('text')).toBe(content.title);
    expect(new URL(links.x).searchParams.get('url')).toBe(content.url);
    for (const destination of ['whatsapp', 'bluesky'] as const) {
      expect(new URL(links[destination]).searchParams.get('text')).toBe(
        `${content.title}\n\n${content.url}`,
      );
    }
    const email = new URL(links.email);
    expect(email.searchParams.get('subject')).toBe(content.title);
    expect(email.searchParams.get('body')).toBe(content.url);
    expect(new URL(links.facebook).searchParams.get('u')).toBe(content.url);
    expect(new URL(links.linkedin).searchParams.get('url')).toBe(content.url);
    expect(nativeShareText(content, false)).toBe(content.title);
    expect(nativeShareText(content, true)).toBe(`${content.title}\n\n${content.url}`);
  });

  it.each([
    ['School funding', 'School funding does not include building repairs'],
    ['Committee 123', 'Committee 1234'],
    ['O’Brien', 'Donations filed under O’Brien are not a confirmed identity'],
    ['Published Aug 20, 2026', 'Records through Jul 20, 2026'],
  ])('preserves distinct factual copy: %s / %s', (title, description) => {
    expect(complementaryShareDescription(title, description)).toBe(description);
  });

  it('leaves an empty description out without adding blank prose', () => {
    const content: ShareContent = {
      subject: 'results',
      title: 'Search results',
      description: '  ',
      url: publicPageUrl('/bills?q=schools'),
    };
    expect(nativeShareText(content, false)).toBe(content.title);
    expect(new URL(buildShareIntents(content).email).searchParams.get('body')).toBe(content.url);
  });
});

describe('platform links', () => {
  const content: ShareContent = {
    subject: 'bill',
    title:
      'HF 719 (2025): A very long plain-language bill title that still needs room for useful context',
    description:
      'This intentionally long summary explains many parts of the bill so the X version must shorten the words before adding the link while email can keep the complete description for the reader.',
    url: publicPageUrl('/bills/94-2025-HF719'),
  };
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

  it('puts the title in the email subject once and complementary context in its body', () => {
    const email = new URL(intents.email);

    expect(email.searchParams.get('subject')).toBe(content.title);
    expect(email.searchParams.get('body')).toBe(`${content.description}\n\n${content.url}`);
    expect(email.searchParams.get('body')).not.toContain(content.title);
    expect(email.searchParams.get('body')).not.toContain('Shared from Alethical');
  });

  it('gives WhatsApp the complete prepared message without choosing a recipient', () => {
    const whatsapp = new URL(intents.whatsapp);

    expect(`${whatsapp.origin}${whatsapp.pathname}`).toBe('https://wa.me/');
    expect(whatsapp.searchParams.get('text')).toBe(
      `${content.title}\n\n${content.description}\n\n${content.url}`,
    );
    expect(whatsapp.searchParams.has('phone')).toBe(false);
  });

  it('gives Bluesky a bounded draft ending with the complete supplied URL', () => {
    const bluesky = new URL(intents.bluesky);
    const text = bluesky.searchParams.get('text') ?? '';
    const segments = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

    expect(`${bluesky.origin}${bluesky.pathname}`).toBe('https://bsky.app/intent/compose');
    expect(text.startsWith(content.title)).toBe(true);
    expect(text).toContain('This intentionally long summary');
    expect(text.endsWith(`\n\n${content.url}`)).toBe(true);
    expect(Array.from(segments.segment(text)).length).toBeLessThanOrEqual(BLUESKY_POST_LENGTH);
  });

  it('preserves punctuation, Unicode, and the exact year, tab, filters, and fragment', () => {
    const special: ShareContent = {
      subject: 'committee',
      title: 'O’Brien & García: “Schools + roads?” 👨‍👩‍👧‍👦',
      description: 'Compare café donations, 50% shares & the “gave” view.',
      url: publicPageUrl('/money/committees/example?year=2026&tab=gave&q=A%2BB%20%26%20C#payments'),
    };
    const links = buildShareIntents(special);

    for (const destination of ['whatsapp', 'bluesky'] as const) {
      const text = new URL(links[destination]).searchParams.get('text') ?? '';
      expect(text).toContain(special.title);
      expect(text).toContain(special.description);
      expect(text.endsWith(special.url)).toBe(true);
    }
    expect(new URL(links.x).searchParams.get('url')).toBe(special.url);
    expect(new URL(links.facebook).searchParams.get('u')).toBe(special.url);
    expect(new URL(links.linkedin).searchParams.get('url')).toBe(special.url);
    expect(new URL(links.email).searchParams.get('body')).toContain(special.url);
  });

  it('shortens long Unicode titles without splitting graphemes or losing the link', () => {
    const unicode = { ...content, title: '👨‍👩‍👧‍👦e\u0301'.repeat(180) };
    const text = new URL(buildShareIntents(unicode).bluesky).searchParams.get('text') ?? '';
    const segments = Array.from(
      new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text),
      (part) => part.segment,
    );
    const prose = text.slice(0, text.indexOf('\n\n'));

    expect(segments.length).toBeLessThanOrEqual(BLUESKY_POST_LENGTH);
    expect(new TextEncoder().encode(text).length).toBeLessThanOrEqual(3000);
    expect(prose).toMatch(/^(?:👨‍👩‍👧‍👦é)*(?:👨‍👩‍👧‍👦)?…$/u);
    expect(text.endsWith(unicode.url)).toBe(true);
  });

  it.each([297, 298, 299, 300, 500])(
    'keeps a %i-character URL intact when it leaves no room for useful Bluesky prose',
    (length) => {
      const base = publicPageUrl('/ask?q=');
      const longLink = { ...content, url: base + 'a'.repeat(length - base.length) };
      const links = buildShareIntents(longLink);

      expect(new URL(links.bluesky).searchParams.get('text')).toBe(longLink.url);
      expect(new URL(links.whatsapp).searchParams.get('text')).toBe(
        `${content.title}\n\n${content.description}\n\n${longLink.url}`,
      );
    },
  );

  it('falls back safely when a browser cannot count grapheme clusters', () => {
    const fallbackIntl = Object.create(Intl);
    fallbackIntl.Segmenter = undefined;
    vi.stubGlobal('Intl', fallbackIntl);
    try {
      const text =
        new URL(
          buildShareIntents({ ...content, title: '🦋'.repeat(500) }).bluesky,
        ).searchParams.get('text') ?? '';
      expect(Array.from(text).length).toBeLessThanOrEqual(BLUESKY_POST_LENGTH);
      expect(text.endsWith(content.url)).toBe(true);
      expect(text).not.toContain('\ufffd');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('keeps research dates in prepared text without substituting the shorter panel preview', () => {
    const research: ShareContent = {
      subject: 'research',
      title: 'The Money Only Goes One Way',
      description: 'Published Aug 20, 2026 · records through Jul 20, 2026.',
      previewDescription: 'Published Aug 20, 2026',
      url: publicPageUrl('/read/research/the-money-only-goes-one-way'),
    };
    const links = buildShareIntents(research);

    for (const destination of ['whatsapp', 'bluesky', 'x'] as const) {
      const text = new URL(links[destination]).searchParams.get('text') ?? '';
      expect(text).toContain(research.title);
      expect(text).toContain(research.description);
    }
    expect(new URL(links.email).searchParams.get('body')).toContain(research.description);
    expect(research.previewDescription).toBe('Published Aug 20, 2026');
  });

  it('has no direct Instagram destination', () => {
    expect(intents).not.toHaveProperty('instagram');
  });
});
