import type { PageSnapshot } from './pageSnapshot';

export const ABOUT_PAGE_HEADING = 'TRUTH, UNCONCEALED';
export const ABOUT_PAGE_SUBTITLE =
  'Minnesota’s public record, in everyday words and linked to the source';
export const ABOUT_WHY_HEADING = 'Why we’re doing this';
export const ABOUT_BELIEFS_HEADING = 'What we believe';
export const ABOUT_TEAM_HEADING = 'Our team';
export const ABOUT_DOES_HEADING = 'What Alethical does';
export const ABOUT_ROADMAP_HEADING = 'On the roadmap';

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
  'Government records belong to everyone. Understanding them should not require a law degree or a job in politics.',
  'Minnesota publishes bills, votes, campaign money reports and lobbying records. The information is public, but it is spread across many places and can be hard to follow. That can make simple questions hard to answer: What would this bill do? How did my legislator vote? Who gave money to this campaign?',
  'Alethical brings the records together, explains them in plain language and keeps the sources within reach. If the record cannot answer a question, neither do we.',
  'We’re working toward a Minnesota where anyone can check the public record for themselves, without relying on a headline, a social post or Alethical alone.',
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

export const ABOUT_TEAM_MEMBERS = [
  {
    name: 'Angel Zierden',
    title: 'Founder & CEO',
    bio: [
      'Angel builds things (companies, coalitions, and policy) at the intersection of technology, business, and public service. She leads Alethical, which makes Minnesota’s public records easier to understand and check, with plain-language explanations and links to official sources.',
      'Her civic career spans elected office and political strategy: she has served as Mayor of Breezy Point, was elected Commissioner for the Region Five Development Commission, ran for Minnesota Senate, and has spent years as a political strategist working on campaigns and drafting legislation (including three pediatric medical-device innovation bills). She has also served on boards focused on restorative justice, relationship safety, and mental health.',
      'Her entrepreneurial track record spans med-tech and real estate, including founding and advising health and medical-device ventures, judging the Minnesota Cup, and working across real estate investment, development, sales, and construction.',
    ],
  },
  {
    name: 'Eugene Lopin',
    title: 'Co-Founder & CPTO',
    bio: [
      'Eugene builds products where AI meets real-world trust. He leads product and engineering at Alethical, turning records of lawmaking and money in politics into plain language grounded in official sources, so people can understand what their government is doing and check the evidence for themselves.',
      'He brings 20+ years of product and entrepreneurial experience and has been building AI systems for real-world use. His work spans financial technology, payments, online commerce, fraud prevention, regulatory compliance, and AI-powered business tools. He combines product strategy, hands-on engineering, and business development to take products from concept to launch and growth.',
      'At Estée Lauder, he led global payments and fraud prevention across 30 brands and 150 markets, improving checkout and reducing fraud losses. His earlier work includes launching financial technology businesses and leading digital products for Razorfish clients including Mercedes-Benz and Total Wine & More.',
    ],
  },
] as const;

// What Alethical does: the public platform, the writing and debates, and the services.
export const ABOUT_PLATFORM_HEADING = 'Public platform';
export const ABOUT_PLATFORM_INTRO =
  'Alethical makes Minnesota’s public record easier to understand and check, with links to official sources';
export const ABOUT_TRACK_SIGNED_OUT = 'Sign in to follow bills and see what changes';
export const ABOUT_TRACK_SIGNED_IN = 'Follow bills and see what changes';

export const ABOUT_PLATFORM_ITEMS = [
  {
    title: 'Bills and votes',
    body: 'Find bills, read what they would do, and see their progress and recorded votes',
    destination: 'bills',
    href: '/bills',
  },
  {
    title: 'Legislators',
    body: 'Explore Minnesota legislators’ public records and contact information',
    destination: 'legislators',
    href: '/legislators',
  },
  {
    title: 'Find my legislators',
    body: 'Find who represents you in the Minnesota House and Senate',
    destination: 'findMyLegislator',
    href: '/find-my-legislator',
  },
  {
    title: 'Find my candidates',
    body: 'Find candidates in Minnesota races where you live, using official election records',
    destination: 'candidates',
    href: '/candidates',
  },
  {
    title: 'Money in politics',
    body: 'Explore campaign donations, spending and lobbying records',
    destination: 'money',
    href: '/money',
  },
  {
    title: 'Track bills',
    body: ABOUT_TRACK_SIGNED_OUT,
    destination: 'track',
    href: '/tracked',
  },
] as const;

export const ABOUT_WRITING_HEADING = 'Research, guides and debates';
export const ABOUT_WRITING_INTRO = 'We publish research and guides and host candidate debates';
export const ABOUT_WRITING_ITEMS = [
  {
    title: 'Read research and guides',
    body: 'Understand Minnesota’s public records',
    destination: 'blog',
    href: '/blog',
  },
  {
    title: 'Watch The Forward Debate',
    body: 'Hear directly from candidates, or read the edited transcript',
    destination: 'debate',
    href: '/blog/events/forward-debate-2026',
  },
] as const;

export const ABOUT_SERVICES_HEADING = 'Campaign services';
export const ABOUT_SERVICES_INTRO =
  'Political intelligence and campaign strategy for candidates and organizations';
export const ABOUT_SERVICES_ITEM = {
  title: 'Explore our services',
  body: 'Campaign-finance research, websites, content and custom tools',
  destination: 'services',
  href: '/services',
} as const;

// Only work that is not built yet. Shipped capabilities live in What Alethical does.
export const ABOUT_ROADMAP_ITEMS = [
  {
    title: 'Grounded Ask, beyond bills',
    body: 'Ask in your own words how legislators voted, and about candidates and campaign money, with every answer citing its source',
  },
  {
    title: 'More from candidates and legislators',
    body: 'Candidates can already claim their profile and publish a statement. Next: more ways for candidates to answer voters, and legislators claiming their profiles to explain their votes, always labeled and kept separate from the official record.',
  },
  {
    title: 'Personalization built around you',
    body: 'Follow legislators and issues as well as bills, and get email updates when something changes or a new bill matches an issue you follow',
  },
  {
    title: 'News connected to the Legislature',
    body: 'Explore Minnesota political news in its own section, follow hot topics, and see stories connected to the bills they cover',
  },
  {
    title: 'A more complete public record',
    body: 'Search past legislative sessions, see each legislator’s voting record in one place, read explanations legislators choose to add, and jump from citations to exact official passages',
  },
] as const;
export const ABOUT_ROADMAP_INVITATION =
  'Which features matter most to you? Tell us what you want us to build first, and what we are missing.';

export const ABOUT_CONTACT_HEADING = 'Contact';
export const ABOUT_EMAIL = 'ask@alethical.com';
export const ABOUT_CORRECTION_PROMISE =
  'Think we got something wrong? Please tell us. Corrections come first.';
export const ABOUT_CONTACT_LABEL = 'Contact us';
export const ABOUT_CORRECTION_CONTACT_HREF = '/about/contact?purpose=correction';

/** What the page states Alethical does, as one sentence for the organization data. */
export const ABOUT_DESCRIPTION =
  'Alethical makes Minnesota’s public records easier to understand and check, publishes research and guides, hosts candidate debates, and offers political intelligence and campaign strategy.';

/** The same facts for search results; the title already carries the name. */
export const ABOUT_SEARCH_DESCRIPTION =
  'Minnesota’s public records made easier to understand and check, plus research, guides, candidate debates, and political intelligence and campaign strategy.';

const linkItem = (item: { title: string; body: string; href: string }) => ({
  label: item.title,
  detail: item.body,
  href: item.href,
});

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
        heading: ABOUT_DOES_HEADING,
        blocks: [
          { kind: 'prose', lines: [ABOUT_PLATFORM_HEADING, ABOUT_PLATFORM_INTRO] },
          { kind: 'links', items: ABOUT_PLATFORM_ITEMS.map(linkItem) },
          { kind: 'prose', lines: [ABOUT_WRITING_HEADING, ABOUT_WRITING_INTRO] },
          { kind: 'links', items: ABOUT_WRITING_ITEMS.map(linkItem) },
          { kind: 'prose', lines: [ABOUT_SERVICES_HEADING, ABOUT_SERVICES_INTRO] },
          { kind: 'links', items: [linkItem(ABOUT_SERVICES_ITEM)] },
        ],
      },
      {
        heading: ABOUT_WHY_HEADING,
        body: [...ABOUT_WHY_LINES],
      },
      {
        heading: ABOUT_BELIEFS_HEADING,
        items: ABOUT_BELIEFS.map((belief) => ({
          label: belief.beliefTitle,
          detail: belief.body,
        })),
      },
      {
        heading: ABOUT_TEAM_HEADING,
        items: ABOUT_TEAM_MEMBERS.map((member) => ({
          label: `${member.name}, ${member.title}`,
          detail: member.bio.join(' '),
        })),
      },
      {
        heading: ABOUT_ROADMAP_HEADING,
        blocks: [
          {
            kind: 'bullets',
            items: ABOUT_ROADMAP_ITEMS.map((item) => `${item.title}: ${item.body}`),
          },
          { kind: 'prose', lines: [ABOUT_ROADMAP_INVITATION] },
        ],
      },
      {
        heading: ABOUT_CONTACT_HEADING,
        body: [ABOUT_CORRECTION_PROMISE],
      },
    ],
    links: [
      { label: ABOUT_EMAIL, href: `mailto:${ABOUT_EMAIL}` },
      { label: ABOUT_CONTACT_LABEL, href: ABOUT_CORRECTION_CONTACT_HREF },
    ],
  };
}
