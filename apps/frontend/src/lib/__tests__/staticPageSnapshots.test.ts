import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import {
  ABOUT_BELIEFS,
  ABOUT_BELIEFS_HEADING,
  ABOUT_CONTACT_HEADING,
  ABOUT_CONTACT_LABEL,
  ABOUT_CORRECTION_CONTACT_HREF,
  ABOUT_CORRECTION_PROMISE,
  ABOUT_DOES_HEADING,
  ABOUT_EMAIL,
  ABOUT_FEATURE_CONTACT_HREF,
  ABOUT_PAGE_HEADING,
  ABOUT_PAGE_SUBTITLE,
  ABOUT_PLATFORM_ITEMS,
  ABOUT_ROADMAP_HEADING,
  ABOUT_ROADMAP_ITEMS,
  ABOUT_SERVICES_ITEM,
  ABOUT_TEAM_HEADING,
  ABOUT_TEAM_MEMBERS,
  ABOUT_WHY_HEADING,
  ABOUT_WHY_LINES,
  ABOUT_WRITING_ITEMS,
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
  it('serves the About page in the order and words the screen draws', () => {
    const snapshot = aboutPageSnapshot();
    const section = (heading: string) =>
      snapshot.sections?.find((candidate) => candidate.heading === heading);

    expect(snapshot.heading).toBe(ABOUT_PAGE_HEADING);
    expect(snapshot.subheading).toBe(ABOUT_PAGE_SUBTITLE);
    expect(snapshot.sections?.map((candidate) => candidate.heading)).toEqual([
      ABOUT_DOES_HEADING,
      ABOUT_WHY_HEADING,
      ABOUT_BELIEFS_HEADING,
      ABOUT_TEAM_HEADING,
      ABOUT_ROADMAP_HEADING,
      ABOUT_CONTACT_HEADING,
    ]);
    expect(section(ABOUT_WHY_HEADING)?.body).toEqual([...ABOUT_WHY_LINES]);
    expect(section(ABOUT_BELIEFS_HEADING)?.items).toEqual(
      ABOUT_BELIEFS.map((belief) => ({ label: belief.beliefTitle, detail: belief.body })),
    );
    expect(section(ABOUT_TEAM_HEADING)?.items).toEqual(
      ABOUT_TEAM_MEMBERS.map((member) => ({
        label: `${member.name}, ${member.title}`,
        detail: member.bio.join(' '),
      })),
    );
    expect(section(ABOUT_CONTACT_HEADING)?.body).toEqual([ABOUT_CORRECTION_PROMISE]);
    expect(snapshot.links).toEqual([
      { label: ABOUT_EMAIL, href: `mailto:${ABOUT_EMAIL}` },
      { label: ABOUT_CONTACT_LABEL, href: ABOUT_CORRECTION_CONTACT_HREF },
    ]);
  });

  it('serves all 3 offerings as real links, including the signed-out Track path', () => {
    const blocks = aboutPageSnapshot().sections?.[0].blocks ?? [];
    const links = blocks.flatMap((block) => (block.kind === 'links' ? block.items : []));
    const expected = [...ABOUT_PLATFORM_ITEMS, ...ABOUT_WRITING_ITEMS, ABOUT_SERVICES_ITEM];

    expect(links).toEqual(
      expected.map((item) => ({ label: item.title, detail: item.body, href: item.href })),
    );
    expect(links.find((link) => link.href === '/tracked')?.detail).toBe(
      'Sign in to follow bills and see what changes',
    );
  });

  it('serves only unbuilt work on the roadmap, clearly as future, with its feature contact', () => {
    const roadmap = aboutPageSnapshot().sections?.find(
      (candidate) => candidate.heading === ABOUT_ROADMAP_HEADING,
    );
    const text = JSON.stringify(roadmap);

    expect(ABOUT_ROADMAP_ITEMS).toHaveLength(5);
    expect(text).not.toContain('Ask AI');
    expect(text).not.toMatch(/Candidates, campaigns, and money|co-authors/);
    expect(text).toContain(ABOUT_FEATURE_CONTACT_HREF);
  });

  it('states each fact once: no founder list or contact before the team', () => {
    const snapshot = aboutPageSnapshot();
    const beforeTeam = JSON.stringify(snapshot.sections?.slice(0, 3));
    for (const member of ABOUT_TEAM_MEMBERS) expect(beforeTeam).not.toContain(member.name);
    expect(JSON.stringify(snapshot)).not.toContain('Launched in Minnesota');
    expect(JSON.stringify(snapshot.sections)).not.toContain(ABOUT_EMAIL);
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
      'ABOUT_PAGE_SUBTITLE',
      'ABOUT_NAME_ORIGIN',
      'ABOUT_DOES_HEADING',
      'ABOUT_PLATFORM_ITEMS',
      'ABOUT_WRITING_ITEMS',
      'ABOUT_SERVICES_ITEM',
      'ABOUT_WHY_HEADING',
      'ABOUT_WHY_LINES',
      'ABOUT_BELIEFS_HEADING',
      'ABOUT_BELIEFS',
      'ABOUT_TEAM_HEADING',
      'ABOUT_TEAM_MEMBERS',
      'ABOUT_ROADMAP_ITEMS',
      'ABOUT_ROADMAP_INVITATION',
      'ABOUT_CONTACT_HEADING',
      'ABOUT_CORRECTION_PROMISE',
      'ABOUT_EMAIL',
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
