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
    const related = piece.relatedSlugs ?? [];
    if (related.length > 3 || new Set(related).size !== related.length) {
      throw new Error(`Related reading for ${piece.slug} needs at most 3 distinct pieces`);
    }
    for (const slug of related) {
      const destination = pieces.find((entry) => entry.slug === slug);
      if (
        !destination ||
        slug === piece.slug ||
        !destination.topics?.some((topic) => piece.topics?.includes(topic)) ||
        (piece.set &&
          destination.set?.name === piece.set.name &&
          destination.set.position === piece.set.position + 1)
      ) {
        throw new Error(
          `Related reading for ${piece.slug} needs another published piece sharing a topic, not its next guide`,
        );
      }
    }
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
