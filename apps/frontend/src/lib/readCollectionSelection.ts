import {
  PUBLISHED_PIECE_INDEX,
  READING_COLLECTION_PAGE_SIZE,
  guideIndexEntries,
  guideSetSlug,
  type PieceIndexEntry,
  type TopicSlug,
} from './researchIndex';

export { READING_COLLECTION_PAGE_SIZE } from './researchIndex';
export type GuideCollectionItem =
  | {
      kind: 'group';
      slug: string;
      name: string;
      members: PieceIndexEntry[];
      newestOn: string;
      sharedTopics: TopicSlug[];
    }
  | { kind: 'piece'; piece: PieceIndexEntry; newestOn: string };

/** The lightweight listing index decides grouping and counts before article text loads. */
export function researchReportItems(
  entries: readonly PieceIndexEntry[] = PUBLISHED_PIECE_INDEX,
): PieceIndexEntry[] {
  return entries
    .filter((piece) => piece.traits.research && piece.format !== 'short-post')
    .sort((a, b) => b.publishedOn.localeCompare(a.publishedOn) || a.slug.localeCompare(b.slug));
}

export function guideCollectionItems(
  entries: readonly PieceIndexEntry[] = PUBLISHED_PIECE_INDEX,
): GuideCollectionItem[] {
  const guides = guideIndexEntries(entries);
  const grouped = new Map<string, PieceIndexEntry[]>();
  const items: GuideCollectionItem[] = [];
  for (const piece of guides) {
    if (!piece.set) {
      items.push({ kind: 'piece', piece, newestOn: piece.publishedOn });
      continue;
    }
    grouped.set(piece.set.name, [...(grouped.get(piece.set.name) ?? []), piece]);
  }
  for (const [name, members] of grouped) {
    members.sort((a, b) => a.set!.position - b.set!.position);
    items.push({
      kind: 'group',
      name,
      slug: guideSetSlug(name),
      members,
      newestOn: members.reduce(
        (latest, piece) => (piece.publishedOn > latest ? piece.publishedOn : latest),
        '',
      ),
      sharedTopics: (members[0]?.topics ?? []).filter((topic) =>
        members.every((piece) => piece.topics?.includes(topic)),
      ),
    });
  }
  return items.sort(
    (a, b) =>
      b.newestOn.localeCompare(a.newestOn) ||
      (a.kind === 'group' ? a.slug : a.piece.slug).localeCompare(
        b.kind === 'group' ? b.slug : b.piece.slug,
      ),
  );
}

export function collectionPage<T>(
  items: readonly T[],
  page: number,
  perPage = READING_COLLECTION_PAGE_SIZE,
) {
  return {
    items: items.slice((page - 1) * perPage, page * perPage),
    pageCount: Math.max(1, Math.ceil(items.length / perPage)),
  };
}
