import { formatMoney } from '@alethical/shared/moneyFormat';
import { hrefFor } from '../../routes';
import type { Evidence } from '../../ui/controls';
import { day } from '../media/shared';
import { periodOf } from '../organization/data';

export const RELATIONSHIPS: Record<string, string> = {
  contributions: 'Contributions',
  payments: 'Payments',
  lobbying_representation: 'Lobbying representation',
  campaign_account: 'Campaign account',
  station_advertiser: 'Advertiser on a station file',
  station_payer: 'Payer on a station file',
  station_named: 'Named on a station file',
  station_agency: 'Agency printed on a station file',
};
export interface GraphNode {
  key: string;
  kind: string;
  label: string;
  record_id: string;
  unresolved: boolean;
  role?: string;
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
    url?: string;
    copied_at?: string;
    file_key?: string;
    version_id?: string;
    page?: number;
    quote?: string;
    first_year?: number | null;
    last_year?: number | null;
  };
}
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
export function nodeKind(node: GraphNode) {
  return (
    (
      {
        printed_name: 'Printed name',
        person: 'Person',
        organization: 'Organization',
        committee: 'Committee',
        legislator: 'Legislator',
        candidate: 'Candidate',
        lobbyist: 'Lobbyist',
        principal: 'Principal',
        election: 'Election',
        file: 'Station file',
      } as Record<string, string>
    )[node.kind] ?? node.kind
  );
}
export function nodeHref(node: GraphNode): string | null {
  const target = node.target;
  if (!target) return null;
  switch (target.kind) {
    case 'identity':
      return node.kind === 'person' || node.kind === 'organization'
        ? hrefFor(node.kind, { id: target.id })
        : null;
    case 'committee':
    case 'legislator':
    case 'candidate':
    case 'lobbyist':
    case 'principal':
      return hrefFor(target.kind, { id: target.id });
    case 'file':
      return hrefFor('station-file', { key: target.id }, { version: target.version });
    case 'agency':
      return hrefFor('printed-agency-name', { name: target.id });
    case 'printed_name':
      return ['donor', 'vendor', 'independent_vendor'].includes(target.role ?? '')
        ? hrefFor(
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
export function edgeAmount(edge: GraphEdge) {
  if (edge.amount_state === 'not_applicable') return '';
  if (edge.amount_state === 'incomplete') return 'Incomplete: a payment amount is missing';
  if (edge.amount_state === 'incomplete_period' || edge.period_basis === 'unknown')
    return 'Amount unavailable: payment period is incomplete';
  return formatMoney(edge.amount) ?? 'Amount not given';
}
export function edgePeriod(edge: GraphEdge) {
  if (edge.period_basis === 'years' && edge.first_year !== null && edge.last_year !== null)
    return edge.first_year === edge.last_year
      ? `Year ${edge.first_year}`
      : `Years ${edge.first_year}–${edge.last_year}`;
  if (edge.period_basis === 'dates' && edge.first_date && edge.last_date)
    return periodOf([edge.first_date, edge.last_date])!;
  if (edge.amount_state === 'not_applicable' && edge.source.first_year && edge.source.last_year)
    return edge.source.first_year === edge.source.last_year
      ? `Year ${edge.source.first_year}`
      : `Years ${edge.source.first_year}–${edge.source.last_year}`;
  return edge.amount_state === 'not_applicable'
    ? 'Date not given in the public file'
    : 'Period not available for every payment';
}
export function edgeEvidence(edge: GraphEdge, from: GraphNode, to: GraphNode): Evidence {
  return {
    title: `${from.label} · ${RELATIONSHIPS[edge.relationship] ?? edge.relationship} · ${to.label}`,
    authority: edge.source.file_key
      ? 'TV station file'
      : 'Minnesota Campaign Finance and Public Disclosure Board',
    rows: [
      { label: 'Source', value: edge.source.dataset },
      { label: 'Period', value: edgePeriod(edge) },
      { label: 'Records', value: String(edge.record_count) },
      ...(edge.source.copied_at ? [{ label: 'Copied', value: day(edge.source.copied_at) }] : []),
      ...(edge.source.snapshot_id
        ? [{ label: 'Source copy', value: edge.source.snapshot_id }]
        : []),
      ...(edge.source.version_id
        ? [{ label: 'Source version', value: edge.source.version_id }]
        : []),
      ...(edge.source.page ? [{ label: 'Page', value: String(edge.source.page) }] : []),
    ],
    quote: edge.source.quote,
    checked:
      edge.source.file_key || edge.source.dataset === 'campaign_committee_confirmation'
        ? 'Checked'
        : 'Not checked',
    sourceHref: edge.source.file_key
      ? hrefFor(
          'station-file',
          { key: edge.source.file_key },
          {
            version: edge.source.version_id,
            page: edge.source.page ? String(edge.source.page) : null,
          },
        )
      : edge.source.url,
    sourceLabel: edge.source.file_key ? 'View page image' : 'Open source file',
  };
}
