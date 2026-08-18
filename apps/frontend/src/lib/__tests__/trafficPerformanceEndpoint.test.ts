import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import handler from '../../../../../api/traffic-performance';

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
  vi.stubEnv('CLOUDFLARE_ANALYTICS_API_TOKEN', 'private-cloudflare-token');
  vi.stubEnv('CLOUDFLARE_ACCOUNT_ID', 'account-id');
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('Cloudflare real-reader speed totals', () => {
  it('returns only rounded 28-day p75 scores with enough browser samples', async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: {
          viewer: {
            accounts: [
              {
                vitals: [
                  {
                    quantiles: {
                      largestContentfulPaintP75: 2_345_678,
                      interactionToNextPaintP75: 123_456,
                      cumulativeLayoutShiftP75: 0.0876,
                    },
                    sum: { lcpTotal: 120, inpTotal: 80, clsTotal: 110 },
                    avg: { sampleInterval: 1 },
                  },
                ],
              },
            ],
          },
        },
      }),
    });
    vi.stubGlobal('fetch', fetchSpy);
    const recorder = responseRecorder();

    await handler({ method: 'GET' }, recorder.response);

    const result = recorder.read();
    expect(result.status).toBe(200);
    expect(result.body).toEqual({
      lcpP75Ms: 2346,
      lcpSamples: 120,
      inpP75Ms: 123,
      inpSamples: 80,
      clsP75: 0.088,
      clsSamples: 110,
      sampleInterval: 1,
      periodStartedOn: '2026-07-19',
      periodEndedOn: '2026-08-15',
      fetchedAt: '2026-08-15T12:00:00.000Z',
    });
    const [url, init] = fetchSpy.mock.calls[0];
    expect(String(url)).toBe('https://api.cloudflare.com/client/v4/graphql');
    expect(init.headers.Authorization).toBe('Bearer private-cloudflare-token');
    const requestBody = JSON.parse(String(init.body));
    expect(requestBody.variables).toEqual({
      accountTag: 'account-id',
      host: 'www.alethical.com',
      start: '2026-07-19',
      end: '2026-08-15',
    });
    expect(requestBody.query).not.toMatch(/path|referrer|country|device|browser|element|resource/i);
  });

  it('returns null for a score with fewer than 50 samples', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          data: {
            viewer: {
              accounts: [
                {
                  vitals: [
                    {
                      quantiles: {
                        largestContentfulPaintP75: 1_000_000,
                        interactionToNextPaintP75: 100_000,
                        cumulativeLayoutShiftP75: 0.01,
                      },
                      sum: { lcpTotal: 49, inpTotal: 0, clsTotal: 10 },
                      avg: { sampleInterval: 1 },
                    },
                  ],
                },
              ],
            },
          },
        }),
      }),
    );
    const recorder = responseRecorder();

    await handler({ method: 'GET' }, recorder.response);

    expect(recorder.read().body).toMatchObject({ lcpP75Ms: null, inpP75Ms: null, clsP75: null });
  });
});
