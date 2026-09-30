import type { PageSnapshot } from './pageSnapshot';
import {
  SERVICES_AUDIENCES,
  SERVICES_CANDIDATE_NAMES,
  SERVICES_COALITION_URL,
  SERVICES_CONTACT_EMAIL,
  SERVICES_CONTACT_HREF,
  SERVICES_DELIVERY_INTRO,
  SERVICES_EARLY_HEADING,
  SERVICES_EARLY_INTRO,
  SERVICES_GROUPS,
  SERVICES_HEADLINE,
  SERVICES_PARTNER_GROUPS,
  SERVICES_PARTNER_INTRO,
  SERVICES_PRICING,
  SERVICES_SUBTITLE,
  SERVICES_TOOL_INTRO,
  SERVICES_TOOLS,
} from './services';

/** The first response carries the same public copy the services screen draws. */
export function servicesPageSnapshot(): PageSnapshot {
  const candidateNames = `${SERVICES_CANDIDATE_NAMES.slice(0, -1).join(', ')}, and ${SERVICES_CANDIDATE_NAMES.at(-1)}`;
  return {
    appearance: 'dark',
    navigation: 'services',
    heading: SERVICES_HEADLINE,
    subheading: SERVICES_SUBTITLE,
    bodyHeading: '',
    body: [SERVICES_PARTNER_INTRO],
    facts: [],
    bodyIsList: false,
    sections: [
      ...SERVICES_AUDIENCES.map((audience) => ({
        heading: audience.title,
        blocks: [
          { kind: 'prose' as const, lines: [audience.text] },
          { kind: 'bullets' as const, items: [...audience.examples] },
        ],
      })),
      ...SERVICES_GROUPS.map((group, index) => ({
        id: index === 0 ? 'services-offering' : undefined,
        heading: group.title,
        blocks: [
          { kind: 'prose' as const, lines: [group.line] },
          { kind: 'bullets' as const, items: [...group.examples] },
        ],
      })),
      {
        heading: 'Tools built around the way your team works.',
        body: ['IN DEVELOPMENT', SERVICES_TOOL_INTRO],
        items: SERVICES_TOOLS.map((tool) => ({ label: tool.title, detail: tool.text })),
      },
      {
        id: 'partners',
        heading: 'Specialist support, connected to your campaign.',
        body: [
          'Explore a broader range of campaign services through Alethical’s partner marketplace.',
        ],
      },
      ...SERVICES_PARTNER_GROUPS.map((group) => ({
        heading: group.name,
        body: [...group.items],
        bodyIsList: true,
      })),
      {
        id: 'early-work',
        heading: SERVICES_EARLY_HEADING,
        blocks: [
          { kind: 'prose', lines: [SERVICES_EARLY_INTRO] },
          {
            kind: 'runs',
            runs: [
              { kind: 'text', text: 'We’ve supported ' },
              {
                kind: 'externalLink',
                text: 'Minnesota Forward Coalition',
                href: SERVICES_COALITION_URL,
              },
              { kind: 'text', text: ` candidates including ${candidateNames}` },
            ],
          },
        ],
      },
      {
        heading: 'Delivery and pricing',
        body: [SERVICES_DELIVERY_INTRO, SERVICES_PRICING],
      },
    ],
    links: [{ label: SERVICES_CONTACT_EMAIL, href: SERVICES_CONTACT_HREF }],
  };
}
