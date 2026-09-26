import {
  SHORT_POST_PRESENTATION_READY,
  topicFromSlug,
  type PieceIndexEntry,
} from './researchIndex';

/** Validate the address table at build time without sending checks to every reader. */
export function assertPublishedPieceIndex<T extends PieceIndexEntry>(
  pieces: T[],
  presentationReady = SHORT_POST_PRESENTATION_READY,
): T[] {
  const identities = new Set<string>();
  for (const piece of pieces) {
    if (piece.format !== 'short-post') continue;
    if (!presentationReady) throw new Error('Short post public presentation is not ready');
    if (!piece.articleId?.trim() || identities.has(piece.articleId)) {
      throw new Error(`Short post ${piece.slug} needs a unique stable identity`);
    }
    identities.add(piece.articleId);
    if (!piece.traits.research && !piece.traits.guide) {
      throw new Error(`Short post ${piece.slug} needs Research or Guide`);
    }
    if (
      !piece.publishedAt ||
      !/^\d{4}-\d{2}-\d{2}T.+(?:Z|[+-]\d{2}:\d{2})$/.test(piece.publishedAt) ||
      Number.isNaN(Date.parse(piece.publishedAt)) ||
      !piece.topics?.length
    ) {
      throw new Error(`Short post ${piece.slug} needs a publication timestamp and topics`);
    }
    if (
      new Set(piece.topics).size !== piece.topics.length ||
      piece.topics.some((topic) => !topicFromSlug(topic))
    ) {
      throw new Error(`Short post ${piece.slug} has an unknown topic`);
    }
  }
  return pieces;
}
