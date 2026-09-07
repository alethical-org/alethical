import type { PageSnapshot } from './pageSnapshot';

export const ABOUT_PAGE_HEADING = 'TRUTH, UNCONCEALED';
export const ABOUT_PAGE_SUBTITLE_LEAD = 'Minnesota’s public record, in everyday words and ';
export const ABOUT_PAGE_SOURCE_PROMISE = 'linked to the source.';
export const ABOUT_PAGE_SUBTITLE = `${ABOUT_PAGE_SUBTITLE_LEAD}${ABOUT_PAGE_SOURCE_PROMISE}`;
export const ABOUT_WHY_HEADING = 'Why we’re doing this';
export const ABOUT_BELIEFS_HEADING = 'What we believe';
export const ABOUT_START_HEADING = 'Where to start';

export const ABOUT_NAME_ORIGIN = {
  beforeName: 'Alethical comes from ',
  firstName: 'aletheia',
  betweenNames: ', an ancient Greek word for truth brought into the open, and ',
  secondName: 'ethical',
  afterName: ', our promise to handle that truth with care.',
} as const;

export function aboutNameOriginText(): string {
  return [
    ABOUT_NAME_ORIGIN.beforeName,
    ABOUT_NAME_ORIGIN.firstName,
    ABOUT_NAME_ORIGIN.betweenNames,
    ABOUT_NAME_ORIGIN.secondName,
    ABOUT_NAME_ORIGIN.afterName,
  ].join('');
}

export const ABOUT_WHY_LINES = [
  {
    text: 'Government records belong to everyone. Understanding them should not require knowing how the Legislature works.',
    lead: false,
  },
  {
    text: 'Minnesota publishes bills, votes, authors, committee actions, and more. The information is public. But it is spread across many pages and written in the language of lawmaking. A bill may look like a number, a list of steps, and pages of changes to laws you have never read.',
    lead: false,
  },
  {
    text: 'That can make a simple question hard to answer: What would this bill do?',
    lead: true,
  },
  {
    text: 'Alethical brings the pieces together and makes them easier to read. We use plain language, show where the facts came from, and keep a clear link to the official record. If the record cannot answer a question, neither do we.',
    lead: false,
  },
] as const;

export const ABOUT_BELIEFS = [
  {
    beliefTitle: 'Facts before opinions',
    body: 'We show what the public record says. We do not tell you what to think or whom to support.',
  },
  {
    beliefTitle: 'Sources you can check',
    body: 'Every important fact leads back to its source. If we cannot verify something, we say we do not know.',
  },
  {
    beliefTitle: 'Clear for anyone',
    body: 'You should not need a law degree, a job in politics, or the right vocabulary to get started.',
  },
  {
    beliefTitle: 'The same rules for everyone',
    body: 'We use the same standards for every party, bill, and legislator. We do not score or rate people.',
  },
  {
    beliefTitle: 'Your judgment stays yours',
    body: 'We help you understand what happened or what is being proposed. You decide what it means to you.',
  },
  {
    beliefTitle: 'Built for answers, not attention',
    body: 'There is no endless feed. Come with a question. Leave when you have what you need.',
  },
] as const;

export const ABOUT_START_ITEMS = [
  {
    startTitle: 'Bills',
    body: 'Search Minnesota bills and narrow the results to what matters to you.',
    destination: 'bills',
    href: '/bills',
  },
  {
    startTitle: 'Legislators',
    body: 'Find any current Minnesota legislator, explore their public record, and see how to contact them.',
    destination: 'legislators',
    href: '/legislators',
  },
  {
    startTitle: 'Find My Legislator',
    body: 'See who represents you in the Minnesota House and Senate, and learn about their work and how to contact them.',
    destination: 'findMyLegislator',
    href: '/find-my-legislator',
  },
  {
    startTitle: 'Track',
    body: 'Follow the bills that matter to you and see what changes.',
    destination: 'track',
    href: '/tracked',
  },
] as const;

export const ABOUT_CONTACT_HEADING = 'Contact';
export const ABOUT_FEEDBACK_LABEL = 'Feedback:';
export const ABOUT_EMAIL = 'ask@alethical.com';
export const ABOUT_CORRECTION_PROMISE =
  'Think we got something wrong? Please tell us. Corrections come first.';
export const ABOUT_CONTACT_LINK = { label: 'Contact us', href: '/about/contact' } as const;

export function aboutPageSnapshot(): PageSnapshot {
  return {
    heading: ABOUT_PAGE_HEADING,
    subheading: ABOUT_PAGE_SUBTITLE,
    bodyHeading: '',
    body: [aboutNameOriginText()],
    bodyIsList: false,
    facts: [],
    sections: [
      {
        heading: ABOUT_WHY_HEADING,
        body: ABOUT_WHY_LINES.map((line) => line.text),
      },
      {
        heading: ABOUT_BELIEFS_HEADING,
        items: ABOUT_BELIEFS.map((belief) => ({
          label: belief.beliefTitle,
          detail: belief.body,
        })),
      },
      {
        heading: ABOUT_START_HEADING,
        items: ABOUT_START_ITEMS.filter((item) => item.destination !== 'track').map((item) => ({
          label: item.startTitle,
          detail: item.body,
          href: item.href,
        })),
      },
      {
        heading: ABOUT_CONTACT_HEADING,
        body: [`${ABOUT_FEEDBACK_LABEL} ${ABOUT_EMAIL}`, ABOUT_CORRECTION_PROMISE],
      },
    ],
    links: [ABOUT_CONTACT_LINK, { label: ABOUT_EMAIL, href: `mailto:${ABOUT_EMAIL}` }],
  };
}
