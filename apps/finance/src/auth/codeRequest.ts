/** This tab's newest code request, kept in sessionStorage so a reload or a tab
 * the phone dropped still proves the emailed code with the right challenge.
 * Storage can be missing or refuse; then it lives only as long as the page. */

const STORAGE_KEY = 'alethical-finance-code-request';

/** The server's code lifetime; after it nothing this tab holds can prove a code. */
export const CODE_LIFETIME_MS = 10 * 60 * 1000;

export type CodeRequest = { email: string; challenge: string; requestedAt: number };

export function readCodeRequest(now = Date.now()): CodeRequest | null {
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<CodeRequest> | null;
    if (
      typeof value?.email !== 'string' ||
      !value.email ||
      typeof value.challenge !== 'string' ||
      !value.challenge ||
      typeof value.requestedAt !== 'number' ||
      value.requestedAt > now ||
      now - value.requestedAt >= CODE_LIFETIME_MS
    ) {
      return null;
    }
    return { email: value.email, challenge: value.challenge, requestedAt: value.requestedAt };
  } catch {
    return null;
  }
}

/** Keep the newest request; its challenge proves whichever code it was bound to. */
export function rememberCodeRequest(
  email: string,
  challenge: string,
  now = Date.now(),
): CodeRequest {
  const request = { email, challenge, requestedAt: now };
  try {
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(request));
  } catch {
    // The page still holds it.
  }
  return request;
}

export function forgetCodeRequest() {
  try {
    window.sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // Nothing was kept.
  }
}
