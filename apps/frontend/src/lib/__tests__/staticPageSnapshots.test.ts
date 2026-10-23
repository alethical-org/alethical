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
  ABOUT_FACTS_CONTACT_LABEL,
  ABOUT_FACTS_FOUNDERS_LABEL,
  ABOUT_FACTS_HEADING,
  ABOUT_FACTS_LAUNCH,
  ABOUT_FACTS_SERVICES,
  ABOUT_FACTS_SERVICES_LABEL,
  ABOUT_FACTS_SERVICES_LINK,
  ABOUT_PAGE_HEADING,
  ABOUT_PAGE_SUBTITLE,
  ABOUT_START_ITEMS,
  ABOUT_START_HEADING,
  ABOUT_TEAM_HEADING,
  ABOUT_TEAM_MEMBERS,
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
    expect(
      snapshot.sections?.find((section) => section.heading === ABOUT_TEAM_HEADING)?.items,
    ).toEqual(
      ABOUT_TEAM_MEMBERS.map((member) => ({
        label: `${member.name}, ${member.title}`,
        detail: member.bio.join(' '),
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
    ).toEqual([ABOUT_CORRECTION_PROMISE]);
  });

  it('serves the About facts once, before the page explains why it exists', () => {
    const snapshot = aboutPageSnapshot();
    const headings = snapshot.sections?.map((section) => section.heading) ?? [];
    const facts = snapshot.sections?.find((section) => section.heading === ABOUT_FACTS_HEADING);

    expect(headings.indexOf(ABOUT_FACTS_HEADING)).toBe(0);
    expect(facts?.body).toEqual([ABOUT_FACTS_LAUNCH]);
    expect(facts?.items).toEqual([
      { label: ABOUT_FACTS_SERVICES_LABEL, detail: ABOUT_FACTS_SERVICES },
      { label: ABOUT_FACTS_SERVICES_LINK.label, href: ABOUT_FACTS_SERVICES_LINK.href },
      ...ABOUT_TEAM_MEMBERS.map((member) => ({
        label: ABOUT_FACTS_FOUNDERS_LABEL,
        detail: `${member.name} · ${member.title}`,
      })),
      { label: ABOUT_FACTS_CONTACT_LABEL, detail: ABOUT_EMAIL },
    ]);
    // The email appears in the facts and the mailto link, never as a second body line.
    expect(JSON.stringify(snapshot.sections)).not.toContain('Feedback:');
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
      'ABOUT_TEAM_HEADING',
      'ABOUT_TEAM_MEMBERS',
      'ABOUT_START_HEADING',
      'ABOUT_START_ITEMS',
      'ABOUT_CONTACT_HEADING',
      'ABOUT_CONTACT_LINK',
      'ABOUT_CORRECTION_PROMISE',
      'ABOUT_EMAIL',
      'ABOUT_FACTS_HEADING',
      'ABOUT_FACTS_LAUNCH',
      'ABOUT_FACTS_SERVICES',
      'ABOUT_FACTS_SERVICES_LINK',
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
