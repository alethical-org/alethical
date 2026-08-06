import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const SRC = join(__dirname, '..', '..');
const home = readFileSync(join(SRC, 'screens/redesign/HomeSignedOutScreen.tsx'), 'utf8');
const answer = readFileSync(join(SRC, 'screens/redesign/AskAnswerScreen.tsx'), 'utf8');
const citationCard = readFileSync(join(SRC, 'components/billDetail/CitationCard.tsx'), 'utf8');
const tokens = readFileSync(join(SRC, 'theme/tokens.ts'), 'utf8');

describe('cited sections use one visual accent for each source relationship', () => {
  it('removes the homepage cards numbered 1, 2, and 3', () => {
    expect(home).not.toContain('sectionCardNum');
    expect(home).not.toMatch(/<CitedSectionCard\s+n=/);
  });

  it('uses the same 3px light-purple rule on Home and Answer', () => {
    expect(tokens).toContain("purpleQuoteRule: '#bda6ee'");
    expect(home).toContain('borderLeftWidth: 3');
    expect(home).toContain('borderLeftColor: t.colors.purple.quoteRule');
    expect(citationCard).toContain('borderLeftWidth: 3');
    expect(citationCard).toContain('answerQuote: { borderLeftColor: t.colors.purple.quoteRule }');
    expect(answer).toContain('variant="answer"');
  });

  it('keeps each Answer chip close to its first quote and separates later quotes', () => {
    expect(citationCard).toContain('firstAnswerQuote: { marginTop: 8 }');
    expect(citationCard).toContain('followingAnswerQuote: { marginTop: 15 }');
    expect(citationCard).toContain(
      'defaultQuote: { marginTop: 9, borderLeftColor: t.colors.tint.border }',
    );
  });
});
