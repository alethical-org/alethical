import { describe, expect, it } from 'vitest';
import {
  collectionPage,
  guideCollectionItems,
  researchReportItems,
} from '../readCollectionSelection';
import {
  WHO_HAS_TO_REPORT_THEIR_MONEY_INDEX_ENTRY,
  guideCollectionCount,
  type PieceIndexEntry,
} from '../researchIndex';

const guide = (
  slug: string,
  publishedOn: string,
  set?: { name: string; position: number },
): PieceIndexEntry => ({
  ...WHO_HAS_TO_REPORT_THEIR_MONEY_INDEX_ENTRY,
  slug,
  publishedOn,
  ...(set ? { set } : { set: undefined }),
});

describe('numbered reading collections', () => {
  it('counts a group as 1 item, never splitting its members across pages', () => {
    const entries = Array.from({ length: 9 }, (_, index) =>
      guide(`loose-${index}`, `2026-09-${String(27 - index).padStart(2, '0')}`),
    );
    entries.push(guide('set-first', '2026-09-17', { name: 'A set', position: 1 }));
    entries.push(guide('set-second', '2026-09-16', { name: 'A set', position: 2 }));
    entries.push(guide('last', '2026-09-15'));
    const items = guideCollectionItems(entries);
    expect(items).toHaveLength(11);
    expect(guideCollectionCount(entries)).toBe(items.length);
    expect(collectionPage(items, 1).items).toHaveLength(10);
    expect(collectionPage(items, 1).items[9]).toMatchObject({ kind: 'group', slug: 'a-set' });
    expect(collectionPage(items, 2).items).toHaveLength(1);
    expect(collectionPage(items, 2).pageCount).toBe(2);
  });

  it('orders a group by its newest member, keeping the group reading order', () => {
    const items = guideCollectionItems([
      guide('first', '2026-08-01', { name: 'A set', position: 1 }),
      guide('second', '2026-10-01', { name: 'A set', position: 2 }),
      guide('loose', '2026-09-01'),
    ]);
    expect(items[0]).toMatchObject({ kind: 'group', newestOn: '2026-10-01' });
    if (items[0].kind === 'group')
      expect(items[0].members.map((member) => member.slug)).toEqual(['first', 'second']);
  });

  it('keeps reports in their own collection', () => {
    expect(researchReportItems([guide('guide', '2026-09-01')])).toEqual([]);
  });
});
