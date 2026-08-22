import type { Session } from '@supabase/auth-js';

const MAX_REJECTED_SESSIONS = 32;
const rejectedSessionKeys = new Set<string>();
const rejectionListeners = new Set<(sessionKey: string) => void>();
const CHANNEL_NAME = 'alethical.auth.cancelled-session';
let rejectionChannel: BroadcastChannel | null = null;

function rememberRejectedSession(sessionKey: string): void {
  rejectedSessionKeys.add(sessionKey);
  while (rejectedSessionKeys.size > MAX_REJECTED_SESSIONS) {
    const oldest = rejectedSessionKeys.values().next().value;
    if (typeof oldest !== 'string') break;
    rejectedSessionKeys.delete(oldest);
  }
}

function notifyRejection(sessionKey: string): void {
  rememberRejectedSession(sessionKey);
  for (const listener of rejectionListeners) listener(sessionKey);
}

function channel(): BroadcastChannel | null {
  if (typeof window === 'undefined' || typeof BroadcastChannel === 'undefined') return null;
  if (rejectionChannel) return rejectionChannel;
  rejectionChannel = new BroadcastChannel(CHANNEL_NAME);
  rejectionChannel.addEventListener('message', (event: MessageEvent<unknown>) => {
    if (typeof event.data === 'string' && event.data) notifyRejection(event.data);
  });
  return rejectionChannel;
}

export function sameProviderSession(left: Session | null, right: Session | null): boolean {
  return Boolean(
    left &&
    right &&
    left.user.id === right.user.id &&
    left.access_token === right.access_token &&
    left.refresh_token === right.refresh_token,
  );
}

function base64UrlText(value: string): string | null {
  try {
    const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
    if (typeof globalThis.atob === 'function') return globalThis.atob(padded);
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
    let bits = 0;
    let bitCount = 0;
    let output = '';
    for (const character of padded.replace(/=+$/, '')) {
      const index = alphabet.indexOf(character);
      if (index < 0) return null;
      bits = (bits << 6) | index;
      bitCount += 6;
      if (bitCount >= 8) {
        bitCount -= 8;
        output += String.fromCharCode((bits >> bitCount) & 0xff);
      }
    }
    return output;
  } catch {
    return null;
  }
}

function providerClaimsFromAccessToken(
  accessToken: string,
): { session_id?: unknown; sub?: unknown } | null {
  const payload = accessToken.split('.')[1];
  if (!payload) return null;
  const binary = base64UrlText(payload);
  if (!binary) return null;
  try {
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    const decoded =
      typeof globalThis.TextDecoder === 'function'
        ? new globalThis.TextDecoder().decode(bytes)
        : binary;
    return JSON.parse(decoded) as { session_id?: unknown; sub?: unknown };
  } catch {
    return null;
  }
}

export function providerSessionIdFromAccessToken(accessToken: string): string | null {
  const sessionId = providerClaimsFromAccessToken(accessToken)?.session_id;
  return typeof sessionId === 'string' && sessionId ? sessionId : null;
}

export function providerUserIdFromAccessToken(accessToken: string): string | null {
  const userId = providerClaimsFromAccessToken(accessToken)?.sub;
  return typeof userId === 'string' && userId ? userId : null;
}

/** A delayed deactivation reply may affect only the provider account that made that request. */
export function sessionMatchesProviderUserAccessToken(
  session: Session,
  requestAccessToken: string,
): boolean {
  const requestUserId = providerUserIdFromAccessToken(requestAccessToken);
  return requestUserId
    ? requestUserId === session.user.id
    : requestAccessToken === session.access_token;
}

/** Refreshes keep this identity; a fresh sign-in receives a new one. */
export function providerSessionIdentity(session: Session): string {
  const sessionId = providerSessionIdFromAccessToken(session.access_token);
  return sessionId
    ? `${session.user.id}:session:${sessionId}`
    : `${session.user.id}:tokens:${session.access_token}:${session.refresh_token}`;
}

export function sameProviderSessionLineage(left: Session | null, right: Session | null): boolean {
  return Boolean(left && right && providerSessionIdentity(left) === providerSessionIdentity(right));
}

export function sessionMatchesOpeningAccessToken(
  session: Session,
  openingAccessToken: string,
): boolean {
  const openingSessionId = providerSessionIdFromAccessToken(openingAccessToken);
  const currentSessionId = providerSessionIdFromAccessToken(session.access_token);
  return openingSessionId && currentSessionId
    ? openingSessionId === currentSessionId
    : session.access_token === openingAccessToken;
}

export function sessionMatchesProviderTokenLineage(
  session: Session,
  tokens: { access_token: string; refresh_token: string },
): boolean {
  const targetSessionId = providerSessionIdFromAccessToken(tokens.access_token);
  const targetUserId = providerUserIdFromAccessToken(tokens.access_token);
  const currentSessionId = providerSessionIdFromAccessToken(session.access_token);
  if (targetSessionId && targetUserId && currentSessionId) {
    return targetSessionId === currentSessionId && targetUserId === session.user.id;
  }
  return (
    session.access_token === tokens.access_token && session.refresh_token === tokens.refresh_token
  );
}

/** A closed flow may never become the saved or visible account after its late reply. */
export function rejectProviderSession(session: Session): void {
  const sessionKey = providerSessionIdentity(session);
  notifyRejection(sessionKey);
  channel()?.postMessage(sessionKey);
}

export function isProviderSessionRejected(session: Session): boolean {
  return rejectedSessionKeys.has(providerSessionIdentity(session));
}

export function onProviderSessionRejected(listener: (sessionKey: string) => void): () => void {
  channel();
  rejectionListeners.add(listener);
  return () => rejectionListeners.delete(listener);
}

export function resetProviderSessionRejectionsForTests(): void {
  rejectedSessionKeys.clear();
  rejectionListeners.clear();
  rejectionChannel?.close();
  rejectionChannel = null;
}
