/** The served shapes this page reads, from alethical/api/routers/public.py. Only the
 * fields the page prints are listed; every value may be missing and is read as such. */

export type BlockState = 'reported' | 'not_reported' | 'unavailable';

export interface CommitteeFinance {
  registration_number: string;
  committee_name: string | null;
  entity_type: string | null;
  entity_sub_type: string | null;
  year: number;
  payment_copied_at: {
    contributions: string | null;
    expenditures: string | null;
    independent_expenditures: string | null;
  } | null;
  filings_copied_at: string | null;
  /** Server-reviewed notices scoped to this committee, year and current source file. */
  source_notices?: Array<{ key: string; dataset: string; text: string }>;
  register: {
    state: string;
    kind: string | null;
    name: string | null;
    registration_date?: string | null;
    termination_date?: string | null;
    retained?: boolean | null;
    copied_on?: string | null;
  };
  money_in: {
    state: BlockState;
    itemized_contribution_payments: number | null;
    reported_total: string | null;
    reported_through: string | null;
    reported_period_start: string | null;
  };
  money_out: {
    state: BlockState;
    itemized_payments: number | null;
    reported_total: string | null;
    reported_through: string | null;
  };
  /** Absent when the comparison is not proved for this committee-year. */
  stated_by_kind?: StatedByKind;
  /** Absent without a current agreeing check or a usable ZIP reference. */
  donor_states?: DonorStates;
  name_connections?: NameConnections;
}

/** The 5 filed contribution lines beside matching named cash
 * (`alethical/api/services/committee_stated_by_kind.py`). */
export interface StatedByKind {
  state: 'reported' | 'sources_disagree' | string;
  reported_through: string | null;
  lines: Array<{
    line_key: string;
    label_as_filed: string | null;
    stated_total: string | null;
    itemized_cash_total: string | null;
    difference: string | null;
  }>;
}

export interface DonorStateAmounts {
  names: number | null;
  cash_total: string | null;
}

/** Individual cash by ZIP-derived state for a candidate committee-year
 * (`alethical/api/services/committee_donor_states.py`). */
export interface DonorStates {
  state: 'reported' | string;
  year: number;
  rows: Array<DonorStateAmounts & { state: string }>;
  summary: {
    minnesota: DonorStateAmounts;
    other_states: DonorStateAmounts;
    unknown: DonorStateAmounts;
  };
  reference: { source_url?: string; as_of?: string; copied_at?: string };
}

/** Other candidate registrations under exactly the same printed individual name
 * (`alethical/api/services/committee_name_connections.py`). */
export interface NameConnections {
  state: BlockState | string;
  year: number;
  matching?: string;
  numerator: number | null;
  denominator: number | null;
  distribution: Array<{ other_committees: string; names: number }>;
  top_names: Array<{ name: string; other_committees: number }>;
}

export interface Filing {
  report_name: string | null;
  filing_year: number | null;
  period_end: string | null;
  period_start: string | null;
  amendment_count: number | null;
  effective_amendment_index: number | null;
}

export interface Filings {
  state: string;
  filings: Filing[];
}

export interface ReceivedPayment {
  contributor: string | null;
  contributor_registration_number: string | null;
  contributor_type: string | null;
  amount: string | null;
  received_on: string | null;
  receipt_type: string | null;
  in_kind: string | null;
  record_number: number;
}

export interface RecipientTypeSource {
  snapshot_id: string;
  copied_at: string;
  source_url: string;
  retained: boolean;
}

export interface MadePayment {
  recipient_type?: 'candidate_committee' | 'party_unit' | 'political_committee_or_fund' | null;
  recipient_type_source?: RecipientTypeSource | null;
  vendor_name: string | null;
  vendor_city: string | null;
  vendor_state: string | null;
  affected_committee_name: string | null;
  affected_committee_registration_number: string | null;
  amount: string | null;
  paid_on: string | null;
  expenditure_type: string | null;
  purpose: string | null;
  in_kind: string | null;
  record_number: number;
}

export interface IndependentPayment {
  affected_committee_name: string | null;
  affected_committee_registration_number: string | null;
  stance: string | null;
  vendor_name: string | null;
  amount: string | null;
  paid_on: string | null;
  expenditure_type: string | null;
  purpose: string | null;
  record_number: number;
}

export interface AttachedStatementRow {
  record_number: number;
  statement_id: string;
  state: string;
  pdf_url: string;
}

export interface PaymentPage<T> {
  version?: string;
  state: BlockState;
  payments: T[];
  page: { limit: number; offset: number; has_more: boolean; total_payments: number | null };
  linkable_registration_numbers: string[];
  release_id: string;
  fetched_at: string | null;
  disclosure_statements?: AttachedStatementRow[];
  statements_copied_on?: string | null;
}

export interface CommitteeConfirmationAnswer {
  registration_number: string;
  current_claim_validated_at: string | null;
  confirmed_for: {
    legislator_id: string;
    slug: string;
    full_name: string;
  } | null;
}

/** 1 catalogued report of the year, from `/finance/committees/{n}/report-figures`.
 * Figures are served only for the report whose coverage matches the filing the
 * server holds (`figures_state: 'reported'`); every other report's are null. */
export interface ReportFigureRow {
  record_number: number;
  report_name: string | null;
  report_type: string | null;
  cut_off_date: string | null;
  filed_date: string | null;
  effective_amendment_index: number | null;
  special_election: boolean | null;
  period_start: string | null;
  beginning_cash_balance: string | null;
  beginning_balance_as_of: string | null;
  ending_balance_as_of: string | null;
  contributions: string | null;
  total_expenditures: string | null;
  total_disbursements: string | null;
  total_receipts: string | null;
  ending_cash_balance: string | null;
  figures_state: 'reported' | 'unavailable' | string;
  figures_reason?: string | null;
}

export interface ReportFigures {
  registration_number: string;
  year: number;
  state: 'reported' | 'not_reported' | 'unavailable' | string;
  reports: ReportFigureRow[];
}
