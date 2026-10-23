import { piecePath, type PieceIndexEntry } from './researchIndex';
import { pieceShareDescription } from './articleDateLabels';
import { ORGANIZATION_REFERENCE } from './organizationIdentity';
import { clean, pageMetadata, publicPageUrl, titleFor, type PageMetadata } from './share';

/**
 * A posted piece keeps its claims and figures out of previews. An indexed piece
 * has one canonical address; a held piece remains readable but unlisted.
 * An explicit search description names the subject; Research also keeps its
 * dates. Share previews retain the title and dates.
 */
export function researchPageMetadata(
  piece: PieceIndexEntry & { authorLine?: string },
  searchDescription?: string,
): PageMetadata {
  const subject = clean(searchDescription ?? '');
  const dates = pieceShareDescription(piece);
  return pageMetadata({
    title: titleFor(piece.title),
    socialTitle: piece.title,
    description: subject ? (piece.traits.research ? `${subject} ${dates}` : subject) : dates,
    socialDescription: dates,
    canonicalPath: piece.indexed ? piecePath(piece) : '',
    noindex: !piece.indexed,
    article: { publishedOn: piece.publishedOn },
    structuredData: piece.indexed
      ? [
          {
            '@context': 'https://schema.org',
            '@type': 'Article',
            '@id': `${publicPageUrl(piecePath(piece))}#article`,
            headline: piece.title,
            url: publicPageUrl(piecePath(piece)),
            mainEntityOfPage: publicPageUrl(piecePath(piece)),
            datePublished: piece.publishedOn,
            publisher: ORGANIZATION_REFERENCE,
            // Grounded-answers rule 13.8 deliberately omits a byline for pieces
            // published in Alethical's own name. Keep unknown attribution absent.
            ...(piece.authorLine?.trim().toUpperCase() === 'ALETHICAL'
              ? { author: ORGANIZATION_REFERENCE }
              : {}),
          },
        ]
      : [],
  });
}
