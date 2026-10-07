import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { PUBLISHED_PIECE_INDEX, piecePath } from '../researchIndex';
import { EVENT_INDEX } from '../eventsIndex';

describe('server comment eligibility', () => {
  it('covers every published editorial piece and no other address', () => {
    const manifest = JSON.parse(
      readFileSync(
        new URL('../../../../../alethical/data/editorial_articles.json', import.meta.url),
        'utf8',
      ),
    );
    const expected = [
      ...PUBLISHED_PIECE_INDEX.map((piece) => ({
        article_id: piece.articleId,
        title: piece.title,
        path: piecePath(piece),
      })),
      ...EVENT_INDEX.map((event) => ({
        article_id: event.articleId,
        title: event.title,
        path: `/blog/events/${event.slug}`,
      })),
    ].sort((a, b) => (a.article_id ?? '').localeCompare(b.article_id ?? ''));
    expect(expected.every((piece) => Boolean(piece.article_id))).toBe(true);
    expect(new Set(expected.map((piece) => piece.article_id)).size).toBe(expected.length);
    expect(manifest).toEqual(expected);
    expect(
      manifest.every((piece: { path: string }) =>
        /^\/blog\/(research|guides|events)\/[^/]+$/.test(piece.path),
      ),
    ).toBe(true);
  });
});
