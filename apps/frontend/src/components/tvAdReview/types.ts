export type Redaction = {
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
  kind: 'name_withheld' | 'blank';
};
export type SafePage = {
  page: number;
  text: string;
  text_status: 'readable' | 'unreadable' | 'blank';
};
export type SourceVersion = {
  facility_id: string;
  file_id: string;
  content_hash: string;
  station: string;
  first_saved_at: string;
  uploaded_at?: string | null;
  page_count: number;
  source_title: string;
  source_folder: string;
  category: string;
  pages: { page: number; text: string; width?: number; height?: number }[];
  publications?: { id: string; status: string }[];
};
export type ReviewPublication = {
  id: string;
  facility_id: string;
  file_id: string;
  content_hash: string;
  status: string;
  metadata_only?: boolean;
  metadata_approved?: boolean;
  metadata_reviewed_at?: string | null;
  safe_title: string;
  safe_folder: string;
  category: string;
  safe_pages: SafePage[];
  fingerprint: string;
  created_at: string;
  reviewed_at: string | null;
  pages: { page: number; width: number; height: number }[];
};
export type ReviewFact = {
  id: string;
  field: string;
  value: string;
  page: number;
  quote: string;
  publication_approved?: boolean;
  qualifier?: string | null;
  organization_name?: string | null;
  role?: string | null;
  status?: string;
  withdrawn_at?: string | null;
};
export type ReviewConnection = {
  id: string;
  kind: string;
  target_id: string;
  page?: number;
  quote: string;
  scope: string;
  publication_approved?: boolean;
  status?: string;
  withdrawn_at?: string | null;
};
export type ReviewPayload = {
  publication: ReviewPublication;
  facts: ReviewFact[];
  connections: ReviewConnection[];
  events: { id?: string; action: string; created_at: string; evidence?: string }[];
};
export type PrepareCopy = {
  facility_id: string;
  file_id: string;
  content_hash: string;
  safe_title: string;
  safe_folder: string;
  category: string;
  metadata_only?: boolean;
  safe_pages?: SafePage[];
  redactions?: Redaction[];
  evidence: string;
};
export const FACT_FIELDS = [
  'agency_name',
  'organization_address',
  'document_kind',
  'advertiser',
  'payer',
  'order_number',
  'invoice_number',
  'gross_amount',
  'net_amount',
  'commission_rate',
  'commission_amount',
  'invoice_date',
  'start_date',
  'end_date',
  'total_order_amount',
  'paid_amount',
  'credit_amount',
  'officer_name',
  'officer_role',
  'principal',
  'issue',
  'scheduled_airing',
  'billing_recipient',
  'requested_by',
] as const;
/** The printed form label where the stored field name is not the document's words. */
const FACT_LABELS: Record<string, string> = {
  billing_recipient: 'bill to',
  requested_by: 'requested by',
};
export const factLabel = (field: string) => FACT_LABELS[field] ?? field.replaceAll('_', ' ');
export type SuggestedEvidence = {
  field: string;
  value: string;
  page: number;
  quote: string;
  source?: 'machine_read' | 'checked';
};
export type SuggestedFact = SuggestedEvidence & {
  machine_field: string;
  /** Every page that printed this value; the card's quote is from `page`. */
  pages?: number[];
  in_safe_text: boolean;
  already_checked: boolean;
};
export type SuggestedCommittee = {
  registration_number: string;
  name: string;
  filer_kind: string;
  office?: string | null;
  district?: string | null;
  terminated: boolean;
  evidence: SuggestedEvidence;
  in_safe_text: boolean;
  already_connected: boolean;
  pages?: number[];
};
export type SuggestedExpense = {
  target_id: string;
  source_dataset: string;
  source_row_number: number;
  fields: { label: string; value: string }[];
  matches: {
    fcc_field: string;
    fcc_value: string;
    page: number;
    match: string;
    expense_value: string;
  }[];
  evidence: SuggestedEvidence | null;
  in_safe_text: boolean;
  limitations: string[];
  existing_link_status: string | null;
  already_connected: boolean;
};
export type ReviewSuggestions = {
  copy_id: string;
  facts: SuggestedFact[];
  committees: SuggestedCommittee[];
  expenses: { suggestions: SuggestedExpense[]; reason: string; truncated: boolean };
};
export function validRedaction(value: Redaction) {
  return (
    [value.x, value.y, value.width, value.height].every(Number.isFinite) &&
    value.x >= 0 &&
    value.y >= 0 &&
    value.width > 0 &&
    value.height > 0 &&
    value.x + value.width <= 1 &&
    value.y + value.height <= 1
  );
}
export function centralDate(value: string | null | undefined) {
  if (!value || !Number.isFinite(new Date(value).valueOf())) return 'Date unavailable';
  return (
    new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/Chicago',
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date(value)) + ' CT'
  );
}
