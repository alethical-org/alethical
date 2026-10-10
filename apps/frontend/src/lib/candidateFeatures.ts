import type { PageSnapshot } from './pageSnapshot';

/** /candidates/features wording, printed exactly as approved. Every feature here is on the
 * roadmap: none is available yet, and the page label says so. Shared by the screen and the
 * first-response page so the two can never say different things. */
export const CANDIDATE_FEATURES_COPY = {
  label: 'On the roadmap',
  heading: 'Candidate profile features',
  subheading: 'Help voters understand your campaign',
  intro:
    'Bring your experience, ideas and campaign updates together in one place. Give voters a clearer picture of who you are, what you want to do and how they can learn more.',
  continueClaim: 'Continue claiming this candidate profile',
  findCandidates: 'Find candidates',
  howHeading: 'How it works',
};

export interface CandidateFeatureItem {
  title: string;
  body: string;
}
export interface CandidateFeatureGroup {
  id: string;
  heading: string;
  items: CandidateFeatureItem[];
}

export const CANDIDATE_FEATURE_GROUPS: CandidateFeatureGroup[] = [
  {
    id: 'who',
    heading: 'Who you are',
    items: [
      {
        title: 'Your background and experience',
        body: 'Introduce yourself with a photo, a short biography and the work and community experience you bring. Show voters the person behind the name on their ballot.',
      },
      {
        title: 'Your positions on the issues',
        body: 'Explain where you stand on the issues that matter to the office you’re seeking. Give voters clear answers they can explore by topic, with links to your longer plans.',
      },
      {
        title: 'Your plans and priorities',
        body: 'Set out what you want to achieve, how you would approach it and what it would take. Make clear which priorities come first and the decisions you hope to make in office.',
      },
    ],
  },
  {
    id: 'questions',
    heading: 'Questions and answers',
    items: [
      {
        title: 'Answers voters can compare',
        body: 'Answer the same questions offered to other candidates in your race. Voters see the differences between candidates without searching across separate campaign websites.',
      },
      {
        title: 'Questions from voters',
        body: 'Respond to voter questions selected by Alethical and offered fairly to candidates in your race. Address local concerns and give more people access to useful answers.',
      },
    ],
  },
  {
    id: 'informed',
    heading: 'Keeping voters informed',
    items: [
      {
        title: 'Campaign updates',
        body: 'Share new proposals, clarify your positions and keep your information current',
      },
      {
        title: 'Public events',
        body: 'Let voters know where they can hear from you and ask questions. Share forums, public question sessions and other events, including attendance details and changes or cancellations.',
      },
      {
        title: 'Interviews and supporting material',
        body: 'Bring together full interviews, debates, plans and documents. Give voters a way to look beyond a short answer and explore the material behind your ideas.',
      },
      {
        title: 'Endorsements and affiliations',
        body: 'Show who has publicly endorsed your campaign and describe relevant affiliations. Include dates and supporting links so voters can see the basis for each claim.',
      },
      {
        title: 'Ways to reach your campaign',
        body: 'Keep your public website, campaign contact details and social links together. Voters can ask a question, learn more or find out how to get involved.',
      },
    ],
  },
  {
    id: 'records',
    heading: 'Public records and your team',
    items: [
      {
        title: 'Your explanation of public records',
        body: 'Add your campaign’s explanation alongside a public record, or request a factual correction with supporting evidence. Voters can consider your response while still seeing the original source.',
      },
      {
        title: 'Tools for your campaign team',
        body: 'Prepare drafts, preview changes and schedule updates. Give team members separate writing and publishing permissions, review information that may be out of date, and provide translations and text alongside video so more voters can understand your campaign.',
      },
    ],
  },
];

export const CANDIDATE_FEATURE_COMMITMENTS: CandidateFeatureItem[] = [
  {
    title: 'Following puts voters in control',
    body: 'Voters can follow a candidate or a whole race, choose the topics and updates they receive, and stop at any time. Following means staying informed, not declaring support. Follower names, email addresses and reading activity are not shared with campaigns.',
  },
  {
    title: 'Campaign voices and official facts stay distinct',
    body: 'Your campaign’s information is clearly labeled and kept separate from official records. Confirming your campaign’s access does not mean Alethical endorses its views or confirms every claim it publishes. Campaigns cannot change official records or remove them from public profiles.',
  },
  {
    title: 'Beyond election day',
    body: 'Your campaign information stays tied to the election it describes. Where Alethical has confirmed records of your service, voters can separately choose to follow your work in office.',
  },
];

/** Only a real candidate record id carries claim context; anything else is a direct visit. */
export function candidateFeaturesContext(value: unknown): string | null {
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value) ? value : null;
}
export function candidateFeaturesPath(candidateId?: string | null) {
  const id = candidateFeaturesContext(candidateId);
  return id ? `/candidates/features?candidate=${id}` : '/candidates/features';
}

/** The public first response: the same words, with no candidate name or claim action. */
export function candidateFeaturesPageSnapshot(): PageSnapshot {
  return {
    eyebrow: CANDIDATE_FEATURES_COPY.label,
    heading: CANDIDATE_FEATURES_COPY.heading,
    subheading: CANDIDATE_FEATURES_COPY.subheading,
    bodyHeading: CANDIDATE_FEATURES_COPY.subheading,
    body: [CANDIDATE_FEATURES_COPY.intro],
    bodyIsList: false,
    facts: [],
    sections: [
      ...CANDIDATE_FEATURE_GROUPS.map((group) => ({
        heading: group.heading,
        blocks: group.items.flatMap((item) => [
          { kind: 'prose' as const, lines: [item.title] },
          { kind: 'prose' as const, lines: [item.body] },
        ]),
      })),
      {
        heading: CANDIDATE_FEATURES_COPY.howHeading,
        blocks: CANDIDATE_FEATURE_COMMITMENTS.flatMap((item) => [
          { kind: 'prose' as const, lines: [item.title] },
          { kind: 'prose' as const, lines: [item.body] },
        ]),
      },
    ],
    links: [{ label: CANDIDATE_FEATURES_COPY.findCandidates, href: '/candidates' }],
  };
}
