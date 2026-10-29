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
  register: {
    state: string;
    kind: string | null;
    name: string | null;
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

export interface MadePayment {
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
