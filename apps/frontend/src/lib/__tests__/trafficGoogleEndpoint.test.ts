import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const googleAuth = vi.hoisted(() => ({
  getAccessToken: vi.fn(),
  scopes: [] as string[],
}));
const fromJSON = vi.hoisted(() => vi.fn(() => googleAuth));
const getVercelOidcToken = vi.hoisted(() => vi.fn());

vi.mock('@vercel/oidc', () => ({ getVercelOidcToken }));
vi.mock('google-auth-library', () => ({ ExternalAccountClient: { fromJSON } }));

import handler from '../../../../../api/traffic-google';

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
  vi.stubEnv('GOOGLE_SEARCH_CONSOLE_GCP_PROJECT_NUMBER', '492188995407');
  vi.stubEnv(
    'GOOGLE_SEARCH_CONSOLE_SERVICE_ACCOUNT_EMAIL',
    'traffic-reader@alethical-495817.iam.gserviceaccount.com',
  );
  vi.stubEnv('GOOGLE_SEARCH_CONSOLE_WORKLOAD_IDENTITY_POOL_ID', 'vercel');
  vi.stubEnv('GOOGLE_SEARCH_CONSOLE_WORKLOAD_IDENTITY_PROVIDER_ID', 'vercel');
  vi.stubEnv('GOOGLE_SEARCH_CONSOLE_SITE_URL', 'sc-domain:alethical.com');
  getVercelOidcToken.mockResolvedValue('vercel-oidc-token');
  googleAuth.getAccessToken.mockResolvedValue({ token: 'short-lived-token' });
  googleAuth.scopes = [];
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('Google search totals', () => {
  it('returns 2 exact 28-day windows made only from finalized dates', async () => {
    const rows = isoDates('2026-06-18', 56).map((date) => ({
      keys: [date],
      clicks: 1,
      impressions: 10,
    }));
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ rows, metadata: { first_incomplete_date: '2026-08-13' } }),
    });
    vi.stubGlobal('fetch', fetchSpy);
    const recorder = responseRecorder();

    await handler({ method: 'GET' }, recorder.response);

    const result = recorder.read();
    expect(result.status).toBe(200);
    expect(result.body).toEqual({
      clicks28d: 28,
      impressions28d: 280,
      previousClicks28d: 28,
      previousImpressions28d: 280,
      periodStartedOn: '2026-07-16',
      periodEndedOn: '2026-08-12',
      previousPeriodStartedOn: '2026-06-18',
      previousPeriodEndedOn: '2026-07-15',
      fetchedAt: '2026-08-15T12:00:00.000Z',
    });
    expect(googleAuth.scopes).toEqual(['https://www.googleapis.com/auth/webmasters.readonly']);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0];
    expect(String(url)).toBe(
      'https://www.googleapis.com/webmasters/v3/sites/sc-domain%3Aalethical.com/searchAnalytics/query',
    );
    expect(init.headers).toEqual({
      Accept: 'application/json',
      Authorization: 'Bearer short-lived-token',
      'Content-Type': 'application/json',
    });
    expect(JSON.parse(String(init.body))).toEqual({
      startDate: '2026-06-06',
      endDate: '2026-08-14',
      dimensions: ['date'],
      type: 'web',
      aggregationType: 'byProperty',
      dataState: 'all',
      rowLimit: 100,
    });
  });

  it('returns 2 exact 30-day windows for the Site metrics contract', async () => {
    const rows = isoDates('2026-06-14', 60).map((date) => ({
      keys: [date],
      clicks: 1,
      impressions: 10,
    }));
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ rows, metadata: { first_incomplete_date: '2026-08-13' } }),
      }),
    );
    const recorder = responseRecorder();

    await handler({ method: 'GET', url: '/api/traffic-google?window=30' }, recorder.response);

    expect(recorder.read()).toMatchObject({
      status: 200,
      body: {
        clicks30d: 30,
        impressions30d: 300,
        previousClicks30d: 30,
        previousImpressions30d: 300,
        periodStartedOn: '2026-07-14',
        periodEndedOn: '2026-08-12',
        previousPeriodStartedOn: '2026-06-14',
        previousPeriodEndedOn: '2026-07-13',
        fetchedAt: '2026-08-15T12:00:00.000Z',
      },
    });
    expect(Object.keys(recorder.read().body).sort()).toEqual(
      [
        'clicks30d',
        'fetchedAt',
        'impressions30d',
        'periodEndedOn',
        'periodStartedOn',
        'previousClicks30d',
        'previousImpressions30d',
        'previousPeriodEndedOn',
        'previousPeriodStartedOn',
      ].sort(),
    );
  });

  it('fails closed without settings and never returns a Google detail dimension', async () => {
    vi.stubEnv('GOOGLE_SEARCH_CONSOLE_GCP_PROJECT_NUMBER', '');
    const recorder = responseRecorder();

    await handler({ method: 'GET' }, recorder.response);

    const result = recorder.read();
    expect(result.status).toBe(503);
    expect(result.headers.get('Cache-Control')).toBe('no-store');
    expect(result.body).toEqual({ error: 'Google search data is temporarily unavailable.' });
    expect(JSON.stringify(result.body)).not.toMatch(/query|page|country|device|position/i);
  });

  it('logs only the safe failed stage when Google identity exchange fails', async () => {
    googleAuth.getAccessToken.mockRejectedValue(
      new Error('private Google response that must never be logged'),
    );
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const recorder = responseRecorder();

    await handler({ method: 'GET' }, recorder.response);

    expect(recorder.read()).toMatchObject({
      status: 503,
      body: { error: 'Google search data is temporarily unavailable.' },
    });
    expect(errorSpy).toHaveBeenCalledOnce();
    expect(errorSpy).toHaveBeenCalledWith('traffic-google unavailable', {
      stage: 'access-token',
    });
    expect(JSON.stringify(errorSpy.mock.calls)).not.toMatch(
      /private Google response|short-lived-token|traffic-reader|492188995407|alethical\.com/i,
    );
  });

  it('separates a missing Vercel identity from Google token failures', async () => {
    getVercelOidcToken.mockRejectedValue(
      new Error('private Vercel token error that must never be logged'),
    );
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const recorder = responseRecorder();

    await handler({ method: 'GET' }, recorder.response);

    expect(recorder.read().status).toBe(503);
    expect(errorSpy).toHaveBeenCalledWith('traffic-google unavailable', {
      stage: 'vercel-oidc-token',
    });
    expect(fromJSON).not.toHaveBeenCalled();
    expect(JSON.stringify(errorSpy.mock.calls)).not.toContain('private Vercel token error');
  });

  it.each([
    ['google-token-exchange', 'https://sts.googleapis.com/v1/token'],
    [
      'service-account-token',
      'https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/private:generateAccessToken',
    ],
  ])('separates the safe %s stage without logging Google details', async (stage, url) => {
    googleAuth.getAccessToken.mockRejectedValue(
      Object.assign(new Error('private Google response that must never be logged'), {
        config: { url },
      }),
    );
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const recorder = responseRecorder();

    await handler({ method: 'GET' }, recorder.response);

    expect(recorder.read().status).toBe(503);
    expect(errorSpy).toHaveBeenCalledWith('traffic-google unavailable', { stage });
    expect(JSON.stringify(errorSpy.mock.calls)).not.toMatch(/private|googleapis/i);
  });

  it('shows a successful empty Google period as a real zero', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ metadata: { first_incomplete_date: '2026-08-13' } }),
      }),
    );
    const recorder = responseRecorder();

    await handler({ method: 'GET' }, recorder.response);

    expect(recorder.read()).toMatchObject({
      status: 200,
      body: {
        clicks28d: 0,
        impressions28d: 0,
        previousClicks28d: 0,
        previousImpressions28d: 0,
      },
    });
  });
});
