import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import handler from '../../../../../api/traffic-bing';

function responseRecorder() {
  const headers = new Map<string, string>();
  let body = '';
  let status = 0;
  const response = {
    setHeader(name: string, value: string) {
      headers.set(name, value);
    },
    status(code: number) {
      status = code;
      return response;
    },
    send(value: string) {
      body = value;
    },
  };
  return { response, read: () => ({ body: JSON.parse(body), headers, status }) };
}

function isoDates(start: string, count: number) {
  const startMs = Date.parse(`${start}T00:00:00.000Z`);
  return Array.from({ length: count }, (_, index) =>
    new Date(startMs + index * 86_400_000).toISOString().slice(0, 10),
  );
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-08-15T12:00:00.000Z'));
  vi.stubEnv('BING_WEBMASTER_API_KEY', 'private-bing-key');
  vi.stubEnv('BING_WEBMASTER_SITE_URL', 'https://alethical.com/');
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('Bing search totals', () => {
  it('returns 2 exact 28-day finalized windows without exposing the key', async () => {
    const rows = isoDates('2026-06-18', 56).map((Date) => ({ Clicks: 2, Date, Impressions: 20 }));
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ d: rows }) });
    vi.stubGlobal('fetch', fetchSpy);
    const recorder = responseRecorder();

    await handler({ method: 'GET' }, recorder.response);

    const result = recorder.read();
    expect(result.status).toBe(200);
    expect(result.body).toEqual({
      clicks28d: 56,
      impressions28d: 560,
      previousClicks28d: 56,
      previousImpressions28d: 560,
      periodStartedOn: '2026-07-16',
      periodEndedOn: '2026-08-12',
      previousPeriodStartedOn: '2026-06-18',
      previousPeriodEndedOn: '2026-07-15',
      fetchedAt: '2026-08-15T12:00:00.000Z',
    });
    expect(JSON.stringify(result.body)).not.toContain('private-bing-key');
    const requested = new URL(String(fetchSpy.mock.calls[0][0]));
    expect(requested.origin + requested.pathname).toBe(
      'https://ssl.bing.com/webmaster/api.svc/json/GetRankAndTrafficStats',
    );
    expect(requested.searchParams.get('siteUrl')).toBe('https://alethical.com/');
    expect(requested.searchParams.get('apikey')).toBe('private-bing-key');
  });

  it('treats malformed vendor data as unavailable, not zero', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ d: [{}] }) }),
    );
    const recorder = responseRecorder();

    await handler({ method: 'GET' }, recorder.response);

    const result = recorder.read();
    expect(result.status).toBe(503);
    expect(result.body).toEqual({ error: 'Bing search data is temporarily unavailable.' });
    expect(result.headers.get('Cache-Control')).toBe('no-store');
  });
});
