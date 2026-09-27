import { describe, expect, it } from 'vitest';
import { articleOpeningSection } from '../articleOpeningSection';
import { articleReturnDestination, articleHrefWithReturn } from '../articleReturn';
import { safeArticleReturnPath } from '../articleReturnSafety';
import { renderPageSnapshot, researchPageSnapshot, shortPostPageSnapshot } from '../pageSnapshot';
import { MONEY_ONLY_GOES_ONE_WAY } from '../researchPieces/moneyOnlyGoesOneWay';
import { WHO_HAS_TO_REPORT_THEIR_MONEY } from '../researchPieces/whoHasToReportTheirMoney';
import { LOBBYIST_GIVING } from '../researchPieces/lobbyistGiving';

it('does not carry the old article’s section into a new article', () => {
  const next = '/read/guides/what-the-records-name';
  expect(
    articleOpeningSection('/read/guides/who-has-to-report-their-money', next, '#next', ['next']),
  ).toBeNull();
  expect(articleOpeningSection(next, next, '', ['next'])).toBeNull();
  expect(articleOpeningSection(next, next, '#next', ['next'])).toBe('next');
});

it('keeps a published local list as the return link in a new tab', () => {
  const source = '/read/sets/how-the-money-works?post=who-has-to-report-their-money';
  expect(safeArticleReturnPath(source)).toBe('/read/sets/how-the-money-works');
  expect(articleReturnDestination(source)).toEqual({
    href: source,
    label: 'Back to How the Money Works',
  });
  expect(articleHrefWithReturn('/read/guides/who-has-to-report-their-money', source)).toBe(
    `/read/guides/who-has-to-report-their-money?from=${encodeURIComponent(source)}`,
  );
  for (const unsafe of [
    'https://elsewhere.test/',
    '//elsewhere.test/',
    '/read/sets/not-published',
    '/read#next',
  ]) {
    expect(safeArticleReturnPath(unsafe)).toBeNull();
  }
});

describe('first HTML correction contact', () => {
  for (const piece of [MONEY_ONLY_GOES_ONE_WAY, WHO_HAS_TO_REPORT_THEIR_MONEY, LOBBYIST_GIVING]) {
    it(`links Contact us within the closing note of ${piece.slug}`, () => {
      const snapshot =
        piece.format === 'short-post' ? shortPostPageSnapshot(piece) : researchPageSnapshot(piece);
      const html = renderPageSnapshot(snapshot);
      expect(html).toContain(
        `href="/about/contact?article=${encodeURIComponent(piece.articleId ?? piece.slug)}">Contact us</a>`,
      );
      expect(html).toContain('AI helped prepare this article and can make mistakes.');
    });
  }
});
