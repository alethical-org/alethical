import type { MailImageSide } from './mailUpload';

export function normalizeMailAnalysis(value: MailAnalysis): MailAnalysis {
  if (
    !value ||
    !['pending', 'processing', 'ready', 'partial', 'failed'].includes(value.status) ||
    (value.sides !== undefined && !Array.isArray(value.sides)) ||
    (value.payers !== undefined && !Array.isArray(value.payers))
  )
    throw new Error('Invalid analysis response');
  const count = value.matching_mailers?.count;
  return {
    ...value,
    can_retry: value.can_retry === true && ['partial', 'failed'].includes(value.status),
    sides: value.sides ?? [],
    payers: value.payers ?? [],
    matching_mailers: {
      ...value.matching_mailers,
      count: typeof count === 'number' && Number.isSafeInteger(count) && count >= 0 ? count : null,
    },
  };
}

/** Private machine-read evidence. Never persist or send this payload to telemetry. */
export interface MailDisclosure {
  quote: string;
  payer_text: string | null;
  edge_warning?: boolean;
  confidence?: number;
  box?: number[];
}
export interface MailReadSide {
  side: MailImageSide;
  status: 'read' | 'partial' | 'unreadable';
  text: string;
  complete: false;
  disclosures: MailDisclosure[];
  partial_reasons?: string[];
}
export interface MailPayment {
  amount: string | null;
  unpaid_amount?: string | null;
  record_number: number | null;
  received_on?: string | null;
  paid_on?: string | null;
  contributor?: string | null;
  vendor_name?: string | null;
  affected_committee_name?: string | null;
  stance?: string | null;
  purpose?: string | null;
  in_kind?: string | null;
  in_kind_description?: string | null;
  receipt_type?: string | null;
  expenditure_type?: string | null;
}
export interface MailRecordBlock {
  state: 'reported' | 'not_reported' | 'unavailable';
  payments: MailPayment[];
  has_more: boolean;
  total_payments: number | null;
  source_url: string | null;
  fetched_at: string | null;
}
export interface MailPublicRecords {
  state: 'available' | 'unavailable' | 'not_loaded';
  registration_number: string;
  year?: number;
  fetched_at?: string | null;
  refresh_failed?: boolean;
  received?: MailRecordBlock;
  paid?: MailRecordBlock;
  independent_spending?: MailRecordBlock;
}
export interface MailOrganization {
  name: string;
  source_url: string;
  source_title?: string;
  checked_on?: string;
  address?: string;
  basis: string;
  scope: 'organization';
}
export interface MailRegistration {
  name: string;
  registration_number: string;
  scope: 'candidate_record' | 'related_record';
  basis: string;
  source_url: string;
  checked_on?: string;
  roles?: { name: string; role: string }[];
  person?: string;
  office?: string;
  records?: MailPublicRecords;
}
export interface MailPayer extends MailDisclosure {
  side: MailImageSide;
  official_organization: MailOrganization | null;
  candidates: MailRegistration[];
  related_records: MailRegistration[];
}
export interface MailAnalysis {
  status: 'pending' | 'processing' | 'ready' | 'partial' | 'failed';
  can_retry?: boolean;
  records_retry_needed?: boolean;
  sides: MailReadSide[];
  payers: MailPayer[];
  payer_status?: 'matched' | 'uncertain' | 'not_found';
  matching_mailers: {
    count: number | null;
    basis?: string | null;
  };
}

export interface SavedMailSubmission {
  id: string;
  token: string;
  photos: Partial<Record<MailImageSide, File>>;
}
