import { describe, expect, it } from 'vitest';
import { targetFromPathname } from '../../navigation/webRoutes';
import {
  PUBLISHED_PIECE_INDEX,
  assertPublishedPieceIndex,
  pieceIndexBySlug,
  piecePath,
  type PieceIndexEntry,
} from '../researchIndex';
import { PUBLISHED_RESEARCH, type ResearchPiece } from '../research';
import { chartDescription } from '../shortPostCalculations';
import {
  assertPublishedShortPosts,
  calculatedRun,
  CONTRIBUTION_NOTE,
  SHORT_POST_AI_NOTE,
  shortPostFingerprint,
  shortPostPublicationErrors,
  type ShortPostGraphic,
} from '../shortPosts';
import {
  newestPublishedFirst,
  newestShortPosts,
  readGroups,
  relatedReading,
  shortPostsPage,
  topicPage,
} from '../shortPostSelection';

const period = { from: '2025-01-01', through: '2025-12-31', label: '2025 filings' };

function readyPiece(): ResearchPiece {
  const input: ShortPostGraphic['input'] = {
    kind: 'parts',
    total: { value: 100, unit: 'USD', period },
    parts: [{ value: 40, unit: 'USD', period, label: 'Example recipients' }],
    remainderLabel: 'Other recipients',
  };
  const graphic: ShortPostGraphic = {
    id: 'shares',
    claimIds: ['share-claim'],
    input,
    altDescription: chartDescription(input),
  };
  const piece: ResearchPiece = {
    articleId: 'short-example-001',
    format: 'short-post',
    topics: ['campaign-finance'],
    slug: 'example-short-piece',
    traits: { research: true, guide: false },
    indexed: true,
    title: 'Example short piece',
    publishedOn: '2026-09-25',
    publishedAt: '2026-09-25T14:30:00Z',
    recordsThrough: '2025-12-31',
    searchDescription: 'An example about campaign contributions.',
    dek: 'Example text used only by tests.',
    authorLine: 'ALETHICAL',
    filingBodies: ['Example official source'],
    shortVersion: [
      {
        kind: 'paragraph',
        runs: [
          { kind: 'text', text: 'The checked example share is ' },
          calculatedRun(graphic, 'part-percent', 'percent', 'Example recipients'),
          { kind: 'text', text: ' of the stated total.' },
        ],
      },
    ],
    sections: [],
    sources: [],
    sourceRuns: [
      [{ kind: 'externalLink', text: 'Official example', href: 'https://example.gov/filings' }],
    ],
    shortPost: {
      origin: 'social-adaptation',
      evidence: [
        {
          id: 'filing',
          title: 'Official example',
          url: 'https://example.gov/filings',
          kind: 'official-source',
          period,
          method: 'Sum the named 2025 rows.',
          limitations: 'The example covers 2025 only.',
          version: '2025 final file',
        },
      ],
      claims: [
        {
          id: 'share-claim',
          claim: '40 of 100 example dollars',
          evidenceIds: ['filing'],
          checkedScope: 'All rows in the example 2025 file',
          method: 'Compare the total and recipient rows.',
          finding: 'The source and calculation agree in this test fixture.',
          status: 'supported',
          checkedBy: 'Editor',
          checkedAt: '2026-09-24T12:00:00Z',
        },
      ],
      graphics: [graphic],
      limitations: 'Only the example 2025 file is covered.',
      coverageNote: 'Records through 2025-12-31; extracted later.',
      disclosures: [SHORT_POST_AI_NOTE, CONTRIBUTION_NOTE],
      history: [],
      review: {
        editorialApprovedBy: 'Editor',
        editorialApprovedAt: '2026-09-24T13:00:00Z',
        eugeneApprovedFingerprint: '',
        eugeneReviewedAt: '2026-09-24T14:00:00Z',
        publicationInstructionAt: '2026-09-24T15:00:00Z',
      },
    },
  };
  piece.shortPost!.review.eugeneApprovedFingerprint = shortPostFingerprint(piece);
  return piece;
}

describe('social-derived Short post publication gate', () => {
  it('accepts complete checked material without changing older published pieces', () => {
    const piece = readyPiece();
    expect(shortPostPublicationErrors(piece)).toEqual([]);
    expect(assertPublishedShortPosts([...PUBLISHED_RESEARCH, piece])).toContain(piece);
    expect(assertPublishedShortPosts(PUBLISHED_RESEARCH)).toBe(PUBLISHED_RESEARCH);
  });

  it('blocks missing coverage, evidence, method, source checks, and approvals', () => {
    const piece = readyPiece();
    piece.shortPost!.evidence[0].period = { ...piece.shortPost!.evidence[0].period, through: '' };
    piece.shortPost!.evidence[0].method = '';
    piece.shortPost!.claims[0].status = 'unresolved';
    piece.shortPost!.review.editorialApprovedBy = '';
    expect(shortPostPublicationErrors(piece).join(' ')).toMatch(
      /reporting period|covered reporting period/,
    );
    expect(shortPostPublicationErrors(piece).join(' ')).toContain('method');
    expect(shortPostPublicationErrors(piece).join(' ')).toContain('unresolved');
    expect(shortPostPublicationErrors(piece).join(' ')).toContain('editorial approval');
    expect(() => assertPublishedShortPosts([piece])).toThrow('Cannot publish');
  });

  it('requires chart text and diagram geometry to share the checked inputs', () => {
    const piece = readyPiece();
    const paragraph = piece.shortVersion[0];
    if (paragraph.kind !== 'paragraph') throw new Error('fixture changed');
    const number = paragraph.runs[1];
    if (number.kind !== 'calculated') throw new Error('fixture changed');
    number.text = '99%';
    expect(shortPostPublicationErrors(piece)).toContain('body number differs from graphic shares');
    number.text = '40%';
    piece.shortPost!.graphics[0].input = {
      kind: 'parts',
      total: { value: 30, unit: 'USD', period },
      parts: [{ value: 40, unit: 'USD', period, label: 'Example recipients' }],
      remainderLabel: 'Other recipients',
    };
    expect(shortPostPublicationErrors(piece).join(' ')).toContain('parts exceed their total');
  });

  it('invalidates review when the title, source, or numbers change afterwards', () => {
    const piece = readyPiece();
    piece.title = 'A revised title';
    expect(shortPostPublicationErrors(piece)).toContain(
      'article or graphic inputs changed after Eugene review',
    );
  });

  it('requires an article-specific publication instruction after Eugene saw the complete piece', () => {
    const piece = readyPiece();
    piece.shortPost!.review.publicationInstructionAt = '';
    expect(shortPostPublicationErrors(piece)).toContain(
      'article-specific publication instruction is missing',
    );
  });

  it('keeps publication timing and search visibility honest', () => {
    const piece = readyPiece();
    piece.publishedAt = '2026-09-24T14:30:00Z';
    piece.indexed = false;
    expect(shortPostPublicationErrors(piece)).toContain(
      'publication date differs from its timestamp',
    );
    expect(shortPostPublicationErrors(piece)).toContain(
      'Short posts must be visible to search on publication',
    );
    piece.publishedAt = '2026-09-25T14:30:00Z';
    piece.shortPost!.review.publicationInstructionAt = '2026-09-26T15:00:00Z';
    expect(shortPostPublicationErrors(piece)).toContain(
      'article-specific publication instruction is missing',
    );
  });

  it('refuses Short post checks hidden behind a missing format field', () => {
    const piece = readyPiece();
    piece.format = undefined;
    expect(() => assertPublishedShortPosts([piece])).toThrow('format is missing');
  });

  it('keeps an unregistered draft out of the public address, search index, and sitemap source', () => {
    const draft = readyPiece();
    draft.shortPost!.claims[0].status = 'unresolved';
    expect(() => assertPublishedShortPosts([draft])).toThrow();
    expect(PUBLISHED_RESEARCH).not.toContain(draft);
    expect(pieceIndexBySlug(draft.slug)).toBeUndefined();
    expect(targetFromPathname(piecePath(draft))).toEqual({
      kind: 'notFound',
      path: piecePath(draft),
    });
    expect(PUBLISHED_PIECE_INDEX.map((piece) => piece.slug)).not.toContain(draft.slug);
  });

  it('refuses a light address-table entry with no stable identity or publication time', () => {
    const piece = readyPiece();
    expect(() => assertPublishedPieceIndex([{ ...piece, articleId: undefined }])).toThrow(
      'identity',
    );
    expect(() => assertPublishedPieceIndex([{ ...piece, publishedAt: undefined }])).toThrow(
      'timestamp',
    );
  });
});

function indexPiece(
  id: string,
  publishedAt: string,
  overrides: Partial<PieceIndexEntry> = {},
): PieceIndexEntry {
  return {
    articleId: id,
    slug: id,
    title: id,
    traits: { research: true, guide: false },
    indexed: true,
    publishedOn: '2026-09-25',
    recordsThrough: '2025-12-31',
    publishedAt,
    format: 'short-post',
    topics: ['lobbying'],
    ...overrides,
  };
}

describe('Short post and topic selection', () => {
  const pieces = Array.from({ length: 8 }, (_, index) =>
    indexPiece(`short-${index}`, `2026-09-25T${String(index).padStart(2, '0')}:00:00Z`),
  );

  it('orders by frozen publication time and uses stable identity for ties', () => {
    const tied = [indexPiece('b', '2026-09-25T10:00:00Z'), indexPiece('a', '2026-09-25T10:00:00Z')];
    expect(newestPublishedFirst(tied).map((piece) => piece.articleId)).toEqual(['a', 'b']);
    const checked = { ...tied[0], checkedOn: '2027-01-01', title: 'Edited title' };
    expect(newestPublishedFirst([checked, tied[1]]).map((piece) => piece.articleId)).toEqual([
      'a',
      'b',
    ]);
    expect(piecePath(checked)).toBe(piecePath(tied[0]));
  });

  it('pages 6 at a time and shows the newest 3 on /read', () => {
    expect(shortPostsPage(1, pieces).items.map((piece) => piece.slug)).toEqual([
      'short-7',
      'short-6',
      'short-5',
      'short-4',
      'short-3',
      'short-2',
    ]);
    expect(shortPostsPage(2, pieces).items.map((piece) => piece.slug)).toEqual([
      'short-1',
      'short-0',
    ]);
    expect(shortPostsPage(3, pieces).items).toEqual([]);
    expect(shortPostsPage(1, pieces).pageCount).toBe(2);
    expect(newestShortPosts(pieces).map((piece) => piece.slug)).toEqual([
      'short-7',
      'short-6',
      'short-5',
    ]);
    expect(() => shortPostsPage(0, pieces)).toThrow();
  });

  it('keeps a Short post out of long-form groups, even when it carries both traits', () => {
    const both = indexPiece('both', '2026-09-25T20:00:00Z', {
      traits: { research: true, guide: true },
    });
    const guide = indexPiece('guide', '2026-09-24T00:00:00Z', {
      format: undefined,
      traits: { research: false, guide: true },
    });
    const groups = readGroups([both, both, guide]);
    expect(groups.shortPosts).toEqual([both]);
    expect(groups.research).toEqual([]);
    expect(groups.guides).toEqual([guide]);
  });

  it('selects published writing across formats by topic and removes duplicate identities', () => {
    const guide = indexPiece('guide', '2026-09-24T00:00:00Z', {
      format: undefined,
      traits: { research: false, guide: true },
      topics: ['lobbying'],
    });
    expect(
      topicPage('lobbying', 1, [pieces[0], pieces[0], guide]).items.map((piece) => piece.articleId),
    ).toEqual(['short-0', 'guide']);
    expect(
      relatedReading(pieces[0], [pieces[0], pieces[1], pieces[1], guide]).map(
        (piece) => piece.articleId,
      ),
    ).toEqual(['short-1', 'guide']);
    expect(
      relatedReading(pieces[0], [
        indexPiece('unrelated', '2026-09-25T22:00:00Z', { topics: ['elections'] }),
      ]),
    ).toEqual([]);
  });

  it('selects the existing public Research and Guides for their controlled topics', () => {
    const campaign = topicPage('campaign-finance', 1);
    expect(campaign.total).toBe(PUBLISHED_PIECE_INDEX.length);
    expect(newestShortPosts()).toEqual([]);
    expect(readGroups().shortPosts).toEqual([]);
    expect(() => topicPage('unknown' as 'lobbying', 1)).toThrow('unknown topic');
  });
});
