/** The served shapes this page reads. Identities come from Finance's own routes
 * (alethical/api/routers/finance_identities.py, services/identity_confirmations.py);
 * money and lobbying from the shared public routes (public.py, lobbying.py).
 * Only the fields the page prints are listed; every value may be missing. */

export interface IdentitySummary {
  id: string;
  kind: string;
  name: string;
}

export interface ConfirmedRecord {
  fingerprint: string;
  fields: Record<string, string | null> | null;
  rows: number | null;
  in_board_file: boolean | null;
}

export interface IdentityConfirmation {
  id: string;
  identity_id: string;
  record_kind: string;
  record_key: string;
  relation: string | null;
  status: 'confirmed' | 'withdrawn' | string;
  checked_at: string | null;
  basis: string | null;
  evidence: {
    source: string;
    snapshot_id: string | null;
    locator: string | null;
    url: string | null;
    quote: string | null;
  } | null;
  records: ConfirmedRecord[] | null;
}

export interface Identity {
  id: string;
  kind: string;
  name: string;
  status: 'active' | 'merged' | 'split' | string;
  created_at: string | null;
  redirect_to?: string | null;
  split_into?: IdentitySummary[] | null;
  confirmations: IdentityConfirmation[] | null;
}

/** GET finance/identities/records: every record in the Board's current file that
 * prints 1 name, by fingerprint, with the confirmation holding it today. */
export interface RecordsListing {
  record_kind: string;
  record_key: string;
  snapshot_id?: string;
  page?: number;
  pages?: number;
  fingerprints: Array<{
    fingerprint: string;
    fields: Record<string, string | null> | null;
    rows: Array<{ row_number: number; year: number | null }>;
    confirmation: { id: string; identity: IdentitySummary } | null;
  }>;
}

export interface GivenPayment {
  recipient_registration_number: string | null;
  recipient_name: string | null;
  contributor: string | null;
  contributor_type: string | null;
  amount: string | null;
  received_on: string | null;
  year: number | null;
  receipt_type: string | null;
  in_kind: string | null;
  record_number: number;
}

export interface PaidPayment {
  committee_registration_number?: string | null;
  committee_name?: string | null;
  spender?: string | null;
  spender_registration_number?: string | null;
  vendor_name: string | null;
  stance?: string | null;
  amount: string | null;
  paid_on: string | null;
  year: number | null;
  expenditure_type: string | null;
  purpose: string | null;
  record_number: number;
}

export interface NamePage<T> {
  state: 'reported' | 'not_reported' | 'unavailable' | string;
  payments: T[];
  page: { limit: number; offset: number; has_more: boolean; total_payments: number | null };
  linkable_registration_numbers: string[];
  dataset: string;
  source_url: string | null;
  release_id: string;
  fetched_at: string | null;
}

export interface Principal {
  entity_id: number;
  name: string | null;
  copied_at: string | null;
  latest_reported_year: number | null;
  spending: {
    state: string;
    rows: Array<{ year: number; total_spent: string | null }>;
  } | null;
  lobbyists: {
    state: string;
    total: number | null;
    rows: Array<{ registration_number: string; name: string | null }>;
  } | null;
}

export interface CommitteeRegister {
  registration_number: string;
  committee_name: string | null;
  entity_sub_type: string | null;
  register: {
    state: string;
    kind: string | null;
    name: string | null;
    copied_on: string | null;
  } | null;
}
