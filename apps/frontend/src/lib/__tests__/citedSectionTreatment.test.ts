import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const SRC = join(__dirname, '..', '..');
const home = readFileSync(join(SRC, 'screens/redesign/HomeSignedOutScreen.tsx'), 'utf8');
const answer = readFileSync(join(SRC, 'screens/redesign/AskAnswerScreen.tsx'), 'utf8');
const citationCard = readFileSync(join(SRC, 'components/billDetail/CitationCard.tsx'), 'utf8');

describe('cited sections distinguish quoted statute without decorative rules', () => {
  it('removes the homepage cards numbered 1, 2, and 3', () => {
    expect(home).not.toContain('sectionCardNum');
    expect(home).not.toMatch(/<CitedSectionCard\s+n=/);
  });

  it('keeps Home and Answer quotes flush left with no decorative rule', () => {
    expect(home).not.toContain('borderLeftWidth: 3');
    expect(home).not.toContain('paddingLeft: 12');
    expect(citationCard).not.toContain('borderLeftWidth: 3');
    expect(citationCard).not.toContain('paddingLeft: 12');
    expect(answer).toContain('variant="answer"');
    expect(home).toContain('isMobile && styles.sectionCardQuoteTextMobile');
    expect(home).toContain('sectionCardQuoteTextMobile: { fontSize: 16, lineHeight: 24 }');
    expect(citationCard).toContain('isMobile && styles.quoteMobile');
    expect(citationCard).toContain('quoteMobile: { fontSize: 16, lineHeight: 24 }');
  });

  it('keeps each Answer chip close to its first quote and separates later quotes', () => {
    expect(citationCard).toContain('firstAnswerQuote: { marginTop: 8 }');
    expect(citationCard).toContain('followingAnswerQuote: { marginTop: 15 }');
    expect(citationCard).toContain('defaultQuote: { marginTop: 9 }');
  });

  it('separates the homepage gloss without indenting or italicizing it', () => {
    expect(home).toContain('sectionCardNote: {\n    marginTop: 10,');
    expect(home).not.toContain('paddingLeft: 15');
    expect(home).toContain("lineHeight: 20.3,\n    color: '#6f756f',");
  });
});
