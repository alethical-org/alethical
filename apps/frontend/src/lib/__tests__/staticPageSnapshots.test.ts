import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import {
  ABOUT_BELIEFS,
  ABOUT_BELIEFS_HEADING,
  ABOUT_CONTACT_LINK,
  ABOUT_CONTACT_HEADING,
  ABOUT_CORRECTION_PROMISE,
  ABOUT_EMAIL,
  ABOUT_FEEDBACK_LABEL,
  ABOUT_PAGE_HEADING,
  ABOUT_PAGE_SUBTITLE,
  ABOUT_START_ITEMS,
  ABOUT_START_HEADING,
  ABOUT_WHY_HEADING,
  ABOUT_WHY_LINES,
  aboutPageSnapshot,
} from '../aboutUs';
import {
  CONTACT_EMAIL,
  CONTACT_PAGE_HEADING,
  CONTACT_PAGE_SUBTITLE,
  CONTACT_SOCIALS,
  contactPageSnapshot,
} from '../contactUs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ABOUT_SCREEN = readFileSync(
  join(HERE, '..', '..', 'screens', 'redesign', 'AboutUsScreen.tsx'),
  'utf8',
);
const CONTACT_SCREEN = readFileSync(
  join(HERE, '..', '..', 'screens', 'redesign', 'ContactUsScreen.tsx'),
  'utf8',
);

describe('the static About and Contact snapshots', () => {
  it('serves About’s source promise, beliefs, and public starting links from shared copy', () => {
    const snapshot = aboutPageSnapshot();

    expect(snapshot.heading).toBe(ABOUT_PAGE_HEADING);
    expect(snapshot.subheading).toBe(ABOUT_PAGE_SUBTITLE);
    expect(
      snapshot.sections?.find((section) => section.heading === ABOUT_WHY_HEADING)?.body,
    ).toEqual(ABOUT_WHY_LINES.map((line) => line.text));
    expect(
      snapshot.sections?.find((section) => section.heading === ABOUT_BELIEFS_HEADING)?.items,
    ).toEqual(ABOUT_BELIEFS.map((belief) => ({ label: belief.beliefTitle, detail: belief.body })));
    expect(
      snapshot.sections?.find((section) => section.heading === ABOUT_START_HEADING)?.items,
    ).toEqual(
      ABOUT_START_ITEMS.filter((item) => item.destination !== 'track').map((item) => ({
        label: item.startTitle,
        detail: item.body,
        href: item.href,
      })),
    );
    expect(JSON.stringify(snapshot)).not.toContain('On the roadmap');
    expect(JSON.stringify(snapshot)).not.toContain('/tracked');
    expect(snapshot.links).toEqual([
      ABOUT_CONTACT_LINK,
      { label: ABOUT_EMAIL, href: `mailto:${ABOUT_EMAIL}` },
    ]);
    expect(
      snapshot.sections?.find((section) => section.heading === ABOUT_CONTACT_HEADING)?.body,
    ).toEqual([`${ABOUT_FEEDBACK_LABEL} ${ABOUT_EMAIL}`, ABOUT_CORRECTION_PROMISE]);
  });

  it('serves Contact’s purpose and direct links without pretending the form works', () => {
    const snapshot = contactPageSnapshot();

    expect(snapshot.heading).toBe(CONTACT_PAGE_HEADING);
    expect(snapshot.subheading).toBe(CONTACT_PAGE_SUBTITLE);
    expect(snapshot.links).toEqual([
      { label: CONTACT_EMAIL, href: `mailto:${CONTACT_EMAIL}` },
      ...CONTACT_SOCIALS.flatMap((social) =>
        social.url ? [{ label: social.label, href: social.url }] : [],
      ),
    ]);
    expect(JSON.stringify(snapshot)).not.toContain('Send message');
    expect(JSON.stringify(snapshot)).not.toContain('MESSAGE');
  });

  it('makes both screens draw the same shared values their snapshots serve', () => {
    for (const name of [
      'ABOUT_PAGE_HEADING',
      'ABOUT_PAGE_SUBTITLE_LEAD',
      'ABOUT_PAGE_SOURCE_PROMISE',
      'ABOUT_NAME_ORIGIN',
      'ABOUT_WHY_HEADING',
      'ABOUT_WHY_LINES',
      'ABOUT_BELIEFS_HEADING',
      'ABOUT_BELIEFS',
      'ABOUT_START_HEADING',
      'ABOUT_START_ITEMS',
      'ABOUT_CONTACT_HEADING',
      'ABOUT_CONTACT_LINK',
      'ABOUT_CORRECTION_PROMISE',
      'ABOUT_EMAIL',
      'ABOUT_FEEDBACK_LABEL',
    ]) {
      expect(ABOUT_SCREEN).toContain(name);
    }
    for (const name of [
      'CONTACT_PAGE_HEADING',
      'CONTACT_PAGE_SUBTITLE',
      'CONTACT_EMAIL',
      'CONTACT_SOCIALS',
    ]) {
      expect(CONTACT_SCREEN).toContain(name);
    }
  });
});
