import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const SRC = join(__dirname, '..', '..');
const home = readFileSync(join(SRC, 'screens/redesign/HomeSignedOutScreen.tsx'), 'utf8');
const answer = readFileSync(join(SRC, 'screens/redesign/AskAnswerScreen.tsx'), 'utf8');
const citationCard = readFileSync(join(SRC, 'components/billDetail/CitationCard.tsx'), 'utf8');
const tokens = readFileSync(join(SRC, 'theme/tokens.ts'), 'utf8');

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

  it('closes every Answer quote list with an indented reading gloss', () => {
    const gloss = 'Each quote is the opening of a longer section — open one to read it in full';
    expect(answer).toMatch(
      /<Text style={styles\.railGloss}>\s*Each quote is the opening of a longer section — open one to read it in full\s*<\/Text>/,
    );
    expect(answer.indexOf(gloss)).toBeGreaterThan(
      answer.indexOf('<View style={styles.railCards}>'),
    );
    expect(answer).toContain('railGloss: {\n    fontFamily: t.typography.body,\n    fontSize: 13,');
    expect(answer).toContain('lineHeight: 19.5,');
    expect(answer).toContain("color: '#6f756f',");
    expect(answer).toContain('marginTop: 14,\n    paddingLeft: t.spacing.underCardText,');
  });

  it('separates the homepage gloss without indenting or italicizing it', () => {
    expect(home).toContain('sectionCardNote: {\n    marginTop: 10,');
    expect(home).not.toContain('paddingLeft: 15');
    expect(home).toContain("lineHeight: 20.3,\n    color: '#6f756f',");
  });

  it('reuses the 17px under-card inset on trailing rows and footnotes', () => {
    expect(tokens).toContain('underCardText: 17,');
    expect(home).toContain('paddingLeft: t.spacing.underCardText,');
    expect(answer).toContain('paddingLeft: t.spacing.underCardText,');
  });
});
