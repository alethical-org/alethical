/** Answers of `/finance/media-buys/*` (alethical/api/finance_media_buys_schemas.py).
 * A file is keyed by station and FCC source file id (`{station slug}-{file id}`),
 * never by its filename; a version is the exact content hash. */
export interface Source {
  call_sign: string;
  facility_id: string;
  fcc_url: string;
  newest_upload: string | null;
  last_list_check: string | null;
  last_file_copy: string | null;
}
export interface Sources {
  stations: Source[];
  text_reader_version: string;
}
export interface FileRow {
  key: string;
  name: string;
  label: string;
  folder_label?: string | null;
  station: string;
  year: number | null;
  category: string;
  kind?: string | null;
  uploaded_at: string | null;
  version_id: string;
  version_count: number;
  source_changed: boolean;
  agency_unchecked?: boolean;
  role?: string | null;
  match_label?: string | null;
  excerpt?: string | null;
  text_match?: boolean | null;
}
export interface Group {
  key: string;
  label: string;
  file_count: number;
  station?: string | null;
  stations?: string[] | null;
  year?: number | null;
  category?: string | null;
  folder_count?: number | null;
  unchecked?: boolean;
}
export interface Browse {
  tab: string;
  q: string;
  station: string;
  year: number | null;
  category: string;
  page: number;
  page_size: number;
  total: number;
  capped: boolean;
  /** File rows while a search runs; folder, name, station or year groups otherwise. */
  rows: Array<Group | FileRow>;
  years: number[];
  categories: string[];
}
export interface Fact {
  id: string;
  /** The printed label for the checked field ("Gross amount", "Bill to"). */
  kind: string;
  status: 'checked' | 'withdrawn';
  version_id: string;
  value?: string | null;
  qualifier?: string | null;
  role?: string | null;
  quote?: string | null;
  page?: number | null;
  checked_at?: string | null;
  withdrawn_at?: string | null;
  history?: { value: string; corrected_at: string }[];
}
export interface Connection {
  id: string;
  kind: string;
  status: 'checked' | 'withdrawn';
  version_id: string;
  target?: {
    kind: 'committee' | 'candidate' | 'principal' | 'election' | 'file';
    id: string;
    version?: string | null;
  } | null;
  label?: string | null;
  role?: string | null;
  quote?: string | null;
  page?: number | null;
  checked_at?: string | null;
  withdrawn_at?: string | null;
  reported_amount?: string | null;
  reported_date?: string | null;
  source_changed?: boolean | null;
  evidence_label?: string | null;
}
export interface Version {
  id: string;
  first_saved_at: string;
  uploaded_at: string | null;
}
export interface FilePage {
  number: number;
  text: string | null;
  text_status: string;
}
export interface FileDetail extends FileRow {
  agencies: { key: string; name: string; unchecked: boolean }[];
  folder: { key: string; label: string };
  fcc_url: string;
  fcc_available: boolean;
  versions: Version[];
  page_count: number;
  pages: FilePage[];
  facts: Fact[];
  dates: Fact[];
  connections: Connection[];
  current_source_version: string;
}
export interface Folder {
  key: string;
  label: string;
  station: string;
  year: number | null;
  category: string;
  fcc_url: string;
  relationship: Connection | null;
  files: FileRow[];
}
export interface AddressEvidence {
  file_key: string;
  file_name: string;
  version_id: string;
  page: number;
  uploaded_at?: string | null;
  checked_at: string;
  role?: string | null;
}
export interface Agency {
  key: string;
  name: string;
  unchecked: boolean;
  groups: { station: string; year: number | null; files: FileRow[] }[];
  addresses: { address: string; role?: string | null; evidence: AddressEvidence[] }[];
}
export interface Counts {
  station_files_held: number;
  unique_file_contents: number;
  text_read_failures: number;
  download_failures: number;
  checked_connection_files: number;
}
export interface Station extends Source {
  counts: Counts;
  folder_count: number;
  folder_failures: number;
  years: {
    year: number | null;
    categories: { name: string; count: number }[];
    file_count: number;
  }[];
}
export interface QueueRow extends FileRow {
  saved_at: string;
  suggestion_count: number;
  reasons: Array<{ kind: 'agency_checked_elsewhere' | 'folder_committee_checked'; label: string }>;
}
export interface Queue {
  rows: QueueRow[];
  total: number;
  limit: number;
  offset: number;
  has_more: boolean;
  sort: string;
}
export interface Suggestion {
  field: string;
  machine_field: string;
  value: string;
  page: number;
  pages: number[];
  quote: string;
  in_source_text: boolean;
  already_checked: boolean;
}
export interface Suggestions {
  key: string;
  version_id: string;
  extraction_version: string;
  facts: Suggestion[];
}
export interface TargetPreview {
  kind: string;
  target_id: string;
  label: string;
  target_fingerprint: string;
  fields: { label: string; value: string }[];
  source_dataset?: string | null;
  source_snapshot_id?: string | null;
  source_content_hash?: string | null;
  source_row_number?: number | null;
  source_date?: string | null;
}
export interface Connected {
  committee?: { name: string; office: string | null; district: string | null } | null;
  agency_key: string | null;
  exact_name_count: number;
  files: FileRow[];
  total: number;
  groups: { label: string; files: FileRow[] }[];
}
