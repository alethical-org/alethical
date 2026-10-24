import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import {
  ABOUT_BELIEFS,
  ABOUT_NAME_ORIGIN,
  ABOUT_PAGE_HEADING,
  ABOUT_PAGE_SUBTITLE,
  ABOUT_PLATFORM_ITEMS,
  ABOUT_ROADMAP_ITEMS,
  ABOUT_SERVICES_ITEM,
  ABOUT_TEAM_HEADING,
  ABOUT_TEAM_MEMBERS,
  ABOUT_TRACK_SIGNED_IN,
  ABOUT_TRACK_SIGNED_OUT,
  ABOUT_WRITING_ITEMS,
} from '../../../lib/aboutUs';
import { contactPrefillValues } from '../../../lib/contactUs';
import { pathForRoute, targetFromPathname } from '../../../navigation/webRoutes';

const SCREEN = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '..', 'AboutUsScreen.tsx'),
  'utf8',
);

describe('About us screen contract', () => {
  it('states the promise as one plain subtitle under the heading', () => {
    expect(ABOUT_PAGE_HEADING).toBe('TRUTH, UNCONCEALED');
    expect(ABOUT_PAGE_SUBTITLE).toBe(
      'Minnesota’s public record, in everyday words and linked to the source',
    );
    // The whole subtitle shares one style: no purple run, link or underline.
    expect(SCREEN).toContain('{ABOUT_PAGE_SUBTITLE}');
    expect(SCREEN).not.toContain('provenanceText');
    expect(SCREEN).not.toContain('purple');
    expect(ABOUT_NAME_ORIGIN.beforeName).toContain('Alethical comes from');
    expect(ABOUT_NAME_ORIGIN.betweenNames).toContain('truth brought into the open');
  });

  it('draws the sections in the agreed order', () => {
    const order = [
      '{ABOUT_PAGE_SUBTITLE}',
      'ABOUT_NAME_ORIGIN.firstName',
      '{ABOUT_DOES_HEADING}',
      'heading={ABOUT_PLATFORM_HEADING}',
      'heading={ABOUT_WRITING_HEADING}',
      'heading={ABOUT_SERVICES_HEADING}',
      '{ABOUT_WHY_HEADING}',
      '{ABOUT_BELIEFS_HEADING}',
      '{ABOUT_TEAM_HEADING}',
      '{ABOUT_ROADMAP_HEADING}',
      '{ABOUT_CONTACT_HEADING}',
      '<Footer',
    ].map((marker) => SCREEN.indexOf(marker));
    expect(order.every((position) => position > 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it('links every offering to a real address with its own description', () => {
    const items = [...ABOUT_PLATFORM_ITEMS, ...ABOUT_WRITING_ITEMS, ABOUT_SERVICES_ITEM];
    expect(items.map((item) => item.href)).toEqual([
      '/bills',
      '/legislators',
      '/find-my-legislator',
      '/candidates',
      '/money',
      '/tracked',
      '/blog',
      '/blog/events/forward-debate-2026',
      '/services',
    ]);
    for (const item of items) expect(targetFromPathname(item.href).kind).not.toBe('notFound');
    expect(items.find((item) => item.href === '/find-my-legislator')?.title).toBe(
      'Find my legislators',
    );
    expect(SCREEN).toContain('linkProps(item.href, item.onPress)');
    // Only the green title is the link; the description and photo sit outside it.
    expect(SCREEN).toMatch(/<\/Pressable>\s*<Text\s*style=\{\[\s*styles\.offerBody/);
    expect(SCREEN).toMatch(/offerLink:\s*\{[^}]*minHeight: 44/s);
  });

  it('describes Track for signed-out and signed-in readers', () => {
    expect(ABOUT_PLATFORM_ITEMS.find((item) => item.destination === 'track')?.body).toBe(
      ABOUT_TRACK_SIGNED_OUT,
    );
    expect(ABOUT_TRACK_SIGNED_IN).toBe('Follow bills and see what changes');
    expect(SCREEN).toContain('isSignedIn ? ABOUT_TRACK_SIGNED_IN : item.body');
  });

  it('shows the debate photo as decoration that disappears if it fails', () => {
    expect(SCREEN).toContain('alt=""');
    expect(SCREEN).toContain('onError={() => setFailed(true)}');
    expect(SCREEN).toContain('if (!DEBATE_EVENT || failed) return null');
  });

  it('keeps all 6 beliefs and both founders with full bios', () => {
    expect(ABOUT_BELIEFS).toHaveLength(6);
    expect(ABOUT_TEAM_HEADING).toBe('Our team');
    expect(ABOUT_TEAM_MEMBERS.map((member) => [member.name, member.title])).toEqual([
      ['Angel Zierden', 'Founder & CEO'],
      ['Eugene Lopin', 'Co-Founder & CPTO'],
    ]);
    expect(ABOUT_TEAM_MEMBERS.every((member) => member.bio.length === 3)).toBe(true);
    expect(ABOUT_TEAM_MEMBERS[0].bio[0]).toBe(
      'Angel builds things (companies, coalitions, and policy) at the intersection of technology, business, and public service. She leads Alethical, which makes Minnesota’s public records easier to understand and check, with plain-language explanations and links to official sources.',
    );
    expect(SCREEN).toContain("require('../../../assets/team/angel-zierden.jpg')");
    expect(SCREEN).toContain('accessibilityLabel={member.name}');
  });

  it('lists only unbuilt work on the roadmap, unlinked', () => {
    expect(ABOUT_ROADMAP_ITEMS.map((item) => item.title)).toEqual([
      'Grounded Ask, beyond bills',
      'More from candidates and legislators',
      'Personalization built around you',
      'News connected to the Legislature',
      'A more complete public record',
    ]);
    expect(JSON.stringify(ABOUT_ROADMAP_ITEMS)).not.toContain('Ask AI');
    expect(SCREEN).not.toContain('linkProps(item.title');
  });

  it('opens Contact us with editable words for its known purpose', () => {
    expect(SCREEN).toContain("routePath.contactUs({ purpose: 'correction' })");
    expect(pathForRoute({ name: 'ContactUs', params: { purpose: 'correction' } })).toBe(
      '/about/contact?purpose=correction',
    );
    expect(targetFromPathname('/about/contact?purpose=correction')).toMatchObject({
      purpose: 'correction',
    });
    expect(targetFromPathname('/about/contact?purpose=anything-else')).not.toHaveProperty(
      'purpose',
    );
    expect(contactPrefillValues(undefined, 'correction')).toMatchObject({
      subject: 'Possible correction',
    });
    // The roadmap invitation is plain text; its feature-request purpose is retired.
    expect(targetFromPathname('/about/contact?purpose=feature-request')).not.toHaveProperty(
      'purpose',
    );
    expect(SCREEN).not.toContain('feature-request');
    // The shared footer link stays generic.
    expect(SCREEN).toContain("onContact={() => navigation.navigate('ContactUs')}");
  });

  it('shows the email once, in Contact, and uses the shared frame', () => {
    expect(SCREEN.match(/<EmailLink /g)).toHaveLength(1);
    expect(SCREEN).toContain('<TopNav');
    expect(SCREEN).toContain('<Footer');
    expect(SCREEN).not.toContain('Launched in Minnesota');
  });
});
