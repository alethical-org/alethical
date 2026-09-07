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
  vi.setSystemTime(new Date('2026-09-07T22:42:00.000Z'));
  vi.stubEnv('CHECKLY_API_KEY', 'private-checkly-key');
  vi.stubEnv('CHECKLY_ACCOUNT_ID', 'account-id');
  vi.stubEnv('CHECKLY_WEB_CHECK_ID', 'web-id');
  vi.stubEnv('CHECKLY_TRAFFIC_CHECK_ID', '');
  vi.stubEnv('CHECKLY_API_READY_CHECK_ID', 'api-id');
  vi.stubEnv(
    'EXPO_PUBLIC_CHECKLY_STATUS_URL',
    'https://alethical-availability.checkly-dashboards.com',
  );
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('Checkly public uptime endpoint', () => {
  it('uses only the public source and returns measurement dates and monitoring history', async () => {
    const fetchSpy = vi.fn(async (input: string | URL | Request, _init?: RequestInit) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith('/metadata')) {
        return {
          ok: true,
          json: async () => ({ id: 1284690, isPrivate: false, accountId: 'account-id' }),
        };
      }
      return {
        ok: true,
        json: async () => ({
          results: ['web-id', 'api-id'].map((id) => ({
            id,
            activated: true,
            checkType: 'URL',
            frequency: 2,
            created_at: '2026-08-15T14:20:38.213Z',
            status: { updated_at: '2026-09-07T22:40:00Z', metrics: { '30dSuccessRatio': 99.9996 } },
          })),
          summary: { total: 2 },
        }),
      };
    });
    vi.stubGlobal('fetch', fetchSpy);
    const recorder = responseRecorder();

    await handler({ method: 'GET' }, recorder.response);

    const result = recorder.read();
    expect(result.status).toBe(200);
    expect(result.body).toEqual({
      websiteAvailability30d: 100,
      trafficPageAvailability30d: null,
      apiAvailability30d: 100,
      measuredAt: { website: '2026-09-07T22:40:00.000Z', api: '2026-09-07T22:40:00.000Z' },
      monitoringStartedAt: { website: '2026-08-15T14:20:38.213Z', api: '2026-08-15T14:20:38.213Z' },
      measurementSource: { website: 'status-page', api: 'status-page' },
      fetchedAt: '2026-09-07T22:42:00.000Z',
    });
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(String(fetchSpy.mock.calls[0][0])).toBe(
      'https://api.checklyhq.com/v1/status-page/alethical-availability/metadata?type=customUrl',
    );
    expect(String(fetchSpy.mock.calls[1][0])).toBe(
      'https://api.checklyhq.com/v1/status-page/1284690/statuses?page=1&limit=15',
    );
    for (const [input, init] of fetchSpy.mock.calls) {
      expect(new URL(String(input)).hostname).toBe('api.checklyhq.com');
      expect(init?.headers).toEqual({ Accept: 'application/json' });
      expect(init?.signal).toBeInstanceOf(AbortSignal);
    }
    expect(result.headers.get('Cache-Control')).toBe(
      'public, max-age=0, s-maxage=300, stale-while-revalidate=60',
    );
    expect(JSON.stringify(result.body)).not.toMatch(/private-checkly-key|account-id|web-id|api-id/);
  });

  it.each(['CHECKLY_ACCOUNT_ID', 'CHECKLY_WEB_CHECK_ID', 'CHECKLY_API_READY_CHECK_ID'])(
    'requires configured identity %s before fetching',
    async (key) => {
      vi.stubEnv(key, '');
      const fetchSpy = vi.fn();
      vi.stubGlobal('fetch', fetchSpy);
      const recorder = responseRecorder();
      await handler({ method: 'GET' }, recorder.response);
      expect(recorder.read().status).toBe(503);
      expect(recorder.read().headers.get('Cache-Control')).toBe('no-store');
      expect(fetchSpy).not.toHaveBeenCalled();
    },
  );

  it('refuses a shared monitor id for 2 different services', async () => {
    vi.stubEnv('CHECKLY_API_READY_CHECK_ID', 'web-id');
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const recorder = responseRecorder();
    await handler({ method: 'GET' }, recorder.response);
    expect(recorder.read().status).toBe(503);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('rejects methods other than GET without fetching', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const recorder = responseRecorder();
    await handler({ method: 'POST' }, recorder.response);
    expect(recorder.read().status).toBe(405);
    expect(recorder.read().headers.get('Allow')).toBe('GET');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('does not expose upstream errors in an unavailable response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('private upstream detail')));
    const recorder = responseRecorder();
    await handler({ method: 'GET' }, recorder.response);
    expect(recorder.read().status).toBe(503);
    expect(recorder.read().body).toEqual({
      error: 'Availability data is temporarily unavailable.',
    });
    expect(recorder.read().headers.get('Cache-Control')).toBe('no-store');
  });
});
