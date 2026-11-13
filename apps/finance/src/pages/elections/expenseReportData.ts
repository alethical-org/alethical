/** Expense report wire values stay exact until display. No identity or party
 * inference happens here; account memberships and figure checks come from API. */
import { apiPath } from '../../api/read';
import type { Page, RetainedSource } from './data';
import { periodLabel } from './format';
import { reportTypeLabel } from './externalData';
import type {
  Binding,
  ExternalFigure,
  ExternalAccount,
  ExternalAccountIdentity,
  SourceFieldGap,
  ReportVersion,
} from './externalData';

export type Party = 'R' | 'DFL' | 'NP' | 'other' | 'unknown';
export type Geography = 'MN' | 'out_of_state' | 'unknown';
export interface Amounts {
  paid: string;
  unpaid: string;
  in_kind: string;
  total: string;
}
export interface SourceLocation {
  source_sha256: string;
  page?: number;
  line?: number;
  text?: string;
  locator?: Binding['locator'];
  quote?: string;
  source_copied_at?: string;
  source_url?: string;
}
export interface PartySource {
  kind: string;
  source_sha256: string;
  row_number: number | null;
  candidate_id: string;
  party_value: string;
  availability: string;
}
export interface Claim {
  race_id: string;
  candidate_id: string;
  name: string;
  filed_party: string | null;
  party_group: Party;
  party_sources?: PartySource[];
}
export interface Candidate extends Claim {
  external_accounts?: Array<ExternalAccount & { authority_name: string }>;
  external_coverage?: { status: string };
  external_account_gaps?: Array<{
    authority: string;
    account_id: string;
    state: string;
  }>;
  office: string;
  district: string | null;
  jurisdiction: string;
  candidate_source_sha256: string | null;
  party_sources: PartySource[];
  filing_authority: string;
  confirmed_account_count: number;
  accounts: Array<{
    registration_number: string;
    report_key: string;
    committee_name: string | null;
    account_filed_party: string | null;
    checked_on: string | null;
  }>;
  gaps: Array<{ state: string; registration_number?: string }>;
}
export interface Filing {
  filing_year: number;
  report_type: string;
  report_name: string;
  cut_off_date: string;
  special_election: boolean;
  effective_amendment_index: number | null;
  amendment_count: number | null;
}
export interface AccountReport {
  received_date?: string | null;
  registration_number: string;
  report_key: string;
  claims: Claim[];
  display_claims: Claim[];
  party_group: Party;
  party_classification_state:
    | 'single_ballot_party'
    | 'mixed_ballot_parties'
    | 'ballot_party_not_in_source'
    | 'membership_sources_unavailable';
  filing: Filing;
  period_start: string | null;
  period_end: string | null;
  source: {
    sha256: string;
    document: RetainedSource;
    retained_source_url: string;
  };
  figure_status: string;
  campaign_expenses: Amounts | null;
  expense_source: { page: number; summary_lines: number[] };
  public_subsidy: {
    cash: string;
    total: string;
    source_page: number;
    source_lines: number[];
  } | null;
  public_subsidy_gap: string | null;
  detail_status: string;
  detail_gap: string | null;
  itemized_totals: Amounts | null;
  non_itemized_totals: Amounts | null;
  checked_detail_before_exclusions: Amounts | null;
  checked_detail_after_exclusions: Amounts | null;
  detail_gaps: string[];
}
export interface ReportOption {
  authority?: string;
  authority_name?: string;
  account_id?: string;
  report_type?: string | null;
  received_date?: string | null;
  report_key: string;
  collection_id: string;
  filing: Omit<Partial<Filing>, 'report_type' | 'report_name'> & {
    report_type: string | null;
    report_name: string | null;
    cut_off_date: string;
  };
  period_start: string | null;
  period_end: string | null;
  period_basis: string | null;
  document_hash: string;
  selected: boolean;
  source_state: 'available' | 'unavailable' | 'not_checked';
}
export interface PayeeIdentity {
  name: string | null;
  address: {
    as_filed?: string | null;
    lines?: string[];
    street?: string | null;
    city?: string | null;
    state?: string | null;
    postal_code?: string | null;
    geography_status?: string;
  };
  source: SourceLocation[];
}
export interface Payee {
  authority?: string;
  authority_name?: string;
  reported_amounts?: ReportedAmount[];
  memo_detail_count?: number;
  payee_id: string | null;
  payee: PayeeIdentity | null;
  geography: Geography;
  excludable: boolean;
  report_keys: string[];
  purposes: string[];
  source: SourceLocation[];
  payment_count: number;
  amounts: Amounts | null;
}
export interface Payment {
  authority?: string;
  authority_name?: string;
  account_id?: string;
  measure?: string;
  measure_label?: string;
  basis?: string;
  reported_amount?: string | null;
  currency?: string;
  amount_role?: string;
  nonadditive?: boolean;
  transaction_type?: string;
  record_id: string;
  registration_number: string;
  report_key: string;
  claims: Claim[];
  party_group: Party;
  period_start: string | null;
  period_end: string | null;
  payee_id: string | null;
  payee: PayeeIdentity | null;
  underlying_vendor: PayeeIdentity | null;
  relationship: string;
  geography: Geography;
  date: string | null;
  raw_date: string | null;
  purpose: string | null;
  amounts: Amounts | null;
  source: SourceLocation[];
  payee_header_source: SourceLocation | null;
  uncertainties: string[];
}
export interface DetailTotals {
  available_account_reports: number;
  amounts: Amounts | null;
  payment_count: number;
  by_party: Record<Party, { available_account_reports: number; amounts: Amounts | null }>;
  by_filed_address: Record<Geography, Amounts | null>;
}
export interface ExpenseAnswer {
  external_generation_id?: string | null;
  external_version?: string | null;
  external_status?: string;
  authority_reports?: AuthorityReport[];
  authority_summary?: AuthoritySummary[];
  schema_version: number;
  election_key: string;
  election_date: string;
  snapshot_id: string;
  collection_id: string;
  version: string;
  copied_at: string;
  reporting_scope: string;
  filters: ExpenseQuery;
  coverage: {
    named_candidacies: number;
    scoped_candidacies: number;
    scoped_candidacies_with_confirmed_accounts: number;
    selected_account_reports: number;
    checked_detail_account_reports: number;
    external_selected_account_reports?: number;
  };
  summary: {
    authority?: string;
    authority_name?: string;
    candidacy_counts_by_ballot_party: Record<Party, number>;
    source_report_totals: {
      available_accounts: number;
      amounts: Amounts | null;
    };
    public_subsidy_receipts: {
      available_accounts: number;
      amount: string | null;
    };
    baseline_checked_itemized_detail: DetailTotals;
    adjusted_checked_itemized_detail: DetailTotals;
    visible_checked_itemized_detail: DetailTotals;
    non_itemized_on_checked_detail_reports: Amounts | null;
    withheld_detail_accounts: number;
    periods: Array<{
      registration_number: string;
      report_key: string;
      start: string | null;
      end: string | null;
    }>;
  };
  candidates?: Candidate[];
  payees?: Payee[];
  payments?: Payment[];
  account_reports: AccountReport[];
  excluded_payees?: Array<{
    authority?: string;
    authority_name?: string;
    reported_amounts?: ReportedAmount[];
    payee_id: string;
    payee: PayeeIdentity;
    geography: Geography;
    payment_count: number;
    amounts: Amounts | null;
    account_reports: Array<{
      authority?: string;
      authority_name?: string;
      account_id?: string;
      reported_amounts?: ReportedAmount[];
      registration_number: string;
      report_key: string;
      claims: Claim[];
      party_group: Party;
      period_start: string | null;
      period_end: string | null;
      payment_count: number;
      amounts: Amounts | null;
    }>;
  }>;
  report_options: Array<{
    authority?: string;
    authority_name?: string;
    account_id?: string;
    registration_number: string;
    reports: ReportOption[];
  }>;
  page: Omit<Page, 'has_more'>;
}
export interface ReportedAmount {
  authority: string;
  report_key: string;
  measure: string;
  label: string;
  basis: string;
  period_start: string | null;
  period_end: string | null;
  currency: string;
  amount: string | null;
}
export interface AuthorityReport extends ExternalAccountIdentity, ReportVersion {
  authority: string;
  authority_name: string;
  account_name: string;
  report_key: string;
  source_report_id: string | null;
  report_type: string | null;
  period_start: string | null;
  period_end: string | null;
  received_date?: string | null;
  claims: Claim[];
  display_claims: Claim[];
  party_group: Party;
  party_classification_state: string;
  reported_measures: ExternalFigure[] | null;
  source_field_gaps?: SourceFieldGap[];
  unavailable_measures?: Array<{ measure: string; state: string }>;
  withheld_measures?: Array<{ measure: string; state: string }>;
  reported_itemized_before_exclusions: ReportedAmount[] | null;
  reported_itemized_after_exclusions: ReportedAmount[] | null;
  public_subsidy: null;
  public_subsidy_gap: string;
  detail_status: string;
  detail_gap: string;
  memo_detail_count: number;
  sources: Binding[];
}
export interface AuthoritySummary extends ReportedAmount {
  authority_name: string;
  account_id: string;
  baseline: string | null;
  adjusted: string | null;
  by_party: Record<Party, { baseline: string | null; adjusted: string | null }>;
  by_filed_address: Record<Geography, { baseline: string | null; adjusted: string | null }>;
}
export interface ExpenseQuery {
  race_id?: string | null;
  candidate_id?: string | null;
  candidate_query?: string;
  report_keys?: string[];
  selected_only?: boolean;
  excluded_payee_ids?: string[];
  payee_query?: string;
  party?: Party | null;
  geography?: Geography | null;
}
export interface Pins {
  snapshot_id: string;
  version: string;
}
export const PAGE_SIZE = 50;
export const PARTY_LABELS: Record<Party, string> = {
  R: 'Republican',
  DFL: 'Democratic',
  NP: 'Nonpartisan',
  other: 'Other parties',
  unknown: 'Party not reported',
};
export const partyLabel = (literal: string | null) =>
  ({
    R: 'Republican',
    DFL: 'Democratic',
    NP: 'Nonpartisan',
    IND: 'Independent',
  })[literal ?? ''] ??
  literal ??
  'Party not reported';
export const claimKey = (claim: Pick<Claim, 'race_id' | 'candidate_id'>) =>
  `${claim.race_id}:${claim.candidate_id}`;
const hash = /^[a-f0-9]{64}$/;
export const exactKeys = (value: string, max: number) => {
  const keys = value ? [...new Set(value.split(','))] : [];
  return keys.length <= max && keys.every((key) => hash.test(key)) ? keys : null;
};
export const validQuery = (value: string) => value.length <= 200 && !value.includes('\0');
export function expensePath(
  election: string,
  endpoint: '' | 'payees' | 'payments' | 'export',
  query: ExpenseQuery,
  pins?: Pins | null,
  offset = 0,
  payeeId?: string,
  unnamedReportKey?: string,
) {
  const path = apiPath([
    'finance',
    'elections',
    election,
    'analytics',
    'expenses',
    ...(endpoint ? [endpoint] : []),
  ]);
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries({
    ...query,
    ...pins,
    limit: PAGE_SIZE,
    offset,
    payee_id: payeeId,
    unnamed_report_key: unnamedReportKey,
    ...(endpoint === 'export' ? { format: 'csv' } : {}),
  })) {
    if (Array.isArray(value)) for (const entry of value) search.append(key, entry);
    else if (value !== undefined && value !== null && value !== '') search.set(key, String(value));
  }
  return `${path}?${search}`;
}
/** Exact cents, including credits; never use binary floats to combine figures. */
export function sumMoney(values: Array<string | null | undefined>): string | null {
  if (!values.length || values.some((value) => value == null || !/^-?\d+(\.\d+)?$/.test(value)))
    return null;
  const scale = Math.max(2, ...values.map((value) => value!.split('.')[1]?.length ?? 0));
  const unit = 10n ** BigInt(scale);
  const cents = values.reduce((total, value) => {
    const [whole, fraction = ''] = value!.replace('-', '').split('.');
    return (
      total +
      (value!.startsWith('-') ? -1n : 1n) *
        (BigInt(whole) * unit + BigInt(fraction.padEnd(scale, '0')))
    );
  }, 0n);
  const absolute = cents < 0n ? -cents : cents;
  return `${cents < 0n ? '-' : ''}${absolute / unit}.${String(absolute % unit).padStart(scale, '0')}`;
}
export function adjustedReportTotal(account: AccountReport): string | null {
  if (account.detail_status !== 'checked') return null;
  return sumMoney([
    account.checked_detail_after_exclusions?.total,
    account.non_itemized_totals?.total,
  ]);
}
export function addressLines(payee: PayeeIdentity | null): string[] {
  const address = payee?.address;
  if (!address) return ['Address not shown'];
  if (address.as_filed) return address.as_filed.split(/\r\n|\r|\n/);
  const city = [address.city, address.state, address.postal_code].filter(Boolean).join(' ');
  const street = address.street;
  if (!city && !street && address.lines?.length) return address.lines;
  if (!city && !street) return ['Address not shown'];
  return [street || 'Street address not shown', ...(city ? [city] : [])];
}

export function addressText(payee: PayeeIdentity | null): string {
  return payee?.address?.as_filed ?? addressLines(payee).join(', ');
}
/** Restrict overrides to the exact accounts in a detail-discovery scope. All
 * governing memberships remain server-owned and are never reclassified here. */
export function scopedReportKeys(
  data: ExpenseAnswer,
  selected: string[],
  matches: (claim: Claim) => boolean,
) {
  const accounts = new Set([
    ...data.account_reports
      .filter((account) => account.display_claims.some(matches))
      .map((account) => `mn_cfb:${account.registration_number}`),
    ...(data.authority_reports ?? [])
      .filter((account) => account.display_claims.some(matches))
      .map((account) => `${account.authority}:${account.account_id}`),
  ]);
  return data.report_options
    .filter((group) =>
      accounts.has(
        `${group.authority ?? 'mn_cfb'}:${group.account_id ?? group.registration_number}`,
      ),
    )
    .flatMap((group) =>
      group.reports
        .filter((report) => selected.includes(report.report_key))
        .map((report) => report.report_key),
    );
}
export const reportLabel = (report: Pick<ReportOption, 'filing' | 'period_start' | 'period_end'>) =>
  `${reportTypeLabel(report.filing.report_name || report.filing.report_type)} · ${periodLabel(report.period_start, report.period_end)}${(report.filing.effective_amendment_index ?? 0) > 0 ? ` · Amended report ${report.filing.effective_amendment_index}` : ''}`;
export function optionGroups(data: ExpenseAnswer) {
  const groups = new Map<string, { label: string; keys: string[] }>();
  for (const account of data.report_options)
    for (const report of account.reports) {
      const key = [
        account.authority ?? 'mn_cfb',
        report.filing.filing_year,
        report.filing.report_name || report.filing.report_type,
        report.filing.cut_off_date,
        report.period_start,
        report.period_end,
      ].join('|');
      const group = groups.get(key) ?? {
        label: `${account.authority_name ? `${account.authority_name} · ` : ''}${reportTypeLabel(report.filing.report_name || report.filing.report_type)} · ${periodLabel(report.period_start, report.period_end)}`,
        keys: [],
      };
      group.keys.push(report.report_key);
      groups.set(key, group);
    }
  // A choice can never send two reports for one account; the API repeats this check.
  return [...groups.values()]
    .filter(
      (group) =>
        group.keys.length <= 500 &&
        data.report_options.every(
          (account) =>
            account.reports.filter((report) => group.keys.includes(report.report_key)).length <= 1,
        ),
    )
    .sort((a, b) => a.label.localeCompare(b.label));
}
export function copyExpenseLink(location: URL): string {
  const allowed = new Set([
    'election',
    'race',
    'q',
    'list',
    'page',
    'from',
    'fromq',
    'view',
    'report',
    'expenseQuery',
    'expenseReports',
    'expenseExcluded',
    'expenseCandidate',
    'expenseCandidatePage',
    'expensePayeePage',
    'expensePaymentsPage',
    'expensePayeeQuery',
    'expenseSearchPage',
    'expensePayee',
    'expenseSource',
  ]);
  const url = new URL(location.pathname, location.origin);
  for (const [key, value] of location.searchParams)
    if (allowed.has(key)) url.searchParams.append(key, value);
  return url.href;
}
