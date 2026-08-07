import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const web = readFileSync(join(__dirname, '..', 'LegislatorProfileWebScreen.tsx'), 'utf8');
const mobile = readFileSync(join(__dirname, '..', 'LegislatorProfileMobileScreen.tsx'), 'utf8');

describe('Legislator Profile roadmap actions', () => {
  it.each([
    ['web', web],
    ['mobile', mobile],
  ])('shows the claim action as a non-clickable preview on %s', (_name, source) => {
    expect(source).toContain('<span aria-disabled={true} style={claimPreviewStyle}>');
    expect(source).toContain('<Text style={styles.claimBtnText}>Claim this profile</Text>');
    expect(source).toContain('backgroundColor: t.colors.tint.t150');
    expect(source).toContain('border: `1px solid ${t.colors.tint.border}`');
    expect(source).toContain('color: t.colors.brand.deep');
    expect(source).toContain("cursor: 'default'");
    expect(source).not.toContain('claimOpen');
    expect(source).not.toContain('Claim profile sheet');
    expect(source).not.toContain('function ClaimModal');
  });

  it.each([
    ['web', web],
    ['mobile', mobile],
  ])('keeps Ask on preset questions only on %s', (_name, source) => {
    expect(source).toContain('Answers cite the public record');
    expect(source).not.toContain('No account needed — answers cite the public record');
    expect(source).not.toContain('<TextInput');
    expect(source).not.toContain('accessibilityLabel="Ask"');
  });

  it.each([
    ['web', web],
    ['mobile', mobile],
  ])('shows committee leadership only when a role exists on %s', (_name, source) => {
    expect(source).toContain('{role ? (');
    expect(source).toContain('{role.toUpperCase()}');
    expect(source).toContain('paddingHorizontal: 10');
    expect(source).toContain('fontSize: 10');
    expect(source).toContain('letterSpacing: 0.9');
  });

  it.each([
    ['web', web],
    ['mobile', mobile],
  ])('asks the vote question directly on %s', (_name, source) => {
    expect(source).toContain('Wonder why {');
    expect(source).not.toContain('See a roll call and wonder why');
  });
});
