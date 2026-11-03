import { centralDateLabel, formatCount } from '@alethical/shared/moneyLanding';
import { formatMoney } from '../../ui/money';
import { hrefFor, isBuilt, type RouteName } from '../../routes';
import type { Evidence } from '../../ui/controls';
import { day } from '../media/shared';
import { periodOf } from '../organization/data';

/** Relationships per page: the server's default and the drawing's (Round 37 item 7). */
export const PAGE_SIZE = 100;

/** The Relationship menu's words (Money Connections drawing). "TV station file" names the record. */
export const RELATIONSHIPS: Record<string, string> = {
  contributions: 'Contributions',
  payments: 'Payments',
  lobbying_representation: 'Lobbying representation',
  campaign_account: 'Campaign account',
  station_advertiser: 'Advertiser on a TV station file',
  station_payer: 'Payer on a TV station file',
  station_named: 'Named on a TV station file',
  station_agency: 'Agency printed on a TV station file',
};
export interface GraphNode {
  key: string;
  kind: string;
  label: string;
  record_id: string;
  unresolved: boolean;
  role?: string | null;
  version_id?: string;
  target: { kind: string; id: string; role?: string; version?: string } | null;
}
export interface GraphEdge {
  id: string;
  from: string;
  to: string;
  relationship: string;
  amount: string | null;
  amount_state: 'reported' | 'incomplete' | 'incomplete_period' | 'not_applicable';
  period_basis: 'dates' | 'years' | 'unknown' | 'not_applicable';
  first_date: string | null;
  last_date: string | null;
  first_year: number | null;
  last_year: number | null;
  record_count: number;
  undated_count: number;
  source: {
    dataset: string;
    snapshot_id?: string;
    url?: string | null;
    copied_at?: string | null;
    file_key?: string;
    version_id?: string;
    page?: number | null;
    quote?: string | null;
    first_year?: string | number | null;
    last_year?: string | number | null;
  };
}
/** 1 answer of `GET /api/v1/finance/connections`: 1 page of relationships and
 * the nodes those relationships name. */
export interface ConnectionsPage {
  state: 'reported' | 'not_reported' | 'partial' | 'unavailable';
  nodes: GraphNode[];
  edges: GraphEdge[];
  total: number;
  has_more: boolean;
  limit: number;
  offset: number;
  q: string;
  year: number | null;
  relationship: string | null;
  focus: string | null;
  years: number[];
  relationships: string[];
  unavailable_sources: string[];
}

const KINDS: Record<string, string> = {
  printed_name: 'Printed name',
  person: 'Person',
  organization: 'Organization',
  committee: 'Committee',
  legislator: 'Legislator',
  candidate: 'Candidate',
  lobbyist: 'Lobbyist',
  principal: 'Principal',
  election: 'Election',
  file: 'TV station file',
};
export function nodeKind(node: GraphNode) {
  return KINDS[node.kind] ?? node.kind;
}

/**
 * The line under a name (the drawing's node `sub`): what kind of record it is.
 * A confirmed identity's "printed as {spelling}" needs the printed spelling,
 * which the server does not serve yet. Kinds the drawing gives no words for
 * (legislator, candidate, election, file) have no line.
 */
export function nodeSub(node: GraphNode): string {
  switch (node.kind) {
    case 'person':
      return 'Confirmed person';
    case 'organization':
      return 'Confirmed organization';
    case 'committee':
      return `Registration ${node.record_id}`;
    case 'lobbyist':
      return `Lobbyist registration ${node.record_id}`;
    case 'principal':
      return `Entity ID ${node.record_id}`;
    case 'printed_name':
      return node.role === 'donor'
        ? 'Printed donor name'
        : node.role === 'vendor' || node.role === 'independent_vendor'
          ? 'Printed payee name'
          : node.role === 'agency'
            ? 'Printed agency name'
            : '';
    default:
      return '';
  }
}

/** A Finance address, or null while its screen is off (nothing links to an unbuilt page). */
function built(
  name: RouteName,
  params: Record<string, string>,
  query: Record<string, string | null | undefined> = {},
): string | null {
  return isBuilt(name) ? hrefFor(name, params, query) : null;
}

/** A node's own page, only from the explicit target the server supplies: a
 * printed name never opens a profile, and an identity opens only when the
 * server resolved every record in the group to it. */
export function nodeHref(node: GraphNode): string | null {
  const target = node.target;
  if (!target) return null;
  switch (target.kind) {
    case 'identity':
      return node.kind === 'person' || node.kind === 'organization'
        ? built(node.kind, { id: target.id })
        : null;
    case 'committee':
    case 'legislator':
    case 'candidate':
    case 'lobbyist':
    case 'principal':
      return built(target.kind, { id: target.id });
    case 'file':
      return built('station-file', { key: target.id }, { version: target.version });
    case 'agency':
      return built('printed-agency-name', { name: target.id });
    case 'printed_name':
      return ['donor', 'vendor', 'independent_vendor'].includes(target.role ?? '')
        ? built(
            'payments-under-name',
            { query: target.id },
            {
              role: target.role === 'donor' ? 'donor' : 'payee',
              section:
                target.role === 'vendor'
                  ? 'campaign-payments'
                  : target.role === 'independent_vendor'
                    ? 'outside-payments'
                    : null,
            },
          )
        : null;
    default:
      return null;
  }
}

/** The 1 filing year an edge covers, when it covers exactly 1 (a year filter, or
 * a group filed in 1 year); the year a committee link carries. */
export function edgeYear(edge: GraphEdge): string | null {
  return edge.first_year !== null && edge.first_year === edge.last_year
    ? String(edge.first_year)
    : null;
}

/**
 * Where a committee node opens from an edge (rule eug-19/77: the tab holding
 * the record's kind, the year and the printed name). A payment to a vendor
 * opens the committee's Expenditures tab searched for that payee, an
 * independent expenditure its Independent expenditures card (Round 9); the donor's
 * tab for a contribution needs the donor's kind, which the edge does not carry,
 * so a contribution opens the committee at the year alone.
 */
export function committeeEdgeHref(edge: GraphEdge, committee: GraphNode, other: GraphNode) {
  const href = nodeHref(committee);
  if (!href || committee.kind !== 'committee') return href;
  const year = edgeYear(edge);
  if (edge.relationship === 'payments' && edge.from === committee.key) {
    if (other.role === 'vendor')
      return built(
        'committee',
        { id: committee.record_id },
        { tab: 'expenditures', year, q: other.label },
      );
    if (other.role === 'independent_vendor')
      return built('committee', { id: committee.record_id }, { tab: 'independent', year });
  }
  return built('committee', { id: committee.record_id }, { year });
}

/**
 * The shared total rule (Round 36, 41): a sum only when every amount is held
 * and every date or every filing year is; a missing amount wins. Under an
 * amount heading the withheld total reads "Incomplete"; where no heading names
 * the value it reads "Missing payment amount" (Round 34).
 */
export function edgeAmount(edge: GraphEdge, { heading = false } = {}) {
  if (edge.amount_state === 'not_applicable') return '';
  if (edge.amount_state === 'incomplete') return heading ? 'Incomplete' : 'Missing payment amount';
  if (edge.amount_state === 'incomplete_period' || edge.period_basis === 'unknown')
    return 'Reporting period incomplete';
  return formatMoney(edge.amount) ?? 'Amount not given';
}

function yearSpan(
  first: string | number | null | undefined,
  last: string | number | null | undefined,
) {
  if (first === null || first === undefined || last === null || last === undefined) return null;
  return String(first) === String(last) ? String(first) : `${first} to ${last}`;
}

/** The period line: filing years are labelled as such (Round 41 item 4); dates
 * read as a range; a station file names its page; a campaign account its years. */
export function edgePeriod(edge: GraphEdge) {
  if (edge.period_basis === 'years' && edge.first_year !== null && edge.last_year !== null)
    return edge.first_year === edge.last_year
      ? `Filing year ${edge.first_year}`
      : `Filing years ${edge.first_year}–${edge.last_year}`;
  if (edge.period_basis === 'dates' && edge.first_date && edge.last_date)
    return periodOf([edge.first_date, edge.last_date])!;
  if (edge.amount_state === 'incomplete_period' || edge.period_basis === 'unknown')
    return 'Reporting period incomplete';
  if (edge.relationship.startsWith('station_')) {
    const page = edge.source.page;
    if (page)
      return edge.relationship === 'station_named'
        ? `Named on page ${page}`
        : `${{ station_advertiser: 'Advertiser', station_payer: 'Payer', station_agency: 'Agency' }[edge.relationship]}, as printed on page ${page}`;
    return 'Date not given in the public file';
  }
  if (edge.relationship === 'lobbying_representation')
    return edge.source.copied_at
      ? `Listed ${day(edge.source.copied_at)}`
      : 'Date not given in the public file';
  return (
    yearSpan(edge.source.first_year, edge.source.last_year) ?? 'Date not given in the public file'
  );
}

/** The source's name as the drawings print it (finance-data SNAPSHOTS labels). */
export function sourceLabel(dataset: string) {
  return (
    (
      {
        contributions: 'Contribution file',
        expenditures: 'Expenditure file',
        independent_expenditures: 'Independent expenditure file',
        lobbyist_register: 'Lobbyist registration list',
        lobbying: 'Lobbyist registration list',
        campaign_committee_confirmation: 'Committee registrations',
        station_file: 'TV station file',
        campaign_finance: 'Minnesota Campaign Finance and Public Disclosure Board',
      } as Record<string, string>
    )[dataset] ?? dataset.replaceAll('_', ' ')
  );
}

export function edgeEvidence(edge: GraphEdge, from: GraphNode, to: GraphNode): Evidence {
  return {
    title: `${from.label} · ${RELATIONSHIPS[edge.relationship] ?? edge.relationship} · ${to.label}`,
    authority: edge.source.file_key
      ? 'TV station file'
      : 'Minnesota Campaign Finance and Public Disclosure Board',
    rows: [
      { label: 'Source', value: sourceLabel(edge.source.dataset) },
      { label: 'Period', value: edgePeriod(edge) },
      { label: 'Records', value: String(edge.record_count) },
      // The copy is named by its date, never by its internal id (settled wording row 21).
      ...(edge.source.copied_at
        ? [{ label: 'Source version', value: `Copy of ${day(edge.source.copied_at)}` }]
        : []),
      ...(edge.source.page ? [{ label: 'Page', value: String(edge.source.page) }] : []),
    ],
    quote: edge.source.quote ?? undefined,
    checked:
      edge.source.file_key || edge.source.dataset === 'campaign_committee_confirmation'
        ? 'Checked'
        : 'Not checked',
    sourceHref: edge.source.file_key
      ? (built(
          'station-file',
          { key: edge.source.file_key },
          {
            version: edge.source.version_id,
            page: edge.source.page ? String(edge.source.page) : null,
          },
        ) ?? undefined)
      : (edge.source.url ?? undefined),
    sourceLabel: edge.source.file_key ? 'View page image' : 'Open source file',
  };
}

/** The pages loaded for 1 scope, combined in order: every relationship once,
 * every node once. Map and Table read this same set (Round 37 item 7). */
export function combinePages(pages: ReadonlyArray<ConnectionsPage | undefined>) {
  const nodes = new Map<string, GraphNode>();
  const edges = new Map<string, GraphEdge>();
  let last: ConnectionsPage | null = null;
  for (const page of pages) {
    if (!page) continue;
    last = page;
    for (const node of page.nodes) if (!nodes.has(node.key)) nodes.set(node.key, node);
    for (const edge of page.edges) if (!edges.has(edge.id)) edges.set(edge.id, edge);
  }
  const valid = [...edges.values()].filter((edge) => nodes.has(edge.from) && nodes.has(edge.to));
  return {
    nodes,
    edges: valid,
    total: last?.total ?? 0,
    remaining: last ? Math.max(0, last.total - (last.offset + last.edges.length)) : 0,
    unavailable: last?.unavailable_sources ?? [],
  };
}

/** The count footer (Money connections hierarchy, 27 Oct): counts over the
 * loaded set only, so they never speak for relationships not loaded. */
export function countLine(edges: ReadonlyArray<GraphEdge>, nodes: Map<string, GraphNode>) {
  const named = new Set(edges.flatMap((edge) => [edge.from, edge.to]));
  const shown = [...named].map((key) => nodes.get(key)!).filter(Boolean);
  const confirmed = shown.filter((node) =>
    ['person', 'organization', 'committee'].includes(node.kind),
  ).length;
  const printed = shown.filter((node) => node.unresolved).length;
  return `${formatCount(edges.length)} ${edges.length === 1 ? 'connection' : 'connections'} · ${formatCount(confirmed)} confirmed people, organizations and committees · ${formatCount(printed)} printed ${printed === 1 ? 'name' : 'names'}`;
}

export function moreLabel(remaining: number) {
  const n = Math.min(PAGE_SIZE, remaining);
  return `Show ${formatCount(n)} more ${n === 1 ? 'connection' : 'connections'}`;
}

/** "{loaded} of {total} connections loaded", only once a page is not the whole set. */
export function loadedLine(loaded: number, total: number) {
  return total > PAGE_SIZE
    ? `${formatCount(loaded)} of ${formatCount(total)} connections loaded`
    : '';
}

const BOARD = 'Minnesota Campaign Finance and Public Disclosure Board';
const PAYMENT_FILES: Record<string, string> = {
  contributions: 'contribution file',
  expenditures: 'expenditure file',
  independent_expenditures: 'independent expenditure file',
};

/** The loaded payment files, each named with its own copy date, never 1 combined
 * date (grounded-answers rule 12; settled wording row 74). Null when no loaded
 * payment line carries a copy date. */
export function paymentCopyLine(edges: ReadonlyArray<GraphEdge>): string | null {
  const parts: string[] = [];
  for (const [dataset, words] of Object.entries(PAYMENT_FILES)) {
    const days = new Set<string>();
    for (const edge of edges) {
      const at = edge.source.dataset === dataset ? edge.source.copied_at : null;
      if (at && !Number.isNaN(new Date(at).getTime())) days.add(centralDateLabel(at));
    }
    for (const label of days) parts.push(`${words}, copied ${label}`);
  }
  if (parts.length === 0) return null;
  const note =
    parts.length === 1
      ? 'This is a copy date, not a reporting period.'
      : 'These are copy dates, not reporting periods.';
  return `${BOARD} ${parts.join('; ')}. ${note}`;
}
