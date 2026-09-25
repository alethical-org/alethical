import { apiRequest, ApiError } from './api';

export interface EmailPreferences {
  account_id: string;
  email: string | null;
  research: boolean | null;
  features: boolean | null;
  version: number;
}

export interface EmailPreferenceSave {
  research?: boolean;
  features?: boolean;
  expected_version: number;
  expected_account_id: string;
  expected_email: string | null;
  idempotency_key: string;
  source: 'confirmation' | 'preferences';
}

type Detail<T> = { data: T };

export async function readEmailPreferences(accessToken: string): Promise<EmailPreferences> {
  const response = await apiRequest<Detail<EmailPreferences>>(
    '/me/email-preferences',
    { method: 'GET' },
    accessToken,
  );
  return response.data;
}

export async function saveEmailPreferences(
  accessToken: string,
  changes: EmailPreferenceSave,
): Promise<EmailPreferences> {
  const response = await apiRequest<Detail<EmailPreferences>>(
    '/me/email-preferences',
    { method: 'POST', body: JSON.stringify(changes) },
    accessToken,
  );
  return response.data;
}

function publicUrl(path: string): string {
  const base = process.env.EXPO_PUBLIC_API_URL?.replace(/\/$/, '');
  if (!base) throw new Error('Public API is not configured for this deployment.');
  return `${base}/api/v1${path}`;
}

async function publicPost<T>(path: string, body: object): Promise<T> {
  const response = await fetch(publicUrl(path), {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new ApiError(response.status, await response.text());
  return (await response.json()) as T;
}

export async function createEmailSubscriptionIntent(browserKey: string): Promise<string> {
  const response = await publicPost<Detail<{ reference: string; return_to: '/money' }>>(
    '/email-subscriptions/intent',
    { browser_key: browserKey },
  );
  return response.data.reference;
}

export async function completeEmailSubscriptionIntent(
  accessToken: string,
  reference: string,
  browserKey: string,
): Promise<boolean> {
  const response = await apiRequest<Detail<{ show_confirmation: boolean; return_to: '/money' }>>(
    '/me/email-subscription-intent/complete',
    { method: 'POST', body: JSON.stringify({ reference, browser_key: browserKey }) },
    accessToken,
  );
  return response.data.show_confirmation && response.data.return_to === '/money';
}

export async function inspectEmailUnsubscribeToken(token: string): Promise<boolean> {
  const response = await publicPost<Detail<{ valid: boolean }>>(
    '/email-subscriptions/unsubscribe/inspect',
    { token },
  );
  return response.data.valid;
}

export type EmailUnsubscribeAction = 'research' | 'all';

export async function unsubscribeFromEmail(
  token: string,
  action: EmailUnsubscribeAction,
): Promise<boolean> {
  const response = await publicPost<
    Detail<{ unsubscribed: boolean; action: EmailUnsubscribeAction }>
  >('/email-subscriptions/unsubscribe', { token, action });
  return response.data.unsubscribed && response.data.action === action;
}
