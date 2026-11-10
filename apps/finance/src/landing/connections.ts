/** The nine runs in Product Landing, note 1. Labels describe supported paths,
 * not causes, payments, or a claim that distinct records are the same entity. */
export const RECORD_LABELS = {
  contributors: 'Contributors',
  funds: 'Committees and Funds',
  parties: 'Party Units',
  contributions: 'Contributions',
  campaigns: 'Campaign committees',
  candidates: 'Candidates',
  races: 'Races and results',
  precincts: 'Precinct results',
  outside: 'Outside spending',
  spending: 'Campaign spending',
  recipients: 'Payment recipients',
  agencies: 'Media agencies',
  signers: 'Buyers and signers',
  buys: 'TV ad buys',
  stations: 'Stations',
  people: 'People',
  roles: 'Roles and affiliations',
  officers: 'Officers',
  lobbyists: 'Lobbyists',
  legislators: 'Legislators',
  employers: 'Employers and firms',
  organizations: 'Organizations',
  clients: 'Lobbying clients',
  lobbying: 'Lobbying spending',
  committees: 'Legislative committees',
  votes: 'Recorded votes',
  bills: 'Bills',
  testimony: 'Testimony',
  issues: 'Issues and regulatory activity',
} as const;

const RELATION_LABELS = {
  supports: 'Supports',
  opposes: 'Opposes',
  authored: 'Authored',
  action: 'Committee action',
  involvement: 'Documented involvement',
} as const;

type RecordKind = keyof typeof RECORD_LABELS;
type RelationKind = keyof typeof RELATION_LABELS;
type AlternateNode = 'opposed' | 'recipientFunds' | 'recipientParties';
type NodeId = RecordKind | RelationKind | AlternateNode;
// Columns are zero-based. Rows are half the vertical pitch to allow centered fans.
type Placement = readonly [id: NodeId, column: number, row: number];
type Connection = readonly [from: RecordKind, to: RecordKind | AlternateNode, via?: RelationKind];
export interface Run {
  id: string;
  columns: number;
  nodes: readonly Placement[];
  connections: readonly Connection[];
}

export const GROUPS: readonly { title: string; runs: readonly Run[] }[] = [
  {
    title: 'Money',
    runs: [
      {
        id: 'giving',
        columns: 5,
        nodes: [
          ['contributors', 0, 0],
          ['funds', 0, 2],
          ['parties', 0, 4],
          ['contributions', 1, 2],
          ['campaigns', 2, 0],
          ['recipientFunds', 2, 2],
          ['recipientParties', 2, 4],
          ['candidates', 3, 0],
          ['races', 4, 0],
          ['precincts', 4, 2],
        ],
        connections: [
          ['contributors', 'contributions'],
          ['funds', 'contributions'],
          ['parties', 'contributions'],
          ['contributions', 'campaigns'],
          ['contributions', 'recipientFunds'],
          ['contributions', 'recipientParties'],
          ['campaigns', 'candidates'],
          ['candidates', 'races'],
          ['races', 'precincts'],
        ],
      },
      {
        id: 'outside-spending',
        columns: 4,
        nodes: [
          ['funds', 0, 1],
          ['parties', 0, 3],
          ['outside', 1, 2],
          ['supports', 2, 0],
          ['opposes', 2, 2],
          ['races', 2, 4],
          ['candidates', 3, 0],
          ['opposed', 3, 2],
        ],
        connections: [
          ['funds', 'outside'],
          ['parties', 'outside'],
          ['outside', 'candidates', 'supports'],
          ['outside', 'opposed', 'opposes'],
          ['outside', 'races'],
        ],
      },
      {
        id: 'campaign-spending',
        columns: 3,
        nodes: [
          ['campaigns', 0, 0],
          ['funds', 0, 2],
          ['parties', 0, 4],
          ['spending', 1, 2],
          ['recipients', 2, 2],
        ],
        connections: [
          ['campaigns', 'spending'],
          ['funds', 'spending'],
          ['parties', 'spending'],
          ['spending', 'recipients'],
        ],
      },
      {
        id: 'tv-buys',
        columns: 3,
        nodes: [
          ['campaigns', 0, 0],
          ['funds', 0, 2],
          ['parties', 0, 4],
          ['agencies', 0, 6],
          ['signers', 0, 8],
          ['buys', 1, 4],
          ['stations', 2, 3],
          ['spending', 2, 5],
        ],
        connections: [
          ['campaigns', 'buys'],
          ['funds', 'buys'],
          ['parties', 'buys'],
          ['agencies', 'buys'],
          ['signers', 'buys'],
          ['buys', 'stations'],
          ['buys', 'spending'],
        ],
      },
    ],
  },
  {
    title: 'People and organizations',
    runs: [
      {
        id: 'people',
        columns: 3,
        nodes: [
          ['people', 0, 9],
          ['roles', 1, 0],
          ['officers', 1, 4],
          ['contributors', 1, 8],
          ['lobbyists', 1, 10],
          ['legislators', 1, 12],
          ['candidates', 1, 14],
          ['recipients', 1, 16],
          ['signers', 1, 18],
          ['employers', 2, 0],
          ['campaigns', 2, 2],
          ['funds', 2, 4],
          ['parties', 2, 6],
        ],
        connections: [
          ['people', 'roles'],
          ['people', 'officers'],
          ['people', 'contributors'],
          ['people', 'lobbyists'],
          ['people', 'legislators'],
          ['people', 'candidates'],
          ['people', 'recipients'],
          ['people', 'signers'],
          ['roles', 'employers'],
          ['officers', 'campaigns'],
          ['officers', 'funds'],
          ['officers', 'parties'],
        ],
      },
      {
        id: 'organizations',
        columns: 2,
        nodes: [
          ['organizations', 0, 5],
          ['contributors', 1, 0],
          ['recipients', 1, 2],
          ['employers', 1, 4],
          ['clients', 1, 6],
          ['agencies', 1, 8],
          ['stations', 1, 10],
        ],
        connections: [
          ['organizations', 'contributors'],
          ['organizations', 'recipients'],
          ['organizations', 'employers'],
          ['organizations', 'clients'],
          ['organizations', 'agencies'],
          ['organizations', 'stations'],
        ],
      },
      {
        id: 'lobbying',
        columns: 3,
        nodes: [
          ['lobbyists', 0, 0],
          ['lobbying', 0, 4],
          ['employers', 1, 2],
          ['clients', 2, 2],
        ],
        connections: [
          ['lobbyists', 'employers'],
          ['lobbyists', 'clients'],
          ['lobbying', 'clients'],
          ['employers', 'clients'],
        ],
      },
    ],
  },
  {
    title: 'Policy and elections',
    runs: [
      {
        id: 'legislators',
        columns: 4,
        nodes: [
          ['legislators', 0, 2],
          ['committees', 1, 0],
          ['votes', 1, 4],
          ['action', 2, 0],
          ['authored', 2, 2],
          ['bills', 3, 1],
        ],
        connections: [
          ['legislators', 'committees'],
          ['legislators', 'votes'],
          ['legislators', 'bills', 'authored'],
          ['committees', 'bills', 'action'],
        ],
      },
      {
        id: 'involvement',
        columns: 3,
        nodes: [
          ['people', 0, 1],
          ['organizations', 0, 3],
          ['testimony', 1, 0],
          ['involvement', 1, 2],
          ['issues', 1, 4],
          ['bills', 2, 2],
        ],
        connections: [
          ['people', 'testimony'],
          ['people', 'bills', 'involvement'],
          ['people', 'issues'],
          ['organizations', 'testimony'],
          ['organizations', 'bills', 'involvement'],
          ['organizations', 'issues'],
        ],
      },
    ],
  },
];

const ALTERNATE_LABELS = {
  opposed: RECORD_LABELS.candidates,
  recipientFunds: RECORD_LABELS.funds,
  recipientParties: RECORD_LABELS.parties,
} as const;

function recordLabel(id: RecordKind | AlternateNode): string {
  return Object.hasOwn(ALTERNATE_LABELS, id)
    ? ALTERNATE_LABELS[id as AlternateNode]
    : RECORD_LABELS[id as RecordKind];
}

export function relationLabel(id: NodeId): string | undefined {
  return Object.hasOwn(RELATION_LABELS, id) ? RELATION_LABELS[id as RelationKind] : undefined;
}

export function nodeLabel(id: NodeId): string {
  return relationLabel(id) ?? recordLabel(id as RecordKind | AlternateNode);
}

/** Adjacent sources with the same targets share a line in the phone/text map. */
export function namedPaths(run: Run) {
  type Target = readonly [label: string, relation: string | undefined];
  const outgoing = new Map<RecordKind, Target[]>();
  for (const [from, to, via] of run.connections) {
    const target: Target = [recordLabel(to), via && relationLabel(via)];
    const targets = outgoing.get(from);
    if (targets) targets.push(target);
    else outgoing.set(from, [target]);
  }
  const paths: { sources: string[]; targets: Target[] }[] = [];
  for (const [from, targets] of outgoing) {
    const last = paths.at(-1);
    if (
      last &&
      last.targets.length === targets.length &&
      last.targets.every(
        ([label, relation], i) => label === targets[i][0] && relation === targets[i][1],
      )
    ) {
      last.sources.push(recordLabel(from));
    } else {
      paths.push({ sources: [recordLabel(from)], targets });
    }
  }
  return paths;
}
