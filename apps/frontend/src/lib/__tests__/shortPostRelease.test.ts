import { describe, expect, it } from 'vitest';
import { ORGANIZATIONS_BOTH_PARTIES } from '../researchPieces/organizationsBothParties';
import { LOBBYIST_GIVING } from '../researchPieces/lobbyistGiving';
import {
  shortPostPublicationErrors,
  shortPostArticleSnapshotBlocks,
  shortPostRecordsLine,
} from '../shortPosts';

describe('approved social-derived posts', () => {
  for (const piece of [ORGANIZATIONS_BOTH_PARTIES, LOBBYIST_GIVING]) {
    it(`publishes the checked content for ${piece.slug}`, () => {
      expect(shortPostPublicationErrors(piece)).toEqual([]);
    });
  }
  it('puts reviewed coverage in metadata and keeps material limits in the body', () => {
    for (const piece of [ORGANIZATIONS_BOTH_PARTIES, LOBBYIST_GIVING]) {
      const text = shortPostArticleSnapshotBlocks(piece)
        .map((block) => block.text)
        .join('\n');
      expect(shortPostRecordsLine(piece)).toBe(piece.shortPost!.coverageNote);
      expect(text).not.toContain(piece.shortPost!.coverageNote);
      expect(text.split(piece.shortPost!.limitations)).toHaveLength(2);
      expect(text.match(/Conclusion:/g)).toHaveLength(1);
      expect(text).not.toMatch(/\$[\d,]+\.\d/);
    }
  });
});
