/** Illustrative private review data. Never a source of public candidate records. */
import { createCandidateFlow } from '../components/candidates/candidateFlow';
import type {
  CandidateElection,
  CandidatePerson,
  CandidateProfileRecord,
  CandidateRace,
  CandidateSearchServices,
} from '../components/candidates/types';

export type PreviewScenario =
  | 'full'
  | 'partial'
  | 'empty'
  | 'ambiguous'
  | 'no-match'
  | 'outside-minnesota'
  | 'rate-limited'
  | 'failure';
export const candidatePreviewSettings = { scenario: 'full' as PreviewScenario, slow: false };
const elections: CandidateElection[] = [
  { id: 'preview-general', label: 'State general election', date: '2026-11-03', type: 'general' },
  { id: 'preview-special', label: 'Special election', date: '2027-02-09', type: 'special' },
  { id: 'preview-primary', label: 'State primary', date: '2026-08-11', type: 'primary' },
];
const source = {
  authority: 'Illustrative record for private review',
  url: 'https://www.sos.mn.gov/elections-voting/whats-on-my-ballot/',
  checkedDate: '2026-09-30',
};
const people: CandidatePerson[] = [
  {
    id: 'preview-general-alex',
    name: 'Alex Example',
    sortName: 'Example, Alex',
    party: 'Example party',
  },
  { id: 'preview-general-sam', name: 'Sam Sample', sortName: 'Sample, Sam' },
  { id: 'preview-general-jordan', name: 'Jordan Example', sortName: 'Example, Jordan' },
  { id: 'preview-general-taylor', name: 'Taylor Sample', sortName: 'Sample, Taylor' },
];
const races: CandidateRace[] = [
  {
    id: 'preview-house',
    group: 'state',
    office: 'State Representative',
    votingArea: 'House District 59B',
    entries: people.slice(0, 2).map((candidate) => ({ kind: 'candidate', candidate })),
    source,
  },
  {
    id: 'preview-school',
    group: 'school',
    office: 'School Board Member At Large',
    votingArea: 'Minneapolis School District',
    seatCount: 2,
    entries: people.slice(2).map((candidate) => ({ kind: 'candidate', candidate })),
    source,
  },
];
// Deliberately illustrative coverage of every approved result group and joint record.
const previewPerson = (id: string, name: string): CandidatePerson => ({
  id,
  name,
  sortName: name,
  party: 'Nonpartisan',
});
const localRace = (
  id: string,
  group: CandidateRace['group'],
  office: string,
  votingArea: string,
  names: string[],
  authority = 'Illustrative local election records',
): CandidateRace => ({
  id,
  group,
  office,
  votingArea,
  seatCount: 1,
  entries: names.map((name, i) => ({
    kind: 'candidate',
    candidate: previewPerson(`${id}-${i}`, name),
  })),
  source: { ...source, authority },
});
races.unshift({
  id: 'preview-governor',
  group: 'state',
  office: 'Governor and Lieutenant Governor',
  votingArea: 'Statewide',
  seatCount: 1,
  source,
  entries: [
    {
      kind: 'ticket',
      id: 'preview-ticket',
      party: 'Example party',
      members: [
        {
          id: 'preview-ticket',
          name: 'Rhea Example and Tobias Sample',
          sortName: 'Rhea Example and Tobias Sample',
        },
      ],
    },
  ],
});
races.push(
  localRace(
    'preview-county',
    'county',
    'County Commissioner',
    'Sample County, Commissioner District 3',
    ['Frances Example', 'Grant Sample'],
  ),
  localRace('preview-sheriff', 'county', 'County Sheriff', 'Sample County', []),
  localRace('preview-city', 'municipal', 'Council Member', 'City of Sample Lake, Ward 2', [
    'Hollis Example',
    'Marisol Sample',
  ]),
  localRace(
    'preview-other',
    'other',
    'Soil and Water Conservation District Supervisor',
    'Sample County SWCD, District 2',
    ['Arlo Example', 'Signe Sample'],
  ),
  ...[
    ['Supreme Court', '4'],
    ['Court of Appeals', '9'],
    ['9th District Court', '12'],
    ['9th District Court', '13'],
  ].map(([court, seat], i) => ({
    ...localRace(
      `preview-judge-${i}`,
      'state',
      `Judge, ${court}, Seat ${seat}`,
      i < 2 ? 'Statewide' : '9th Judicial District',
      [`Judge Example ${i + 1}`],
    ),
    source,
  })),
);
const primaryRaces: CandidateRace[] = [
  {
    ...races.find((race) => race.id === 'preview-house')!,
    entries: [
      {
        kind: 'candidate',
        candidate: { ...people[0], id: 'preview-primary-alex', party: 'Democratic-Farmer-Labor' },
      },
      {
        kind: 'candidate',
        candidate: { ...people[1], id: 'preview-primary-sam', party: 'Democratic-Farmer-Labor' },
      },
      {
        kind: 'candidate',
        candidate: { ...people[2], id: 'preview-primary-jordan', party: 'Republican' },
      },
    ],
  },
  localRace('preview-primary-sheriff', 'county', 'County Sheriff', 'Sample County', [
    'Avery Example',
    'Blair Sample',
    'Casey Example',
  ]),
  {
    ...races.find((race) => race.id === 'preview-school')!,
    entries: [
      'Alexis Example',
      'Blake Sample',
      'Drew Example',
      'Ellis Sample',
      'Finley Example',
    ].map((name, i) => ({
      kind: 'candidate',
      candidate: previewPerson(`primary-school-${i}`, name),
    })),
  },
];
const profiles = new Map<string, CandidateProfileRecord>();
for (const [election, electionRaces] of [
  [elections[0], races],
  [elections[2], primaryRaces],
] as const)
  for (const race of electionRaces)
    for (const entry of race.entries) {
      const candidate =
        entry.kind === 'candidate'
          ? entry.candidate
          : {
              ...entry.members[0],
              id: entry.id,
              name: entry.label ?? entry.members[0].name,
              party: entry.party ?? entry.members[0].party,
            };
      profiles.set(candidate.id, {
        candidate,
        election,
        office: race.office,
        votingArea: race.votingArea,
        source: race.source,
        ...(entry.kind === 'ticket' ? { isJointTicket: true } : {}),
      });
    }
profiles.set('preview-special-alex', {
  candidate: { ...people[0], id: 'preview-special-alex' },
  election: elections[1],
  office: 'School Board Member',
  votingArea: 'Illustrative special-election district',
  source,
});
export const candidatePreviewProfile = (id: string) => profiles.get(id);

export const candidatePreviewServices: CandidateSearchServices = {
  async getElections() {
    return elections;
  },
  async suggest(address) {
    if (address.trim().length < 4) return [];
    return [
      {
        id: 'preview-address',
        label: '350 S 5th St, Minneapolis, MN 55415',
        address: '350 S 5th St, Minneapolis, MN 55415',
      },
    ];
  },
  async lookup(request, signal) {
    const scenario = candidatePreviewSettings.scenario;
    // Artificial delay is a review control, never product behavior.
    if (candidatePreviewSettings.slow)
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(resolve, 1800);
        signal.addEventListener(
          'abort',
          () => {
            clearTimeout(timer);
            reject(new Error('Aborted'));
          },
          { once: true },
        );
      });
    if (signal.aborted) throw new Error('Aborted');
    if (scenario === 'failure') throw new Error('Illustrative failure');
    if (scenario === 'ambiguous' && !request.confirmedChoice)
      return {
        kind: 'ambiguous',
        choices: [
          {
            id: 'preview-choice-1',
            label: '350 S 5th St, Minneapolis, MN 55415',
            address: '350 S 5th St, Minneapolis, MN 55415',
          },
          {
            id: 'preview-choice-2',
            label: '350 5th St N, Minneapolis, MN 55401',
            address: '350 5th St N, Minneapolis, MN 55401',
          },
        ],
      };
    if (scenario === 'no-match' || scenario === 'outside-minnesota' || scenario === 'rate-limited')
      return { kind: scenario };
    const electionRaces =
      request.electionId === elections[0].id
        ? races
        : request.electionId === 'preview-primary'
          ? primaryRaces
          : [
              {
                id: 'preview-special-school',
                group: 'school' as const,
                office: 'School Board Member',
                votingArea: 'Illustrative special-election district',
                entries: [
                  {
                    kind: 'candidate' as const,
                    candidate: profiles.get('preview-special-alex')!.candidate,
                  },
                ],
                source,
              },
            ];
    return {
      kind: 'results',
      electionId: request.electionId,
      matchedAddress: request.confirmedChoice?.address ?? request.address,
      races: scenario === 'empty' ? [] : electionRaces,
      coverage:
        scenario === 'partial' || scenario === 'empty'
          ? [
              {
                kind: 'records-unavailable',
                office: 'City council',
                authority: 'Local election office',
                url: source.url,
              },
            ]
          : [],
    };
  },
};
export const candidatePreviewFlow = createCandidateFlow(candidatePreviewServices);
