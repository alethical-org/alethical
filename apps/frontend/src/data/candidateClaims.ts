import { apiRequest, publicApiPost, publicApiRequest } from './api';

export type CandidateClaimStatus = 'pending' | 'approved' | 'rejected' | 'revoked' | 'withdrawn';
export interface CandidateClaim {
  id: string;
  candidate_id: string;
  status: CandidateClaimStatus;
  evidence_url: string;
  request_note: string;
  review_note?: string | null;
  version: number;
  candidate_name: string;
  office: string;
  account_id?: string;
  user_id?: string;
  account_email?: string | null;
}
export interface CandidateClaimList {
  claims: CandidateClaim[];
  account_id: string;
  offset?: number;
  has_more?: boolean;
}
export interface CandidateStatement {
  body: string;
  updated_at: string;
  version: number;
}
export interface CandidateStatementResponse {
  statement: CandidateStatement | null;
}
export interface ClaimIdentity {
  expected_account_id: string;
  expected_version: number;
}

export function getMyCandidateClaims(token: string, id: string, signal: AbortSignal) {
  return apiRequest<CandidateClaimList>(
    `/candidate-claims/me?candidate_id=${encodeURIComponent(id)}`,
    { method: 'GET', cache: 'no-store', signal },
    token,
  );
}
export function requestCandidateClaim(
  token: string,
  body: ClaimIdentity & { candidate_id: string; evidence_url: string; request_note: string },
  signal: AbortSignal,
) {
  return apiRequest<unknown>(
    '/candidate-claims',
    { method: 'POST', body: JSON.stringify(body), cache: 'no-store', signal },
    token,
  );
}
export function withdrawCandidateClaim(
  token: string,
  id: string,
  body: ClaimIdentity,
  signal: AbortSignal,
) {
  return apiRequest<unknown>(
    `/candidate-claims/${encodeURIComponent(id)}/withdraw`,
    { method: 'POST', body: JSON.stringify(body), cache: 'no-store', signal },
    token,
  );
}
export function getCandidateStatement(id: string, signal: AbortSignal) {
  return publicApiRequest<CandidateStatementResponse>(
    `/candidate-statements/${encodeURIComponent(id)}`,
    signal,
    { cache: 'no-store', credentials: 'omit' },
  );
}
export function saveCandidateStatement(
  token: string,
  id: string,
  body: ClaimIdentity & { body: string },
  signal: AbortSignal,
) {
  return apiRequest<CandidateStatementResponse>(
    `/candidate-claims/${encodeURIComponent(id)}/statement`,
    { method: 'PUT', body: JSON.stringify(body), cache: 'no-store', signal },
    token,
  );
}
export function getAdminCandidateClaims(
  token: string,
  status: 'pending' | 'all',
  signal: AbortSignal,
  offset = 0,
) {
  return apiRequest<CandidateClaimList>(
    `/admin/candidate-claims?status=${status}&offset=${offset}&limit=25`,
    { method: 'GET', cache: 'no-store', signal },
    token,
  );
}
export function reviewCandidateClaim(
  token: string,
  id: string,
  body: ClaimIdentity & {
    action: 'approve' | 'reject' | 'revoke';
    review_note: string;
    identity_verified: boolean;
  },
  signal: AbortSignal,
) {
  return apiRequest<unknown>(
    `/admin/candidate-claims/${encodeURIComponent(id)}/review`,
    { method: 'POST', body: JSON.stringify(body), cache: 'no-store', signal },
    token,
  );
}
export interface CandidateStatementHistory {
  id: string;
  body: string;
  action: 'published' | 'removed';
  created_at: string;
}
export interface PrivateCandidateStatement {
  account_id: string;
  statement: CandidateStatement | null;
  history: CandidateStatementHistory[];
}
export function getPrivateCandidateStatement(token: string, id: string, signal: AbortSignal) {
  return apiRequest<PrivateCandidateStatement>(
    `/candidate-claims/${encodeURIComponent(id)}/statement`,
    { method: 'GET', cache: 'no-store', signal },
    token,
  );
}
export function removeCandidateStatement(
  token: string,
  id: string,
  body: ClaimIdentity,
  signal: AbortSignal,
) {
  return apiRequest<unknown>(
    `/candidate-claims/${encodeURIComponent(id)}/statement`,
    { method: 'DELETE', body: JSON.stringify(body), cache: 'no-store', signal },
    token,
  );
}
export function reportCandidateStatement(id: string, reason: string, signal: AbortSignal) {
  return publicApiPost<{ received: boolean }>(
    `/candidate-statements/${encodeURIComponent(id)}/reports`,
    { reason },
    { signal, cache: 'no-store', credentials: 'omit' },
  );
}
export interface CandidateStatementReport {
  id: string;
  candidate_id: string;
  candidate_name?: string;
  reason: string;
  created_at: string;
  statement_body: string;
  statement_version: number;
  resolved_at?: string | null;
}
export interface CandidateStatementReports {
  reports: CandidateStatementReport[];
  account_id: string;
  offset: number;
  has_more: boolean;
}
export function getCandidateStatementReports(token: string, offset: number, signal: AbortSignal) {
  return apiRequest<CandidateStatementReports>(
    `/admin/candidate-statement-reports?offset=${offset}&limit=25`,
    { method: 'GET', cache: 'no-store', signal },
    token,
  );
}
export function resolveCandidateStatementReport(
  token: string,
  id: string,
  accountId: string,
  signal: AbortSignal,
) {
  return apiRequest<unknown>(
    `/admin/candidate-statement-reports/${encodeURIComponent(id)}/resolve`,
    {
      method: 'POST',
      body: JSON.stringify({ expected_account_id: accountId }),
      cache: 'no-store',
      signal,
    },
    token,
  );
}
