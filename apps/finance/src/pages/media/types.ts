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
  uploaded_at: string | null;
  version_id: string;
  version_count: number;
  source_changed: boolean;
  agency_unchecked?: boolean;
  role?: string | null;
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
  rows: Group[];
  years: number[];
  categories: string[];
}
export interface Fact {
  id: string;
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
  history: { value: string; corrected_at: string }[];
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
}
export interface FileDetail extends FileRow {
  agencies: { key: string; name: string; unchecked: boolean }[];
  folder: { key: string; label: string };
  fcc_url: string;
  fcc_available: boolean;
  versions: { id: string; first_saved_at: string; uploaded_at: string | null }[];
  page_count: number;
  pages: { number: number; text: string | null; text_status: string; image: string }[];
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
export interface Agency {
  key: string;
  name: string;
  unchecked: boolean;
  groups: { station: string; year: number | null; files: FileRow[] }[];
  addresses: {
    address: string;
    role?: string | null;
    evidence: {
      file_key: string;
      file_name: string;
      version_id: string;
      page: number;
      checked_at: string;
    }[];
  }[];
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
