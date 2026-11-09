/** Private invitation-based upload API. Never send these values to site telemetry. */
export const MAX_MAIL_IMAGE_BYTES = 15 * 1024 * 1024;
export const MAIL_IMAGE_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
] as const;
export type MailImageSide = 'front' | 'back';
export interface MailImageReceipt {
  sha256: string;
  content_type: string;
  bytes: number;
}
export interface MailSubmission {
  id: string;
  status: 'draft' | 'saved';
  front: MailImageReceipt | null;
  back: MailImageReceipt | null;
  likes_ad: boolean | null;
  comment: string | null;
}
export interface MailUploadSession {
  token: string;
  expires_at: string;
  supported_content_types: string[];
}
export interface MailRequestOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
}
export class MailUploadError extends Error {
  constructor(
    public readonly status: number,
    public readonly detail: string,
  ) {
    super(detail);
    this.name = 'MailUploadError';
  }
}
interface SessionRecord {
  clientId: string;
  clientSecret: string;
  invitation?: string;
  session?: MailUploadSession;
}
const LEGACY_STORAGE_KEY = 'alethical.mailUpload.session.v1';
let memoryRecord: SessionRecord | null = null;
let exchange: { record: SessionRecord; promise: Promise<MailUploadSession> } | null = null;

declare global {
  interface Window {
    __alethicalMailInvitation?: string;
  }
}

// Credentials live only in this module. Remove earlier versions' tab record
// without reading it, including on a page reload or a visit to another route.
function clearLegacySession(): void {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.removeItem(LEGACY_STORAGE_KEY);
  } catch {
    /* Storage may be disabled; the in-memory session does not depend on it. */
  }
}
clearLegacySession();

function saveRecord(record: SessionRecord | null): void {
  memoryRecord = record;
}
function readRecord(): SessionRecord | null {
  return memoryRecord;
}

/** Consume the fragment once, before React starts. A new link replaces this tab's access. */
export function captureMailInvitation(): void {
  if (
    typeof window === 'undefined' ||
    window.location.pathname.replace(/\/$/, '') !== '/mail-upload'
  )
    return;
  const invitation =
    window.__alethicalMailInvitation ??
    new URLSearchParams(window.location.hash.slice(1)).get('invite');
  delete window.__alethicalMailInvitation;
  window.history.replaceState(window.history.state, '', window.location.pathname);
  if (invitation === null || invitation === undefined) return;
  clearMailUploadSession();
  if (!invitation) return;
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  saveRecord({
    invitation,
    clientId: crypto.randomUUID(),
    clientSecret: Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join(''),
  });
}

export function clearMailUploadSession(): void {
  clearLegacySession();
  exchange = null;
  saveRecord(null);
}

async function request<T>(
  path: string,
  token: string | null,
  init: RequestInit,
  options: MailRequestOptions & { retry429?: boolean } = {},
): Promise<T> {
  const origin = process.env.EXPO_PUBLIC_API_URL?.replace(/\/$/, '');
  if (!origin) throw new MailUploadError(503, 'This demo is unavailable');
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (options.signal?.aborted) abort();
  options.signal?.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(abort, options.timeoutMs ?? 60_000);
  try {
    let response: Response;
    for (let attempt = 0; ; attempt += 1) {
      if (controller.signal.aborted) throw new Error('aborted');
      response = await fetch(`${origin}/api/v1/mail-upload${path}`, {
        ...init,
        headers: { ...init.headers, ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        signal: controller.signal,
        credentials: 'omit',
        cache: 'no-store',
        referrerPolicy: 'no-referrer',
      });
      if (response.status !== 429 || !options.retry429 || attempt >= 2) break;
      const retryAfter = response.headers.get('Retry-After');
      const seconds = retryAfter === null ? 1 : Number(retryAfter);
      const wait = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(retryAfter!) - Date.now();
      // Do not shorten the server's wait, or hold a photo indefinitely.
      if (!Number.isFinite(wait) || wait > 5000) break;
      await new Promise<void>((resolve, reject) => {
        if (controller.signal.aborted) {
          reject(new Error('aborted'));
          return;
        }
        const onAbort = () => {
          clearTimeout(timer);
          reject(new Error('aborted'));
        };
        const timer = setTimeout(
          () => {
            controller.signal.removeEventListener('abort', onAbort);
            resolve();
          },
          Math.max(0, wait),
        );
        controller.signal.addEventListener('abort', onAbort, { once: true });
      });
    }
    const body = await response.json().catch(() => null);
    if (!response.ok) {
      if (response.status === 401 && token && readRecord()?.session?.token === token)
        clearMailUploadSession();
      throw new MailUploadError(
        response.status,
        typeof body?.detail === 'string' ? body.detail : 'The request could not be completed',
      );
    }
    if (!body || typeof body !== 'object' || !('data' in body))
      throw new MailUploadError(502, 'The response could not be confirmed');
    return body.data as T;
  } catch (error) {
    if (error instanceof MailUploadError) throw error;
    // Do not retain fetch exceptions, URLs, credentials, or request bodies in errors.
    throw new MailUploadError(
      0,
      controller.signal.aborted ? 'The response could not be confirmed' : 'Could not connect',
    );
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener('abort', abort);
  }
}
function json(method: string, value: unknown): RequestInit {
  return { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value) };
}

export async function getMailUploadSession(
  options: MailRequestOptions = {},
): Promise<MailUploadSession> {
  captureMailInvitation();
  const record = readRecord();
  if (!record) throw new MailUploadError(401, 'Open your invitation link to continue');
  if (record.session) {
    if (Date.parse(record.session.expires_at) > Date.now()) return record.session;
    clearMailUploadSession();
    throw new MailUploadError(401, 'This demo link is no longer available');
  }
  if (exchange?.record === record) return exchange.promise;
  const promise = request<MailUploadSession>(
    '/sessions',
    null,
    json('POST', {
      invitation_token: record.invitation,
      client_id: record.clientId,
      client_secret: record.clientSecret,
    }),
    options,
  )
    .then((session) => {
      if (
        !session ||
        typeof session.token !== 'string' ||
        !Number.isFinite(Date.parse(session.expires_at)) ||
        !Array.isArray(session.supported_content_types)
      ) {
        throw new MailUploadError(502, 'The response could not be confirmed');
      }
      if (readRecord() !== record) throw new MailUploadError(401, 'This demo link changed');
      saveRecord({ clientId: record.clientId, clientSecret: record.clientSecret, session });
      return session;
    })
    .catch((error) => {
      if (error instanceof MailUploadError && error.status === 401 && readRecord() === record)
        clearMailUploadSession();
      throw error;
    })
    .finally(() => {
      if (exchange?.record === record) exchange = null;
    });
  exchange = { record, promise };
  return promise;
}
function submissionPath(id: string) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id))
    throw new MailUploadError(422, 'Invalid submission');
  return `/submissions/${id}`;
}
export function createMailSubmission(
  token: string,
  id: string,
  options?: MailRequestOptions,
): Promise<MailSubmission> {
  return request(submissionPath(id), token, json('PUT', {}), options);
}
export function getMailSubmission(
  token: string,
  id: string,
  options?: MailRequestOptions,
): Promise<MailSubmission> {
  return request(submissionPath(id), token, { method: 'GET' }, options);
}
export function mailImageContentType(file: File): string {
  const declared = file.type.toLowerCase();
  if (MAIL_IMAGE_TYPES.some((type) => type === declared)) return declared;
  if (!declared || declared === 'application/octet-stream') {
    const extension = file.name.split('.').pop()?.toLowerCase();
    const types: Record<string, string> = {
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      png: 'image/png',
      webp: 'image/webp',
      heic: 'image/heic',
      heif: 'image/heif',
    };
    if (extension && types[extension]) return types[extension];
  }
  throw new MailUploadError(422, 'Choose a JPEG, PNG, WebP, HEIC or HEIF photo');
}
const imageQueues = new Map<string, Promise<unknown>>();

export function uploadMailImage(
  token: string,
  id: string,
  side: MailImageSide,
  file: File,
  options?: MailRequestOptions,
): Promise<MailSubmission> {
  if (!file.size) throw new MailUploadError(422, 'Choose another photo');
  if (file.size > MAX_MAIL_IMAGE_BYTES)
    throw new MailUploadError(413, 'Choose a photo up to 15 MB');
  const path = `${submissionPath(id)}/images/${side}`;
  const contentType = mailImageContentType(file);
  // Serialize both sides in this tab; another tab can still meet the server's
  // shared storage limit, which gets a bounded retry inside request.
  const pending = (imageQueues.get(token) ?? Promise.resolve())
    .catch(() => undefined)
    .then(() => {
      if (options?.signal?.aborted)
        throw new MailUploadError(0, 'The response could not be confirmed');
      return request<MailSubmission>(
        path,
        token,
        {
          method: 'PUT',
          headers: { 'Content-Type': contentType },
          body: file,
        },
        { ...options, retry429: true },
      );
    })
    .finally(() => {
      if (imageQueues.get(token) === pending) imageQueues.delete(token);
    });
  imageQueues.set(token, pending);
  return pending;
}
export function submitMailSubmission(
  token: string,
  id: string,
  feedback: { likes_ad: boolean; comment?: string },
  options?: MailRequestOptions,
): Promise<MailSubmission> {
  return request(`${submissionPath(id)}/submit`, token, json('POST', feedback), options);
}
