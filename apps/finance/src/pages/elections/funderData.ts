import { apiPath } from '../../api/read';
import type { Page } from './data';
import type { Binding, ReportVersion } from './externalData';

export type Metric =
  | 'direct_contributions'
  | 'independent_For'
  | 'independent_Against'
  | 'independent_unknown'
  | 'other_receipts';
export interface Measure {
  state: 'no_records' | 'amount_unavailable' | 'reported';
  record_count: number;
  amount: string | null;
  known_amount_subtotal: string | null;
  missing_amount_count: number;
  withheld_reason?:
    'source_specific_reporting_periods' | 'source_currency_not_usd' | 'overlapping_source_periods';
}
export interface OutcomeCounts {
  candidacies: number;
  elected: number;
  not_elected: number;
  pending: number;
}
export interface Source {
  source_family?: string;
  generation_id?: string;
  source_sha256?: string;
  snapshot_id: string;
  content_hash: string;
  source_url: string;
  copied_at: string | null;
  retained_source_url: string;
  retained_original_state: string;
}
export interface Scope {
  race_id?: string | null;
  funder_id?: string | null;
  q?: string;
  start_date?: string | null;
  end_date?: string | null;
}
export interface Pins {
  snapshot_id: string;
  version: string;
}
export interface Context extends Pins {
  source_scopes?: {
    mn_cfb: { status: string };
    external: {
      status: string;
      generation_id?: string;
      version?: string;
      authorities?: Array<{ key: string; name: string }>;
      coverage?: unknown[];
    };
  };
  external_sources?: Array<{
    generation_id: string;
    source_sha256: string;
    authority: string;
    url?: string;
    copied_at?: string;
    media_type?: string;
  }>;
  election_key: string;
  election_date: string;
  release_id: string;
  reported_year: number;
  sources: Record<string, Source>;
  filters: Scope;
  scope_note: string;
}
export interface Funder {
  source_family?: string;
  authority?: string;
  source_account_id?: string;
  source_measures?: NativeMeasure[];
  funder_id: string;
  registration_number: string | null;
  names: string[];
  identity_state: string;
  recorded_classifications: Array<{
    category: string;
    recorded_type: string | null;
    recorded_subtype: string | null;
  }>;
  amounts: Record<Exclude<Metric, 'other_receipts'>, Measure>;
  supported_outcomes: OutcomeCounts;
  opposed_outcomes: OutcomeCounts;
  support_count_review: { state: string };
}
export interface OutcomeEvidence {
  sha256: string;
  url: string;
  authority: string;
  fetched_at: string;
  locator: { page?: number; line_start?: number; line_end?: number };
  quote?: string;
}
export interface Candidate {
  race_id: string;
  race_label: string;
  district?: string | null;
  candidate_id: string;
  name: string;
  party: string | null;
  votes: number | null;
  outcome: string | null;
  outcome_status: string;
  result_status: string;
  supported: boolean;
  opposed: boolean;
  evidence: OutcomeEvidence[];
  candidate_source_sha256: string | null;
  candidate_source_row: number | null;
  amounts: Record<Exclude<Metric, 'other_receipts'>, Measure>;
}
export interface Payment extends ReportVersion {
  currency?: string | null;
  record_id?: string;
  source_family?: string;
  authority?: string;
  source_account_id?: string;
  external_generation_id?: string;
  report_key?: string;
  source_report_id?: string;
  source_row_id?: string;
  direction?: string;
  transaction_type?: string;
  amount_role?: string;
  nonadditive?: boolean;
  effective?: boolean | null;
  version_scope?: string;
  amendment_status?: string;
  period_start?: string;
  period_end?: string;
  source_bindings?: Binding[];
  dataset: string;
  row_number: number | null;
  funder_id: string;
  funder_name: string | null;
  date: string | null;
  amount: string | null;
  metric: Metric | `external_${string}`;
  resolution: string;
  fields: Record<string, string | number | null>;
  claims: Array<{ race_id: string; candidate_id: string }>;
  related_candidacies: Array<{ race_id: string; candidate_id: string }>;
  source:
    | Source
    | {
        source_family: 'external';
        generation_id: string;
        content_hash: string;
        source_sha256: string;
        source_url: string | null;
        copied_at: string | null;
        retained_original_state: string;
      };
}
export interface NativeMeasure extends ReportVersion {
  authority: string;
  account_id: string;
  report_key: string;
  source_report_id: string;
  measure: string;
  label: string;
  direction: string;
  transaction_type: string;
  period_start: string;
  period_end: string;
  currency: string;
  basis: string;
  effective: boolean | null;
  version_scope?: string;
  amendment_status?: string;
  nonadditive: boolean;
  attribution: string;
  state: string;
  amount: string | null;
  record_count: number;
  sources: Binding[];
}
export interface FundersAnswer extends Context {
  funders: Funder[];
  page: Page;
}
export interface CandidatesAnswer extends Context {
  candidates: Candidate[];
  page: Page;
}
export interface RecordsAnswer extends Context {
  rows: Payment[];
  page: Page;
}
export const PAGE_SIZE = 50;
export const metricLabels: Record<Metric, string> = {
  direct_contributions: 'Direct contributions',
  independent_For: 'Independent spending for',
  independent_Against: 'Independent spending against',
  independent_unknown: 'Independent spending, position not stated',
  other_receipts: 'Other receipts',
};
export const resultLabel = (status: string) =>
  ({
    unofficial: 'Unofficial results',
    certified: 'Certified results',
    recount: 'Recount',
    tie: 'Tie',
  })[status] ?? 'Result status unavailable';
export function analyticsPath(
  election: string,
  section: 'funders' | 'candidates' | 'records' | 'export',
  scope: Scope,
  pins?: Pins | null,
  offset = 0,
  extra: Record<string, string | number | undefined> = {},
) {
  return apiPath(['finance', 'elections', election, 'analytics', section], {
    ...scope,
    ...pins,
    limit: PAGE_SIZE,
    offset,
    ...extra,
    ...(section === 'export' ? { format: 'csv' } : {}),
  });
}
export function inputDate(value: string): string | null {
  if (!value) return '';
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value);
  if (!match) return null;
  const iso = `${match[3]}-${match[1]}-${match[2]}`;
  const date = new Date(`${iso}T12:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === iso ? iso : null;
}
export const dateInput = (value: string) =>
  /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? `${value.slice(5, 7)}/${value.slice(8, 10)}/${value.slice(0, 4)}`
    : value;
/** Source and download routes are constructed here, never accepted from documents. */
export function sourcePath(context: Context, dataset: string) {
  if (!['contributions', 'expenditures', 'independent_expenditures'].includes(dataset)) return null;
  return apiPath(['finance', 'elections', context.election_key, 'analytics', 'sources', dataset], {
    snapshot_id: context.snapshot_id,
    version: context.version,
  });
}
