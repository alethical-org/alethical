import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SCREEN = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '..', 'ContactUsScreen.tsx'),
  'utf8',
);

describe('Contact us screen contract', () => {
  it('renders all 5 real labelled fields without placeholders or autofocus', () => {
    expect(SCREEN).toContain('<TextInput');
    expect(SCREEN).toContain('CONTACT_FIELD_ORDER.map');
    expect(SCREEN).toContain('name: field');
    expect(SCREEN).toContain('YOUR NAME');
    expect(SCREEN).toContain('EMAIL ADDRESS');
    expect(SCREEN).toContain('PHONE');
    expect(SCREEN).toContain('SUBJECT');
    expect(SCREEN).toContain('MESSAGE');
    expect(SCREEN).not.toContain('placeholder=');
    expect(SCREEN).not.toContain('autoFocus');
  });

  it('keeps accessible error, sending, sent, and failure announcements', () => {
    expect(SCREEN).toContain('aria-describedby');
    expect(SCREEN).toContain('accessibilityRole="alert"');
    expect(SCREEN).toContain("role: 'status'");
    expect(SCREEN).toContain('Nothing was lost');
    expect(SCREEN).toContain('Send another message');
  });

  it('ships the supplied LinkedIn image and the approved social destinations', () => {
    expect(SCREEN).toContain("require('../../../assets/linkedin-round.png')");
    expect(SCREEN).toContain('https://www.facebook.com/people/Alethical/61588261592240/');
    expect(SCREEN).toContain('https://www.linkedin.com/company/alethical');
    expect(SCREEN).toContain('https://x.com/alethical');
  });

  it('keeps the accepted Contact us spacing, phone action, and link treatments', () => {
    const cardEyebrowStyle = SCREEN.match(/cardEyebrow: \{[\s\S]*?\n  \},/)?.[0] ?? '';
    const emailLinkTextStyle = SCREEN.match(/emailLinkText: \{[\s\S]*?\n  \},/)?.[0] ?? '';

    expect(SCREEN).toContain("webFieldLabel: { lineHeight: '17px' } as any");
    expect(SCREEN).toContain('fieldGroup: { marginBottom: 18 }');
    expect(SCREEN).toContain('marginBottom: 8');
    expect(SCREEN).toContain('isMobile && styles.submitButtonMobile');
    expect(SCREEN).toContain("submitButtonMobile: { width: '100%', minHeight: 48 }");
    expect(SCREEN).toContain('width={34}');
    expect(SCREEN).toContain('width={24}');
    expect(SCREEN).toContain('socialImage: { width: 38, height: 38');
    expect(cardEyebrowStyle).toContain('color: t.colors.text.secondary');
    expect(cardEyebrowStyle).toContain('fontSize: 10.5');
    expect(cardEyebrowStyle).toContain('letterSpacing: 1.26');
    expect(emailLinkTextStyle).not.toContain('textDecorationLine');
    expect(SCREEN).toContain("emailLinkTextActive: { textDecorationLine: 'underline' }");
  });
});
