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

/** An accepted request carries the challenge its code must be proved with. */
export type CodeRequestResult =
  | { kind: 'accepted'; challenge: string }
  | { kind: 'invalid-email' | 'rate-limited' | 'unavailable' };

export type CodeProofResult =
  | { kind: 'token'; tokenHash: string; type: 'email' }
  | { kind: 'refused' | 'rate-limited' | 'unavailable' };

/** Prove an emailed code with the challenge from the request that sent it. A
 * proved code returns a 1-time Supabase sign-in token; every other code,
 * including one never sent, gets the same refusal. */
export async function proveSignInCode(
  apiBaseUrl: string,
  email: string,
  code: string,
  challenge: string,
  fetcher: Fetch = fetch,
): Promise<CodeProofResult> {
  try {
    const response = await fetcher(`${apiBaseUrl}/api/v1/finance/sign-in/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, code, challenge }),
      cache: 'no-store',
      signal: timeout(),
    });
    if (response.status === 200) {
      const body = (await response.json()) as {
        data?: { token_hash?: unknown };
      };
      const tokenHash = body.data?.token_hash;
      return typeof tokenHash === 'string' && tokenHash
        ? { kind: 'token', tokenHash, type: 'email' }
        : { kind: 'unavailable' };
    }
    if (response.status === 400) return { kind: 'refused' };
    if (response.status === 429) return { kind: 'rate-limited' };
    return { kind: 'unavailable' };
  } catch {
    return { kind: 'unavailable' };
  }
}

/** Ask the server to email a code. It answers every address the same way, with
 * a new challenge, and sends a code only to an address on Finance's access list. */
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
    if (response.status === 202) {
      const body = (await response.json()) as { data?: { challenge?: unknown } };
      const challenge = body.data?.challenge;
      return typeof challenge === 'string' && challenge
        ? { kind: 'accepted', challenge }
        : { kind: 'unavailable' };
    }
    if (response.status === 422) return { kind: 'invalid-email' };
    if (response.status === 429) return { kind: 'rate-limited' };
    return { kind: 'unavailable' };
  } catch {
    return { kind: 'unavailable' };
  }
}
