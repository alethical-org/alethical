const KEY = 'alethical-unconcealed-pending-v1';

export interface EmailSubscriptionIntent {
  reference: string;
  browserKey: string;
  authReady: boolean;
}

export function newEmailSubscriptionBrowserKey(): string {
  if (typeof crypto === 'undefined' || typeof crypto.randomUUID !== 'function') {
    throw new Error('Secure browser random numbers are unavailable.');
  }
  return crypto.randomUUID();
}

export function saveEmailSubscriptionIntent(value: EmailSubscriptionIntent): void {
  window.sessionStorage.setItem(KEY, JSON.stringify(value));
}

export function readEmailSubscriptionIntent(): EmailSubscriptionIntent | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.sessionStorage.getItem(KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    const value = parsed as Partial<EmailSubscriptionIntent>;
    return typeof value.reference === 'string' &&
      value.reference.length >= 32 &&
      typeof value.browserKey === 'string' &&
      value.browserKey.length >= 32
      ? {
          reference: value.reference,
          browserKey: value.browserKey,
          authReady: value.authReady === true,
        }
      : null;
  } catch {
    return null;
  }
}

export const EMAIL_SUBSCRIPTION_AUTH_READY_EVENT = 'alethical-unconcealed-auth-ready';

export function markEmailSubscriptionIntentAuthReady(): void {
  const pending = readEmailSubscriptionIntent();
  if (!pending) return;
  saveEmailSubscriptionIntent({ ...pending, authReady: true });
  window.dispatchEvent(new Event(EMAIL_SUBSCRIPTION_AUTH_READY_EVENT));
}

export function clearEmailSubscriptionIntent(): void {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.removeItem(KEY);
  } catch {
    /* Storage can be unavailable. */
  }
}
