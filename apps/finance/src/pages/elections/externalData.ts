import { apiPath } from '../../api/read';
import type { Page } from './data';

export interface Binding {
  source_sha256: string;
  locator: Record<string, string | number>;
  quote: string;
  source_copied_at?: string;
  source_url?: string;
}
export interface ExternalContext {
  election_key: string;
  snapshot_id: string;
  generation_id: string;
  version: string;
  copied_at: string;
  authorities: Array<{
    key: string;
    name: string;
    jurisdiction: string;
    status: string;
  }>;
}
export interface ExternalAccount {
  authority: string;
  account_id: string;
  name: string;
  source_candidate_id: string | null;
  checked_on: string;
  period_start: string;
  period_end: string;
}
export interface ExternalFigure {
  measure: string;
  label: string;
  value: string | null;
  unit: string;
  currency?: string;
  period_start: string;
  period_end: string;
  basis: string;
  source_column?: string | number;
  sources: Binding[];
}
export interface ExternalReport {
  report_key: string;
  authority: string;
  account_id: string;
  source_report_id?: string;
  report_type?: string;
  series_id?: string;
  period_start?: string;
  period_end?: string;
  received_date?: string;
  predecessor_report_key?: string | null;
  effective?: boolean | null;
  version_scope?: string;
  amendment_status?: string;
  check_status: string;
  figures: ExternalFigure[] | null;
  withheld_measures?: Array<{ measure: string; state: string }>;
  unavailable_measures?: Array<{ measure: string; state: string }>;
  source_field_gaps?: SourceFieldGap[];
  sources: Binding[];
}
export interface SourceFieldGap {
  measure: string;
  label: string;
  state: string;
  literal: string;
  sources: Binding[];
}
export const fieldGapLabel = (state: string) =>
  ({
    blank: 'Blank in source',
    ambiguous: 'Unclear',
    unreadable: 'Unreadable',
    redacted: 'Redacted in source',
    not_checked: 'Not checked',
    unit_not_in_source: 'Unit not reported',
  })[state] ?? 'Unavailable';
export interface ExternalPayment {
  currency?: string | null;
  payment_key: string;
  authority: string;
  account_id: string;
  report_key: string;
  source_report_id: string;
  source_row_id: string;
  date: string | null;
  payee:
    | string
    | {
        name?: string | null;
        address?: string | null;
        street1?: string | null;
        street2?: string | null;
        city?: string | null;
        state?: string | null;
        zip?: string | null;
      }
    | null;
  purpose: string | null;
  payee_address?: {
    street_1: string | null;
    street_2: string | null;
    city: string | null;
    state: string | null;
    postal_code: string | null;
  } | null;
  payer?: { authority: string; account_id: string; name: string } | null;
  amount: string | null;
  direction: string;
  transaction_type: string;
  memo: Record<string, unknown> | null;
  nonadditive: boolean;
  effective: boolean | null;
  version_scope?: string;
  amendment_status?: string;
  period_start: string;
  period_end: string;
  sources: Binding[];
}
export interface ExternalCandidate extends ExternalContext {
  race_id: string;
  candidate_id: string;
  accounts: ExternalAccount[];
  account_gaps: Array<{ authority: string; account_id: string; state: string }>;
  coverage: {
    status: string;
    status_basis?: string;
    authority?: string;
    sources?: Binding[];
  };
  reports: ExternalReport[];
  payments: ExternalPayment[];
}
export interface ExternalPayments extends ExternalContext {
  race_id: string;
  candidate_id: string;
  rows: ExternalPayment[];
  reports: ExternalReport[];
  page: Page;
}
export const externalCandidatePath = (election: string, race: string, candidate: string) =>
  apiPath([
    'finance',
    'elections',
    election,
    'external-finance',
    'races',
    race,
    'candidates',
    candidate,
  ]);
export const externalSourcePath = (
  context: Pick<ExternalContext, 'election_key' | 'generation_id'>,
  source: string,
) =>
  apiPath(['finance', 'elections', context.election_key, 'external-finance', 'sources', source], {
    generation_id: context.generation_id,
  });
export const accountKey = (account: Pick<ExternalAccount, 'authority' | 'account_id'>) =>
  `${encodeURIComponent(account.authority)}|${encodeURIComponent(account.account_id)}`;
export function reportSelections(raw: string): Map<string, string> | null {
  const result = new Map<string, string>();
  if (!raw) return result;
  for (const part of raw.split(',')) {
    const match = /^([^|,]+\|[^|,]+)\|([a-f0-9]{64})$/.exec(part);
    if (!match || result.has(match[1])) return null;
    result.set(match[1], match[2]);
  }
  return result;
}
export function selectReport(raw: string, account: ExternalAccount, report: string) {
  const result = reportSelections(raw) ?? new Map<string, string>();
  result.set(accountKey(account), report);
  return [...result].map(([key, value]) => `${key}|${value}`).join(',');
}
export function chosenReport(reports: ExternalReport[], requested: string | null) {
  if (requested) return reports.find((r) => r.report_key === requested && inspectableReport(r));
  const effective = reports.filter((r) => r.effective === true && r.period_end);
  const end = effective
    .map((r) => r.period_end!)
    .sort()
    .at(-1);
  const latest = effective.filter((r) => r.period_end === end);
  return latest.length === 1 ? latest[0] : undefined;
}
export const unknownAmendments = (
  report: Pick<ExternalReport, 'effective' | 'version_scope' | 'amendment_status'>,
) =>
  report.effective === null &&
  report.version_scope === 'exact_document' &&
  report.amendment_status === 'not_established';
export const inspectableReport = (report: ExternalReport) =>
  report.effective === true || unknownAmendments(report);
export const coverageLabel = (status: string) =>
  ({
    not_collected: 'Reports not collected',
    retrieval_failed: 'Reports unavailable',
    unreadable: 'Report could not be read',
    unmatched: 'Campaign account not confirmed',
    source_conflict: 'Sources disagree',
    catalogue_checked_not_found: 'No report found in the checked catalogue',
    confirmed_not_published: 'Report not published',
    below_threshold_certified: 'Below-threshold filing held',
    not_due: 'Report not yet due',
    unchecked: 'Reports not checked',
    sources_unavailable: 'Source unavailable',
    period_not_covered: 'Outside checked account dates',
  })[status] ?? 'Report figures unavailable';

export const payeeName = (payee: ExternalPayment['payee']) =>
  typeof payee === 'string' ? payee : (payee?.name ?? null);
export const payeeAddress = (payee: ExternalPayment['payee']) =>
  typeof payee === 'object' && payee
    ? [payee.address ?? payee.street1, payee.street2, payee.city, payee.state, payee.zip]
        .filter(Boolean)
        .join(', ')
    : '';
export const paymentAddress = (payment: ExternalPayment) =>
  payment.payee_address
    ? [
        payment.payee_address.street_1,
        payment.payee_address.street_2,
        payment.payee_address.city,
        payment.payee_address.state,
        payment.payee_address.postal_code,
      ]
        .filter(Boolean)
        .join(', ')
    : payeeAddress(payment.payee);
