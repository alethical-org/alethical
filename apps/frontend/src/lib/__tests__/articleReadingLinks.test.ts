import { describe, expect, it } from 'vitest';
import { articleOpeningSection } from '../articleOpeningSection';
import { articleReturnDestination, articleHrefWithReturn } from '../articleReturn';
import { safeArticleReturnPath } from '../articleReturnSafety';
import { renderPageSnapshot, researchPageSnapshot, shortPostPageSnapshot } from '../pageSnapshot';
import { MONEY_ONLY_GOES_ONE_WAY } from '../researchPieces/moneyOnlyGoesOneWay';
import { WHO_HAS_TO_REPORT_THEIR_MONEY } from '../researchPieces/whoHasToReportTheirMoney';
import { LOBBYIST_GIVING } from '../researchPieces/lobbyistGiving';
import { ORGANIZATIONS_BOTH_PARTIES } from '../researchPieces/organizationsBothParties';
import { PUBLISHED_RESEARCH, type ResearchPiece, type ResearchInline } from '../research';
import { PUBLISHED_PIECE_INDEX, piecePath } from '../researchIndex';
import { assertPublishedPieceIndex } from '../researchIndexValidation';
import {
  shortPostFingerprint,
  shortPostOriginalContentFingerprint,
  shortPostPublicationErrors,
} from '../shortPosts';

it('does not carry the old article’s section into a new article', () => {
  const next = '/read/guides/what-the-records-name';
  expect(
    articleOpeningSection('/read/guides/who-has-to-report-their-money', next, '#next', ['next']),
  ).toBeNull();
  expect(articleOpeningSection(next, next, '', ['next'])).toBeNull();
  expect(articleOpeningSection(next, next, '#next', ['next'])).toBe('next');
});

it('keeps a published local list as the return link in a new tab', () => {
  const source = '/read/sets/how-the-money-works?post=who-has-to-report-their-money';
  expect(safeArticleReturnPath(source)).toBe('/read/sets/how-the-money-works');
  expect(articleReturnDestination(source)).toEqual({
    href: source,
    label: 'Back to How the Money Works',
  });
  expect(articleHrefWithReturn('/read/guides/who-has-to-report-their-money', source)).toBe(
    `/read/guides/who-has-to-report-their-money?from=${encodeURIComponent(source)}`,
  );
  for (const unsafe of [
    'https://elsewhere.test/',
    '//elsewhere.test/',
    '/read/sets/not-published',
    '/read#next',
  ]) {
    expect(safeArticleReturnPath(unsafe)).toBeNull();
  }
});

describe('first HTML correction contact', () => {
  for (const piece of [MONEY_ONLY_GOES_ONE_WAY, WHO_HAS_TO_REPORT_THEIR_MONEY, LOBBYIST_GIVING]) {
    it(`links Contact us within the closing note of ${piece.slug}`, () => {
      const snapshot =
        piece.format === 'short-post' ? shortPostPageSnapshot(piece) : researchPageSnapshot(piece);
      const html = renderPageSnapshot(snapshot);
      expect(html).toContain(
        `href="/about/contact?article=${encodeURIComponent(piece.articleId ?? piece.slug)}">Contact us</a>`,
      );
      expect(html).toContain('AI helped prepare this article and can make mistakes.');
    });
  }
});

const approvedRelated: Record<string, string[]> = {
  'the-money-only-goes-one-way': [
    'why-nobody-can-follow-a-dollar',
    '2-records-not-always-2-donations',
  ],
  'lobbyist-giving': ['organizations-both-parties', 'why-2-official-numbers-can-both-be-right'],
  'organizations-both-parties': ['lobbyist-giving', 'why-nobody-can-follow-a-dollar'],
  '2-records-not-always-2-donations': ['lobbyist-giving', 'organizations-both-parties'],
  'who-has-to-report-their-money': ['organizations-both-parties', 'lobbyist-giving'],
  'what-the-records-name': ['2-records-not-always-2-donations', 'organizations-both-parties'],
  'why-2-official-numbers-can-both-be-right': [
    '2-records-not-always-2-donations',
    'lobbyist-giving',
  ],
  'money-spent-without-a-campaigns-say': ['the-money-only-goes-one-way', 'lobbyist-giving'],
  'why-nobody-can-follow-a-dollar': ['organizations-both-parties', 'the-money-only-goes-one-way'],
};

const approvedInline = [
  [
    'the-money-only-goes-one-way',
    'campaign accounts for state office',
    '/read/guides/who-has-to-report-their-money',
  ],
  ['the-money-only-goes-one-way', 'only the named donations', '/read/guides/what-the-records-name'],
  [
    'the-money-only-goes-one-way',
    'independent expenditures',
    '/read/guides/money-spent-without-a-campaigns-say',
  ],
  ['lobbyist-giving', 'candidate committees', '/read/guides/who-has-to-report-their-money'],
  [
    'lobbyist-giving',
    'Some download entries repeat reported information',
    '/read/research/2-records-not-always-2-donations',
  ],
  [
    'organizations-both-parties',
    'political committee and fund',
    '/read/guides/who-has-to-report-their-money',
  ],
  [
    '2-records-not-always-2-donations',
    'checked against filings',
    '/read/guides/why-2-official-numbers-can-both-be-right',
  ],
] as const;

function bodyRuns(piece: ResearchPiece): ResearchInline[] {
  const blocks = piece.shortPost?.body ?? [
    ...piece.shortVersion,
    ...(piece.intro ?? []),
    ...piece.sections.flatMap((section) => section.blocks),
  ];
  return blocks.flatMap((block) =>
    block.kind === 'paragraph' ? block.runs : block.kind === 'bullets' ? block.items.flat() : [],
  );
}

describe('approved article reading links', () => {
  it('keeps the exact 7 existing-word links in the article and first HTML', () => {
    expect(approvedInline).toHaveLength(7);
    for (const [slug, text, href] of approvedInline) {
      const piece = PUBLISHED_RESEARCH.find((entry) => entry.slug === slug)!;
      expect(bodyRuns(piece)).toContainEqual({ kind: 'internalLink', text, href });
      const destination = PUBLISHED_RESEARCH.find((entry) => piecePath(entry) === href);
      expect(destination).toBeDefined();
      const html = renderPageSnapshot(
        piece.format === 'short-post' ? shortPostPageSnapshot(piece) : researchPageSnapshot(piece),
      );
      expect(html).toContain(`<a href="${href}">${text}</a>`);
    }
  });

  it('keeps 2 distinct, published, on-topic related picks on all 9 pages and in first HTML', () => {
    expect(Object.keys(approvedRelated)).toHaveLength(9);
    for (const piece of PUBLISHED_RESEARCH) {
      const picks = piece.relatedSlugs ?? piece.shortPost?.relatedSlugs ?? [];
      expect(picks).toEqual(approvedRelated[piece.slug]);
      expect(new Set(picks).size).toBe(2);
      const html = renderPageSnapshot(
        piece.format === 'short-post' ? shortPostPageSnapshot(piece) : researchPageSnapshot(piece),
      );
      expect(html).toContain('Related reading');
      for (const slug of picks) {
        const destination = PUBLISHED_RESEARCH.find((entry) => entry.slug === slug)!;
        expect(destination).toBeDefined();
        expect(destination.slug).not.toBe(piece.slug);
        expect(destination.topics?.some((topic) => piece.topics?.includes(topic))).toBe(true);
        expect(html).toContain(`<a href="${piecePath(destination)}">${destination.title}</a>`);
      }
    }
  });

  it('rejects missing, repeated, self, and next-guide selections in the published index', () => {
    expect(assertPublishedPieceIndex(PUBLISHED_PIECE_INDEX)).toBe(PUBLISHED_PIECE_INDEX);
    for (const picks of [
      ['never-published'],
      ['the-money-only-goes-one-way'],
      ['lobbyist-giving', 'lobbyist-giving'],
    ]) {
      const changed = PUBLISHED_PIECE_INDEX.map((entry) =>
        entry.slug === 'the-money-only-goes-one-way' ? { ...entry, relatedSlugs: picks } : entry,
      );
      expect(() => assertPublishedPieceIndex(changed)).toThrow('Related reading');
    }
    const changedGuide = PUBLISHED_PIECE_INDEX.map((entry) =>
      entry.slug === 'who-has-to-report-their-money'
        ? { ...entry, relatedSlugs: ['what-the-records-name'] }
        : entry,
    );
    expect(() => assertPublishedPieceIndex(changedGuide)).toThrow('Related reading');
  });

  it('keeps the original human-reviewed content and never mutates it while checking links', () => {
    for (const original of PUBLISHED_RESEARCH.filter((piece) => piece.format === 'short-post')) {
      const piece = structuredClone(original);
      const before = JSON.stringify(piece);
      expect(shortPostOriginalContentFingerprint(piece)).toBe(
        piece.shortPost!.review.eugeneApprovedFingerprint,
      );
      expect(shortPostPublicationErrors(piece)).toEqual([]);
      expect(shortPostPublicationErrors(piece)).toEqual([]);
      expect(JSON.stringify(piece)).toBe(before);
      expect(shortPostFingerprint(piece)).toBe(
        piece.shortPost!.review.navigationRevision?.approvedNavigationFingerprint,
      );
    }
  });

  it('rejects changed prose, source addresses, figures, and link destinations after approval', () => {
    const rejectsEvenWithNewNavigationFingerprint = (piece: ResearchPiece) => {
      piece.shortPost!.review.navigationRevision!.approvedNavigationFingerprint =
        shortPostFingerprint(piece);
      expect(shortPostPublicationErrors(piece)).toContain(
        'link-only revision changed previously reviewed article content',
      );
    };
    const original = LOBBYIST_GIVING;
    const changedProse = structuredClone(original);
    const first = changedProse.shortPost!.body![0];
    if (first.kind !== 'paragraph') throw new Error('expected opening paragraph');
    first.runs[0].text += ' Changed.';
    rejectsEvenWithNewNavigationFingerprint(changedProse);

    const changedSource = structuredClone(original);
    const source = changedSource.sourceRuns![0][0];
    if (source.kind !== 'externalLink') throw new Error('expected source link');
    source.href = 'https://example.invalid/';
    rejectsEvenWithNewNavigationFingerprint(changedSource);

    const changedFormatting = structuredClone(original);
    const formattedOpening = changedFormatting.shortPost!.body![0];
    if (formattedOpening.kind !== 'paragraph') throw new Error('expected opening paragraph');
    formattedOpening.runs[0] = { kind: 'bold', text: formattedOpening.runs[0].text };
    rejectsEvenWithNewNavigationFingerprint(changedFormatting);

    const changedFigure = structuredClone(ORGANIZATIONS_BOTH_PARTIES);
    const graphic = changedFigure.shortPost!.graphics[0];
    if (graphic.input.kind !== 'overlap') throw new Error('expected overlap graphic');
    graphic.input.left.value += 1;
    rejectsEvenWithNewNavigationFingerprint(changedFigure);

    const changedLink = structuredClone(original);
    const opening = changedLink.shortPost!.body![0];
    if (opening.kind !== 'paragraph') throw new Error('expected opening paragraph');
    const link = opening.runs.find((run) => run.kind === 'internalLink');
    if (!link || link.kind !== 'internalLink') throw new Error('expected new link');
    link.href = '/read/guides/what-the-records-name';
    rejectsEvenWithNewNavigationFingerprint(changedLink);

    const changedRelatedOrder = structuredClone(original);
    changedRelatedOrder.shortPost!.relatedSlugs = [
      ...changedRelatedOrder.shortPost!.relatedSlugs!,
    ].reverse();
    rejectsEvenWithNewNavigationFingerprint(changedRelatedOrder);
  });
});
