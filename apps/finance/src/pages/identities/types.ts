/** The shapes Finance's identity routes serve (alethical/api/routers/finance_identities.py,
 * services/identity_confirmations.py and finance_identity_directory.py). Only the
 * fields the page reads are listed; every value may be missing. */

export type PrintedKind = 'donor_name' | 'employer_name' | 'payee_name' | 'independent_payee_name';
export type IdentityKind = 'person' | 'organization';

export interface QueueSource {
  snapshot_id: string;
  source_url: string | null;
  copied_at: string | null;
  file: string;
}

export interface QueueRow extends QueueSource {
  record_kind: PrintedKind;
  record_key: string;
  name: string;
  records: number;
  confirmed: number;
  amount: string | null;
  amount_state: 'reported' | 'incomplete_amount' | 'incomplete_period';
  missing_amounts: number;
  undated_records: number;
  period_basis: 'dates' | 'years' | null;
  first_year: number | null;
  last_year: number | null;
  first_date: string | null;
  last_date: string | null;
}

export interface QueuePage {
  version?: string;
  rows: QueueRow[];
  page: number;
  page_size: number;
  total: number;
  pages: number;
  sources: Record<string, QueueSource>;
}

export type Fields = Record<string, string | number | null>;

export interface IdentitySummary {
  /** The key in addresses and requests; never printed to readers. */
  id: string;
  /** The label readers see: ORG-0042 or PER-0042. */
  reference?: string | null;
  kind: string;
  name: string;
}

export interface Fingerprint {
  fingerprint: string;
  fields: Fields;
  rows: Array<{ row_number: number; year: number | null }>;
  confirmation: { id: string; identity: IdentitySummary } | null;
  display?: {
    filer_name: string | null;
    filer_registration_number: string | null;
    filer_is_held: boolean;
    record_type: string | null;
    record_types?: string[];
  };
}

export interface RecordsPage {
  record_kind: PrintedKind;
  record_key: string;
  file: string;
  source_url: string | null;
  copied_at: string | null;
  snapshot_id: string;
  records: number;
  confirmed: number;
  page: number;
  page_size: number;
  total_fingerprints: number;
  pages: number;
  years: number[];
  identities: Array<IdentitySummary & { confirmed: number }>;
  /** Original owners with exact-spelling history, never active coverage or merge choices. */
  history_identities?: IdentitySummary[];
  fingerprints: Fingerprint[];
  no_longer_in_board_file: Array<{
    fingerprint: string;
    fields: Fields;
    confirmation: { id: string; identity: IdentitySummary };
  }>;
}

export interface ConfirmedRecord {
  fingerprint: string;
  fields: Fields;
  rows: number | null;
  in_board_file: boolean | null;
}

export interface Confirmation {
  id: string;
  identity_id: string;
  record_kind: string;
  record_key: string;
  relation: string | null;
  status: 'confirmed' | 'withdrawn';
  checked_at: string | null;
  withdrawn_at: string | null;
  withdrawal_reason: string | null;
  /** Where the withdrawal's evidence was found; null when none was given. */
  withdrawal_source?: string | null;
  basis: string | null;
  /** Where the confirmation's evidence was found, apart from the basis. */
  source?: string | null;
  replaces: string | null;
  replaced_by: string | null;
  evidence: {
    source: string;
    snapshot_id: string | null;
    locator: string | null;
    url: string | null;
    quote: string | null;
  } | null;
  /** Null for an identifier (a registration number or held id), confirmed whole. */
  records: ConfirmedRecord[] | null;
}

/** 1 part of a split as it stands today. */
export interface SplitPart extends IdentitySummary {
  status?: 'active' | 'merged' | 'split' | string;
  /** An active part: the Board's current rows its confirmations cover (identical
   * repeated rows each count), plus 1 per identifier. Null when a file is not held,
   * and for a part later merged or split. */
  confirmed_records?: number | null;
  /** A part later merged: the identity standing today, by id and reference. */
  redirect_to?: string | null;
  redirect_to_reference?: string | null;
}

export interface Identity {
  id: string;
  reference?: string | null;
  kind: string;
  name: string;
  status: 'active' | 'merged' | 'split' | string;
  created_at: string | null;
  redirect_to?: string | null;
  redirect_to_reference?: string | null;
  /** In the split's own order, each as it stands today. */
  split_into?: SplitPart[] | null;
  confirmations: Confirmation[];
  printed_names: Array<{
    record_kind: string;
    record_key: string;
    records: number | null;
    confirmed: number | null;
  }>;
  history: Array<{
    action: string;
    at: string | null;
    detail: Record<string, unknown>;
    /** Each identity the event names, by id, with its reference. */
    references?: Record<string, string | null>;
  }>;
}

export interface EntityPage {
  version?: string;
  rows: IdentitySummary[];
  total: number;
  page: number;
  page_size: number;
  pages: number;
}
