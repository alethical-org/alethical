import { piecePath, pieceShareDescription, type PieceIndexEntry } from './researchIndex';
import { clean, pageMetadata, titleFor, type PageMetadata } from './share';

/**
 * A posted piece keeps its claims and figures out of previews. An indexed piece
 * has one canonical address; a held piece remains readable but unlisted.
 * Search descriptions for Guides describe the subject while share previews
 * retain the title and dates.
 */
export function researchPageMetadata(
  piece: PieceIndexEntry,
  searchDescription?: string,
): PageMetadata {
  return pageMetadata({
    title: titleFor(piece.title),
    socialTitle: piece.title,
    description:
      (!piece.traits.research && clean(searchDescription ?? '')) || pieceShareDescription(piece),
    socialDescription: pieceShareDescription(piece),
    canonicalPath: piece.indexed ? piecePath(piece) : '',
    noindex: !piece.indexed,
    article: { publishedOn: piece.publishedOn },
  });
}
