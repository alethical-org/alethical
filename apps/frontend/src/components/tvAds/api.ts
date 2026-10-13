import { apiRequest, ApiError } from '../../data/api';

export type TVKind = 'landing' | 'file' | 'folder' | 'agency' | 'station' | 'guide';
export type BrowseTab = 'folders' | 'agencies' | 'stations' | 'years';
export type CopyStatus = 'approved' | 'pending' | 'not_ready' | 'withdrawn';
export interface Counts {
  station_files_held: number;
  unique_file_contents: number;
  files_with_approved_copy: number;
  text_read_failures: number;
  download_failures: number;
  checked_connection_files: number;
}
export interface StationSource {
  call_sign: string;
  facility_id: string | number;
  fcc_url: string;
  newest_upload: string | null;
  last_list_check: string | null;
  last_file_copy: string | null;
  error?: boolean;
}
export interface Sources {
  stations: StationSource[];
  text_reader_version: string;
}
export interface CopyReference {
  version_id?: string;
  copy_id?: string;
  source_changed?: boolean;
  current_source_version?: string;
}
export interface FileRow extends CopyReference {
  key: string;
  name: string;
  station: string;
  year: string | number;
  category: string | null;
  kind?: string | null;
  uploaded_at: string | null;
  role?: string;
}
export interface BrowseRow extends CopyReference {
  key: string;
  label: string;
  station?: string;
  year?: string | number;
  category?: string | null;
  file_count?: number;
  kind?: string | null;
  uploaded_at?: string | null;
  match_label?: string;
  excerpt?: string;
  text_match?: boolean;
}
export interface BrowseQuery {
  tab: BrowseTab;
  q: string;
  station: string;
  year: string;
  category: string;
  page: number;
}
export interface BrowseResult extends BrowseQuery {
  page_size: number;
  total: number;
  capped: boolean;
  rows: BrowseRow[];
  years: Array<string | number>;
  categories: string[];
}
export interface Recent {
  stations: Array<{ call_sign: string; files: FileRow[] }>;
}
export interface SavedVersion {
  id: string;
  first_saved_at: string;
  uploaded_at: string | null;
  status: CopyStatus;
  withdrawn_at?: string | null;
}
export interface Fact {
  id: string;
  kind: string;
  value?: string;
  qualifier?: string;
  quote?: string;
  page?: number;
  version_id: string;
  checked_at?: string;
  status: 'checked' | 'withdrawn';
  withdrawn_at?: string;
  history?: Array<{ value: string; corrected_at: string }>;
}
export interface Connection {
  id: string;
  kind: string;
  label?: string;
  href?: string;
  role?: string;
  quote?: string;
  page?: number;
  version_id: string;
  checked_at?: string;
  status: 'checked' | 'withdrawn';
  withdrawn_at?: string;
  reported_amount?: string;
  reported_date?: string;
  source_changed?: boolean;
  evidence_label?: string;
}
export interface Related extends CopyReference {
  key: string;
  name: string;
  kind: string;
  reference: string;
  checked_at: string;
}
export interface FileDetail {
  key: string;
  copy_status: CopyStatus;
  current_source_version?: string;
  newest_approved_version?: string;
  source_changed?: boolean;
  withdrawn_at?: string;
  // Safe tombstones deliberately omit all other record metadata.
  name?: string;
  station?: string;
  year?: string | number;
  category?: string | null;
  kind?: string | null;
  uploaded_at?: string | null;
  folder?: { key: string; label: string };
  fcc_url?: string;
  fcc_available?: boolean;
  versions: SavedVersion[];
  version_id?: string;
  copy_id?: string;
  page_count?: number;
  pages?: Array<{
    number: number;
    image_path?: string | null;
    text?: string | null;
    text_status: 'ready' | 'partial' | 'failed' | 'pending';
  }>;
  facts?: Fact[];
  dates?: Fact[];
  connections?: Connection[];
  related?: Related[];
  other_files?: FileRow[];
}
export interface FolderDetail {
  key: string;
  label: string;
  station: string;
  year: string | number;
  category: string | null;
  fcc_url: string;
  relationship?: { label: string; href: string; checked_at: string } | null;
  files: Array<FileRow & { airing_periods: string[]; version_count: number }>;
}
export interface AgencyDetail {
  key: string;
  name: string;
  payments_href?: string;
  groups: Array<{ station: string; year: string | number; files: FileRow[] }>;
  addresses: Array<{
    address: string;
    role?: string;
    evidence: Array<{
      file_key: string;
      file_name: string;
      version_id: string;
      copy_id?: string;
      page: number;
      uploaded_at: string | null;
      checked_at: string;
    }>;
  }>;
}
export interface StationDetail {
  call_sign: string;
  facility_id: string | number;
  fcc_url: string;
  last_file_copy: string | null;
  counts: Counts;
  folder_count: number;
  folder_failures: number;
  years: Array<{
    year: string | number;
    categories: Array<{ name: string; count: number }>;
    file_count: number;
  }>;
}
export interface ConnectionResult {
  files: FileRow[];
  groups?: Array<{ label: string; files: FileRow[] }>;
  agency_key?: string;
  exact_name_count?: number;
}
export interface ExpenseDetail {
  id: string;
  label: string;
  dataset: string;
  source_date: string | null;
  source_url?: string;
  source_changed: boolean;
  fields: Array<{ label: string; value: string }>;
  evidence: { page: number; quote: string; version_id: string };
  file: { key: string; name: string; copy_id: string; version_id: string };
}

export function queryString(values: Record<string, unknown>) {
  const params = new URLSearchParams();
  Object.entries(values).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') params.set(key, String(value));
  });
  const text = params.toString();
  return text ? `?${text}` : '';
}
export function readTV<T>(token: string, path: string, signal?: AbortSignal): Promise<T> {
  return apiRequest<T>(`/ads${path}`, { method: 'GET', cache: 'no-store', signal }, token).catch(
    async (error: unknown) => {
      await checkTVFailure(token, error, signal);
      throw error;
    },
  );
}
const deniedListeners = new Set<(token: string) => void>();
export function onTVDenied(listener: (token: string) => void) {
  deniedListeners.add(listener);
  return () => {
    deniedListeners.delete(listener);
  };
}
export function denyTV(token: string) {
  deniedListeners.forEach((listener) => listener(token));
}
export async function checkTVFailure(token: string, error: unknown, signal?: AbortSignal) {
  if (isAccessFailure(error)) {
    denyTV(token);
    return;
  }
  if (error instanceof ApiError && error.status === 404 && !signal?.aborted) {
    try {
      await apiRequest('/ads/access', { method: 'GET', cache: 'no-store', signal }, token);
    } catch (accessError) {
      if (accessError instanceof ApiError && [401, 403, 404].includes(accessError.status))
        denyTV(token);
    }
  }
}
export function isAccessFailure(error: unknown) {
  return error instanceof ApiError && [401, 403].includes(error.status);
}
/** A server-provided media path may never send the bearer token to another origin. */
export async function readTVImage(token: string, path: string, signal: AbortSignal) {
  if (!/^\/ads\/files\/[^/?#]+\/pages\/\d+\?/.test(path)) throw new Error('Invalid image path');
  const params = new URLSearchParams(path.split('?')[1]);
  if (!params.get('version') || !params.get('copy')) throw new Error('Unbound image path');
  const origin = process.env.EXPO_PUBLIC_API_URL?.replace(/\/$/, '');
  if (!origin) throw new Error('API is not configured');
  const response = await fetch(`${origin}/api/v1${path}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'image/*' },
    cache: 'no-store',
    signal,
    redirect: 'error',
    credentials: 'omit',
  });
  if (!response.ok) {
    const error = new ApiError(response.status, 'Image unavailable');
    await checkTVFailure(token, error, signal);
    throw error;
  }
  if (!response.headers.get('Content-Type')?.startsWith('image/')) throw new Error('Invalid image');
  return response.blob();
}

export function safeTVReturn(value: string | null): string {
  if (!value) return '/money/ads';
  try {
    const url = new URL(value, 'https://alethical.invalid');
    if (url.origin !== 'https://alethical.invalid' || url.pathname !== '/money/ads')
      return '/money/ads';
    const allowed = new URLSearchParams();
    ['tab', 'q', 'station', 'year', 'category', 'page'].forEach((key) => {
      const item = url.searchParams.get(key);
      if (item) allowed.set(key, item.slice(0, 300));
    });
    return `/money/ads${allowed.size ? `?${allowed}` : ''}`;
  } catch {
    return '/money/ads';
  }
}
export function tvHref(
  kind: Exclude<TVKind, 'landing' | 'guide'>,
  key: string,
  params: Record<string, unknown> = {},
) {
  const section = { file: 'files', folder: 'folders', agency: 'agencies', station: 'stations' }[
    kind
  ];
  return `/money/ads/${section}/${encodeURIComponent(key)}${queryString(params)}`;
}
export function centralDate(value?: string | null, time = false) {
  if (!value) return 'Unavailable';
  const parsed = new Date(/^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T12:00:00Z` : value);
  if (Number.isNaN(parsed.getTime())) return 'Unavailable';
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Chicago',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    ...(time ? { hour: 'numeric', minute: '2-digit' } : {}),
  }).format(parsed);
}
export function uploaded(value?: string | null) {
  return value ? `Uploaded by the station: ${centralDate(value)}` : 'Upload date unavailable';
}
