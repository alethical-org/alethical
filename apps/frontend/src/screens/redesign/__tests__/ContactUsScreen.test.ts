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
});
