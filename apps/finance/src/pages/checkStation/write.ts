import { REQUEST_TIMEOUT_MS } from '../../api/client';

/** What a check write answered. A refusal carries the server's fixed sentence
 * naming the rule the check broke (finance_station_checks.py). */
export type WriteResult =
  | { state: 'saved'; id: string; status: 'checked' | 'withdrawn' }
  | { state: 'refused'; detail: string }
  | { state: 'conflict'; detail: string }
  | { state: 'gone' }
  | { state: 'failed' };

/** 1 POST to a Finance check route with this account's token. Nothing is retried:
 * a repeated save is the reader's own choice, made with Try again. */
export async function postCheck(
  apiBaseUrl: string,
  accessToken: string | null,
  path: string,
  body: unknown,
  fetcher: typeof fetch = fetch,
): Promise<WriteResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetcher(`${apiBaseUrl}/api/v1/${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      },
      body: JSON.stringify(body),
      cache: 'no-store',
      signal: controller.signal,
    });
    const answer = (await response.json().catch(() => null)) as {
      data?: { id?: unknown; status?: unknown };
      detail?: unknown;
    } | null;
    const detail = typeof answer?.detail === 'string' ? answer.detail : '';
    if (response.status === 404) return { state: 'gone' };
    if (response.status === 409) return { state: 'conflict', detail };
    if (response.status === 422) return { state: 'refused', detail };
    if (!response.ok) return { state: 'failed' };
    const id = answer?.data?.id;
    const status = answer?.data?.status;
    if (typeof id !== 'string' || (status !== 'checked' && status !== 'withdrawn'))
      return { state: 'failed' };
    return { state: 'saved', id, status };
  } catch {
    return { state: 'failed' };
  } finally {
    clearTimeout(timer);
  }
}
