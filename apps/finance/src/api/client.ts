/** The few Finance server calls the shell makes. Every answer is private to
 * the account that asked (the server marks it private, no-store). */

export type AccessState = 'granted' | 'no-access' | 'signed-out' | 'unavailable';

type Fetch = typeof fetch;

/** A hung connection becomes "unavailable" with Try again, never an endless wait. */
export const REQUEST_TIMEOUT_MS = 10_000;

function timeout(): AbortSignal | undefined {
  return typeof AbortSignal.timeout === 'function'
    ? AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    : undefined;
}

export function accessFromStatus(status: number): AccessState {
  if (status === 200) return 'granted';
  if (status === 401) return 'signed-out';
  if (status === 403) return 'no-access';
  return 'unavailable';
}

export async function checkAccess(
  apiBaseUrl: string,
  accessToken: string,
  fetcher: Fetch = fetch,
): Promise<AccessState> {
  try {
    const response = await fetcher(`${apiBaseUrl}/api/v1/finance/access`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      cache: 'no-store',
      signal: timeout(),
    });
    return accessFromStatus(response.status);
  } catch {
    return 'unavailable';
  }
}

export type CodeRequestResult = 'accepted' | 'invalid-email' | 'rate-limited' | 'unavailable';

export type CodeProofResult =
  | { kind: 'token'; tokenHash: string; type: 'magiclink' }
  | { kind: 'refused' | 'rate-limited' | 'unavailable' };

/** Prove an emailed code. A proved code returns a 1-time Supabase sign-in token;
 * every other code, including one never sent, gets the same refusal. */
export async function proveSignInCode(
  apiBaseUrl: string,
  email: string,
  code: string,
  fetcher: Fetch = fetch,
): Promise<CodeProofResult> {
  try {
    const response = await fetcher(`${apiBaseUrl}/api/v1/finance/sign-in/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, code }),
      cache: 'no-store',
      signal: timeout(),
    });
    if (response.status === 200) {
      const body = (await response.json()) as {
        data?: { token_hash?: unknown };
      };
      const tokenHash = body.data?.token_hash;
      return typeof tokenHash === 'string' && tokenHash
        ? { kind: 'token', tokenHash, type: 'magiclink' }
        : { kind: 'unavailable' };
    }
    if (response.status === 400) return { kind: 'refused' };
    if (response.status === 429) return { kind: 'rate-limited' };
    return { kind: 'unavailable' };
  } catch {
    return { kind: 'unavailable' };
  }
}

/** Ask the server to email a code. It answers every address the same way, and
 * sends a code only to an address on Finance's access list. */
export async function requestSignInCode(
  apiBaseUrl: string,
  email: string,
  fetcher: Fetch = fetch,
): Promise<CodeRequestResult> {
  try {
    const response = await fetcher(`${apiBaseUrl}/api/v1/finance/sign-in/code`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
      cache: 'no-store',
      signal: timeout(),
    });
    if (response.status === 202) return 'accepted';
    if (response.status === 422) return 'invalid-email';
    if (response.status === 429) return 'rate-limited';
    return 'unavailable';
  } catch {
    return 'unavailable';
  }
}
