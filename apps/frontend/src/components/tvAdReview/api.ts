import { apiRequest, ApiError } from '../../data/api';
import type { ReviewPayload, PrepareCopy } from './types';

export const REVIEW_BASE = '/admin/political-ads';
export type QueueRow = {
  facility_id: string;
  file_id: string;
  content_hash: string;
  name: string;
  call_sign: string;
  folder_path: string;
  uploaded_at: string | null;
  first_saved_at: string;
  page_count: number;
  status: string;
  copy_id?: string;
  suggested_first?: boolean;
  checked_agency_names?: string[];
  folder_committees?: string[];
};
export type QueuePayload = {
  rows: QueueRow[];
  total: number;
  first_total?: number;
  page: number;
  page_size: number;
};
export type VersionPayload = {
  document: Omit<QueueRow, 'page_count' | 'status'> & {
    folder_id: string;
    extraction_version?: string;
    folder_content_hash?: string;
    folder_evidence?: { content_hash: string; source_url: string; text: string };
  };
  pages: { page: number; text: string; text_status: string }[];
  draft_facts: { field: string; value: string; page: number; quote: string }[];
  folder_evidence?: { content_hash: string; source_url: string; text: string };
  copies: { id: string; status: string; created_at: string }[];
  page_count: number;
};
export function denied(error: unknown) {
  return error instanceof ApiError && [401, 403, 404].includes(error.status);
}
export function reviewError(error: unknown) {
  return error instanceof ApiError && error.status === 409
    ? 'This record changed. Reload it and review the current copy before saving.'
    : error instanceof ApiError && error.status === 422
      ? 'The review could not be saved. Check the fields and evidence, then try again.'
      : 'We couldn’t save this review. Your entries are still here. Try again.';
}
export function reviewRequest<T>(
  token: string,
  path: string,
  signal?: AbortSignal,
  data?: unknown,
) {
  return apiRequest<T>(
    `${REVIEW_BASE}${path}`,
    {
      method: data === undefined ? 'GET' : 'POST',
      cache: 'no-store',
      signal,
      ...(data === undefined ? {} : { body: JSON.stringify(data) }),
    },
    token,
  );
}
export const sourcePath = (row: Pick<QueueRow, 'facility_id' | 'file_id' | 'content_hash'>) =>
  `/files/${row.facility_id}/${encodeURIComponent(row.file_id)}/versions/${encodeURIComponent(row.content_hash)}`;
export const prepareCopy = (token: string, data: PrepareCopy, signal?: AbortSignal) =>
  reviewRequest<ReviewPayload>(token, '/copies', signal, data);

/** Only constructed admin paths are accepted; never follow a source-provided URL with credentials. */
export async function reviewImage(token: string, path: string, signal: AbortSignal) {
  if (
    !/^\/(?:files\/[0-9]+\/[^/]+\/versions\/[a-f0-9]+|copies\/[^/]+)\/pages\/[1-9][0-9]*$/.test(
      path,
    )
  )
    throw new Error('Invalid review image path');
  const origin = process.env.EXPO_PUBLIC_API_URL?.replace(/\/$/, '');
  if (!origin) throw new Error('Review service unavailable');
  const response = await fetch(`${origin}/api/v1${REVIEW_BASE}${path}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'image/png' },
    cache: 'no-store',
    signal,
    redirect: 'error',
  });
  if (!response.ok) throw new ApiError(response.status, 'Image unavailable');
  if (!response.headers.get('Content-Type')?.startsWith('image/png'))
    throw new Error('Image unavailable');
  return URL.createObjectURL(await response.blob());
}
