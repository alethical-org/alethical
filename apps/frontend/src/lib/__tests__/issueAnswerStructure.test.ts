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

  it('closes with linked public sources and the real freshness value', () => {
    expect(answer).toContain('issueAnswerUpdatedLabel');
    expect(answer).toContain('<SourceLine updatedLabel={issueAnswerUpdatedLabel} />');
    expect(sourceLine).toContain('https://www.leg.mn.gov/');
    expect(sourceLine).toContain('https://www.revisor.mn.gov/');
    expect(sourceLine).toContain('externalLinkProps');
  });

  it('uses the standard follow-up heading and removes the repeated lead sentence', () => {
    expect(answer).toContain('Ask another question');
    expect(answer).not.toContain('Bills matching');
  });
});
