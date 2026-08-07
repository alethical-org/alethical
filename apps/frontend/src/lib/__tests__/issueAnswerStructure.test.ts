import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const SRC = join(__dirname, '..', '..');
const answer = readFileSync(join(SRC, 'screens/redesign/AskAnswerScreen.tsx'), 'utf8');
const card = readFileSync(join(SRC, 'components/search/BillResultCard.tsx'), 'utf8');
const searchPieces = readFileSync(join(SRC, 'components/search/searchPieces.tsx'), 'utf8');
const sourceLine = readFileSync(join(SRC, 'components/billDetail/SourceLine.tsx'), 'utf8');

describe('issue answer page structure', () => {
  it('uses full shared cards and removes the matched issue from each card', () => {
    expect(answer).toContain('variant="issueAnswer"');
    expect(answer).toContain('excludedPolicyArea={answer.topic}');
    expect(card).toContain('accessibilityLabel={`Open ${bill.identifier}`}');
    expect(card).toContain('styles.cardOverlay');
    expect(card).toContain('styles.cardOverlayIssueAnswerMobile');
    expect(card).not.toContain('View bill →');
  });

  it('uses the 2-choice sort with the required click catcher and no-wrap label', () => {
    expect(answer).toContain('ISSUE_ANSWER_SORT_OPTIONS');
    expect(searchPieces).toContain('styles.sortClickCatcher');
    expect(searchPieces).toContain("whiteSpace: 'nowrap'");
  });

  it('uses the total and served date in the Search-style count row', () => {
    expect(answer).toContain('count={answer.totalMatches}');
    expect(answer).toContain('dataAsOf={answer.dataAsOf}');
    expect(answer).toContain('>matching</Text>');
    expect(answer).not.toContain('of {answer.totalMatches} matching');
  });

  it('closes with linked public sources without repeating the header date', () => {
    expect(answer).toContain('<SourceLine updatedLabel="" />');
    expect(sourceLine).toContain('https://www.leg.mn.gov/');
    expect(sourceLine).toContain('https://www.revisor.mn.gov/');
    expect(sourceLine).toContain('externalLinkProps');
  });

  it('only offers Search when more matching bills exist than are rendered', () => {
    expect(answer).toContain('issueAnswerHasMore(answer.totalMatches, shownIssueBills.length)');
    expect(answer).toContain('See all {issueTopic} bills in Search →');
    expect(answer).not.toContain('See all {answer.totalMatches}');
  });

  it('uses the standard follow-up heading and removes the repeated lead sentence', () => {
    expect(answer).toContain('Ask another question');
    expect(answer.match(/accessibilityRole="header"\s+aria-level=\{2\}/g)).toHaveLength(2);
    expect(answer).not.toContain('Bills matching');
  });
});
