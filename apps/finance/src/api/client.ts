/** The few Finance server calls the shell makes. Every answer is private to
 * the account that asked (the server marks it private, no-store). */

export type AccessState = 'granted' | 'no-access' | 'signed-out' | 'unavailable';

type Fetch = typeof fetch;

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
    });
    return accessFromStatus(response.status);
  } catch {
    return 'unavailable';
  }
}

export type CodeRequestResult = 'accepted' | 'invalid-email' | 'rate-limited' | 'unavailable';

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
    });
    if (response.status === 202) return 'accepted';
    if (response.status === 422) return 'invalid-email';
    if (response.status === 429) return 'rate-limited';
    return 'unavailable';
  } catch {
    return 'unavailable';
  }
}
