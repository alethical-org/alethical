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
  { id: 'preview-general', label: 'General election', date: '2026-11-03', type: 'general' },
  { id: 'preview-special', label: 'Special election', date: '2027-02-09', type: 'special' },
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
const profiles = new Map<string, CandidateProfileRecord>();
for (const race of races)
  for (const entry of race.entries)
    if (entry.kind === 'candidate')
      profiles.set(entry.candidate.id, {
        candidate: entry.candidate,
        election: elections[0],
        office: race.office,
        votingArea: race.votingArea,
        source,
      });
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
