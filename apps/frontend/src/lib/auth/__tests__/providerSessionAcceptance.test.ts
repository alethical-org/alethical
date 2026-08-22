import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  isProviderSessionRejected,
  onProviderSessionRejected,
  providerSessionIdentity,
  rejectProviderSession,
  resetProviderSessionRejectionsForTests,
  sameProviderSession,
  sameProviderSessionLineage,
  sessionMatchesProviderUserAccessToken,
} from '../providerSessionAcceptance';

function accessToken(sessionId: string, suffix: string, userId = 'person') {
  const payload = globalThis
    .btoa(
      JSON.stringify({ nested: { session_id: 'untrusted' }, session_id: sessionId, sub: userId }),
    )
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
  return `header.${payload}.${suffix}`;
}

function session(id: string, token = id, sessionId?: string) {
  return {
    access_token: sessionId ? accessToken(sessionId, token, id) : `access-${token}`,
    refresh_token: `refresh-${token}`,
    user: { id },
  } as any;
}

afterEach(() => resetProviderSessionRejectionsForTests());

describe('cancelled provider sessions', () => {
  it('rejects a cancelled session after refresh but preserves a fresh sign-in', () => {
    const cancelled = session('person', 'old', 'cancelled-session');
    const refreshed = session('person', 'refreshed', 'cancelled-session');
    const newer = session('person', 'new', 'new-session');
    const listener = vi.fn();
    const unsubscribe = onProviderSessionRejected(listener);

    rejectProviderSession(cancelled);

    expect(isProviderSessionRejected(cancelled)).toBe(true);
    expect(isProviderSessionRejected(refreshed)).toBe(true);
    expect(isProviderSessionRejected(newer)).toBe(false);
    expect(sameProviderSession(cancelled, newer)).toBe(false);
    expect(sameProviderSessionLineage(cancelled, refreshed)).toBe(true);
    expect(listener).toHaveBeenCalledWith(providerSessionIdentity(cancelled));

    unsubscribe();
  });

  it('applies a delayed deactivation only to the provider account that made the request', () => {
    const accountARequest = accessToken('old-a', 'request-a', 'account-a');
    const freshAccountA = session('account-a', 'fresh-a', 'fresh-a');
    const accountB = session('account-b', 'current-b', 'current-b');

    expect(sessionMatchesProviderUserAccessToken(freshAccountA, accountARequest)).toBe(true);
    expect(sessionMatchesProviderUserAccessToken(accountB, accountARequest)).toBe(false);
    expect(sessionMatchesProviderUserAccessToken(accountB, accountB.access_token)).toBe(true);
    expect(sessionMatchesProviderUserAccessToken(accountB, 'not-a-jwt')).toBe(false);
  });
});
