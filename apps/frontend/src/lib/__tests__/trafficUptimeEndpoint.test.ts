import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import handler from '../../../../../api/traffic-uptime';

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

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-08-15T12:00:00.000Z'));
  vi.stubEnv('CHECKLY_API_KEY', 'private-checkly-key');
  vi.stubEnv('CHECKLY_ACCOUNT_ID', 'account-id');
  vi.stubEnv('CHECKLY_WEB_CHECK_ID', 'web-id');
  vi.stubEnv('CHECKLY_TRAFFIC_CHECK_ID', 'traffic-id');
  vi.stubEnv('CHECKLY_API_READY_CHECK_ID', 'api-id');
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('Checkly uptime totals', () => {
  it('returns only 30-day availability for the 3 public checks', async () => {
    const values = new Map([
      ['web-id', 99.99],
      ['traffic-id', 99.9],
      ['api-id', 100],
    ]);
    const fetchSpy = vi.fn((input: string | URL | Request, _init?: RequestInit) => {
      const id = new URL(String(input)).pathname.split('/').pop() ?? '';
      return Promise.resolve({
        ok: true,
        json: async () => ({
          checkId: id,
          series: [{ metric: 'availability', data: [{ value: values.get(id) }] }],
        }),
      });
    });
    vi.stubGlobal('fetch', fetchSpy);
    const recorder = responseRecorder();

    await handler({ method: 'GET' }, recorder.response);

    const result = recorder.read();
    expect(result.status).toBe(200);
    expect(result.body).toEqual({
      websiteAvailability30d: 99.99,
      trafficPageAvailability30d: 99.9,
      apiAvailability30d: 100,
      fetchedAt: '2026-08-15T12:00:00.000Z',
    });
    expect(fetchSpy).toHaveBeenCalledTimes(3);
    for (const call of fetchSpy.mock.calls) {
      const [input, init] = call;
      const url = new URL(String(input));
      expect(url.searchParams.get('quickRange')).toBe('last30Days');
      expect(url.searchParams.get('metrics')).toBe('availability');
      expect(url.searchParams.get('aggregationInterval')).toBe('43200');
      expect(init?.headers).toEqual({
        Accept: 'application/json',
        Authorization: 'Bearer private-checkly-key',
        'X-Checkly-Account': 'account-id',
      });
    }
    expect(JSON.stringify(result.body)).not.toMatch(/key|account|check|url/i);
  });

  it('hides the whole uptime result when 1 monitor is missing a valid percentage', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ series: [{ metric: 'availability', data: [{ value: -1 }] }] }),
      }),
    );
    const recorder = responseRecorder();

    await handler({ method: 'GET' }, recorder.response);

    const result = recorder.read();
    expect(result.status).toBe(503);
    expect(result.body).toEqual({ error: 'Availability data is temporarily unavailable.' });
  });
});
