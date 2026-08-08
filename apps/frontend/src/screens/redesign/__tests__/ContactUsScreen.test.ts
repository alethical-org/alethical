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
    expect(SCREEN).toContain('Send another message');
  });

  it('uses the final success icon, wording, and responsive sizing', () => {
    const sentPanelStyle = SCREEN.match(/sentPanel: \{[\s\S]*?\n  \},/)?.[0] ?? '';
    const sentPanelMobileStyle = SCREEN.match(/sentPanelMobile: \{[^}]*\}/)?.[0] ?? '';

    expect(SCREEN).toContain('d="M5 12.5 L10 17.5 L19 7"');
    expect(SCREEN).toContain('stroke="#0f7a45"');
    expect(SCREEN).toContain('strokeWidth={2.4}');
    expect(SCREEN).toContain('width={isMobile ? 24 : 26}');
    expect(SCREEN).toContain('height={isMobile ? 24 : 26}');
    expect(SCREEN).toContain('On its way to ask@alethical.com');
    expect(SCREEN).not.toContain('<Text style={styles.sentMark}>✓</Text>');
    expect(SCREEN).not.toContain('It&apos;s on its way');
    expect(SCREEN).toContain('isMobile && styles.sentPanelMobile');
    expect(SCREEN).toContain('isMobile && styles.sentMarkMobile');
    expect(SCREEN).toContain('isMobile && styles.sentTitleMobile');
    expect(SCREEN).toContain('isMobile && styles.sentTextMobile');
    expect(SCREEN).toContain('isMobile && styles.secondaryButtonMobile');
    expect(sentPanelStyle).toContain('paddingVertical: 25');
    expect(sentPanelStyle).toContain('paddingHorizontal: 26');
    expect(sentPanelMobileStyle).toContain('paddingVertical: 22');
    expect(sentPanelMobileStyle).toContain('paddingHorizontal: 18');
  });

  it('puts the final linked failure message below the send button', () => {
    const buttonIndex = SCREEN.indexOf("state.status === 'sending' ? 'Sending…' : 'Send message'");
    const failureIndex = SCREEN.indexOf('Couldn&apos;t send.');
    const failureRowStyle = SCREEN.match(/failureRow: \{[\s\S]*?\n  \},/)?.[0] ?? '';
    const failureRowMobileStyle = SCREEN.match(/failureRowMobile: \{[^}]*\}/)?.[0] ?? '';

    expect(buttonIndex).toBeGreaterThan(-1);
    expect(failureIndex).toBeGreaterThan(buttonIndex);
    expect(SCREEN).toContain('Try again, or email');
    expect(SCREEN).toContain('function FailureEmailLink()');
    expect(SCREEN).toContain("const mailto = 'mailto:ask@alethical.com'");
    expect(SCREEN).toContain('isMobile && styles.failureRowMobile');
    expect(SCREEN).toContain('isMobile && styles.failureTextMobile');
    expect(failureRowStyle).toContain('marginTop: 18');
    expect(failureRowMobileStyle).toContain('marginTop: 16');
    expect(SCREEN).toContain('stroke="#a76a1a"');
    expect(SCREEN).toContain("color: '#11150f'");
    expect(SCREEN).toContain("color: '#4f5651'");
    expect(SCREEN).not.toContain('Nothing was lost');
    expect(SCREEN).not.toContain('We couldn&apos;t send that.');
  });

  it('keeps result panels and sidebar cards at natural height', () => {
    const sentPanelStyle = SCREEN.match(/sentPanel: \{[\s\S]*?\n  \},/)?.[0] ?? '';
    const sideColumnStyle = SCREEN.match(/sideColumn: \{[^}]*\}/)?.[0] ?? '';
    const infoCardStyle = SCREEN.match(/infoCard: \{[\s\S]*?\n  \},/)?.[0] ?? '';

    expect(sentPanelStyle).not.toMatch(/\bheight:/);
    expect(sentPanelStyle).not.toContain('flex: 1');
    expect(sideColumnStyle).not.toMatch(/\bheight:/);
    expect(sideColumnStyle).not.toContain('flex: 1');
    expect(infoCardStyle).not.toMatch(/\bheight:/);
    expect(infoCardStyle).not.toContain('flex: 1');
  });

  it('uses the accepted dark social marks and approved destinations', () => {
    expect(SCREEN).not.toContain('linkedin-round.png');
    expect(SCREEN).toContain('https://www.facebook.com/people/Alethical/61588261592240/');
    expect(SCREEN).toContain('https://www.linkedin.com/company/alethical');
    expect(SCREEN).toContain('https://x.com/alethical');
    expect(SCREEN).toMatch(
      /<Svg\s+width=\{24\}\s+height=\{24\}\s+viewBox="0 0 24 24"\s+fill=\{t\.colors\.ink\}\s+aria-hidden/,
    );
    expect(SCREEN).toMatch(
      /<Svg\s+width=\{22\}\s+height=\{22\}\s+viewBox="0\.87 2\.87 22 22"\s+fill=\{t\.colors\.ink\}\s+aria-hidden/,
    );
    expect(SCREEN).toMatch(
      /<Svg\s+width=\{21\}\s+height=\{21\}\s+viewBox="0 0 24 24"\s+fill=\{t\.colors\.ink\}\s+aria-hidden/,
    );
  });

  it('keeps the accepted Contact us spacing, phone action, and link treatments', () => {
    const cardEyebrowStyle = SCREEN.match(/cardEyebrow: \{[\s\S]*?\n  \},/)?.[0] ?? '';
    const emailLinkTextStyle = SCREEN.match(/emailLinkText: \{[\s\S]*?\n  \},/)?.[0] ?? '';

    expect(SCREEN).toContain("webFieldLabel: { lineHeight: '17px' } as any");
    expect(SCREEN).toContain('fieldGroup: { marginBottom: 18 }');
    expect(SCREEN).toContain('marginBottom: 8');
    expect(SCREEN).toContain('isMobile && styles.submitButtonMobile');
    expect(SCREEN).toContain("submitButtonMobile: { width: '100%', minHeight: 48 }");
    expect(cardEyebrowStyle).toContain('color: t.colors.text.secondary');
    expect(cardEyebrowStyle).toContain('fontSize: 10.5');
    expect(cardEyebrowStyle).toContain('letterSpacing: 1.26');
    expect(emailLinkTextStyle).not.toContain('textDecorationLine');
    expect(SCREEN).toContain("emailLinkTextActive: { textDecorationLine: 'underline' }");
  });
});
