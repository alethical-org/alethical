import {
  PUBLISHED_PIECE_INDEX,
  SHORT_POST_PAGE_SIZE,
  piecePath,
  topicFromSlug,
  type PieceIndexEntry,
  type TopicSlug,
} from './researchIndex';

export { SHORT_POST_PAGE_SIZE } from './researchIndex';

function identity(piece: PieceIndexEntry): string {
  return piece.articleId ?? piecePath(piece);
}

function unique<T extends PieceIndexEntry>(pieces: readonly T[]): T[] {
  const seen = new Set<string>();
  return pieces.filter((piece) => {
    const id = identity(piece);
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

/** Publication time is frozen; later checks and corrections do not affect this order. */
export function newestPublishedFirst<T extends PieceIndexEntry>(pieces: readonly T[]): T[] {
  return [...pieces].sort((left, right) => {
    const timeDifference =
      Date.parse(right.publishedAt ?? `${right.publishedOn}T00:00:00Z`) -
      Date.parse(left.publishedAt ?? `${left.publishedOn}T00:00:00Z`);
    return timeDifference || identity(left).localeCompare(identity(right));
  });
}

/** One entry appears in exactly one /read group. */
export function readGroups(pieces: readonly PieceIndexEntry[] = PUBLISHED_PIECE_INDEX) {
  const sorted = newestPublishedFirst(unique(pieces));
  return {
    research: sorted.filter((piece) => piece.format !== 'short-post' && piece.traits.research),
    shortPosts: sorted.filter((piece) => piece.format === 'short-post'),
    guides: sorted.filter(
      (piece) => piece.format !== 'short-post' && !piece.traits.research && piece.traits.guide,
    ),
  };
}

export function newestShortPosts(
  pieces: readonly PieceIndexEntry[] = PUBLISHED_PIECE_INDEX,
): PieceIndexEntry[] {
  return readGroups(pieces).shortPosts.slice(0, 3);
}

export interface PiecePage<T extends PieceIndexEntry> {
  items: T[];
  page: number;
  pageCount: number;
  total: number;
}

function pageOf<T extends PieceIndexEntry>(pieces: readonly T[], page: number): PiecePage<T> {
  if (!Number.isInteger(page) || page < 1) throw new Error('page must be a positive whole number');
  return {
    items: pieces.slice((page - 1) * SHORT_POST_PAGE_SIZE, page * SHORT_POST_PAGE_SIZE),
    page,
    pageCount: Math.ceil(pieces.length / SHORT_POST_PAGE_SIZE),
    total: pieces.length,
  };
}

export function shortPostsPage(
  page: number,
  pieces: readonly PieceIndexEntry[] = PUBLISHED_PIECE_INDEX,
): PiecePage<PieceIndexEntry> {
  return pageOf(readGroups(pieces).shortPosts, page);
}

/** Topic selection crosses Research, Guides, and Short posts without multiplying a piece. */
export function topicPage(
  topic: TopicSlug,
  page: number,
  pieces: readonly PieceIndexEntry[] = PUBLISHED_PIECE_INDEX,
): PiecePage<PieceIndexEntry> {
  if (!topicFromSlug(topic)) throw new Error('unknown topic');
  return pageOf(
    newestPublishedFirst(unique(pieces).filter((piece) => piece.topics?.includes(topic))),
    page,
  );
}

/** Relevant, already published neighbors; never the current article or a duplicate. */
export function relatedReading(
  current: PieceIndexEntry,
  pieces: readonly PieceIndexEntry[] = PUBLISHED_PIECE_INDEX,
  limit = 3,
): PieceIndexEntry[] {
  if (!Number.isInteger(limit) || limit < 0) throw new Error('related-reading limit is invalid');
  const topics = new Set(current.topics ?? []);
  return newestPublishedFirst(unique(pieces))
    .filter((piece) => identity(piece) !== identity(current))
    .map((piece) => ({
      piece,
      score: piece.topics?.filter((topic) => topics.has(topic)).length ?? 0,
    }))
    .filter(({ score }) => score > 0)
    .sort((left, right) => {
      if (left.score !== right.score) return right.score - left.score;
      return newestPublishedFirst([left.piece, right.piece])[0] === left.piece ? -1 : 1;
    })
    .slice(0, limit)
    .map(({ piece }) => piece);
}
