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

function measuredGroup(sampleSize: unknown = 50) {
  return {
    quantiles: {
      largestContentfulPaintP75: 4_716_000,
      interactionToNextPaintP75: 64_000,
      cumulativeLayoutShiftP75: 0,
    },
    confidence: {
      sum: {
        lcpTotal: { sampleSize },
        inpTotal: { sampleSize },
        clsTotal: { sampleSize },
      },
    },
    avg: { sampleInterval: 10.023584905660377 },
  };
}

function mockGroup(group: unknown, errors: unknown = null, everyClient: unknown = group) {
  const fetchSpy = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({
      data: { viewer: { accounts: [{ vitals: [group], everyClient: [everyClient] }] } },
      errors,
    }),
  });
  vi.stubGlobal('fetch', fetchSpy);
  return fetchSpy;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-15T12:00:00.000Z'));
  vi.stubEnv('CLOUDFLARE_ANALYTICS_API_TOKEN', 'private-cloudflare-token');
  vi.stubEnv('CLOUDFLARE_ACCOUNT_ID', 'account-id');
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('Cloudflare document-load speed totals', () => {
  it('returns rounded p75 scores for 30 complete UTC days with actual sample counts', async () => {
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
                    confidence: {
                      sum: {
                        lcpTotal: { sampleSize: 120 },
                        inpTotal: { sampleSize: 80 },
                        clsTotal: { sampleSize: 110 },
                      },
                    },
                    avg: { sampleInterval: 1 },
                  },
                ],
                everyClient: [
                  {
                    quantiles: {
                      largestContentfulPaintP75: 4_400_000,
                      interactionToNextPaintP75: 123_456,
                      cumulativeLayoutShiftP75: 1,
                    },
                    confidence: {
                      sum: {
                        lcpTotal: { sampleSize: 7495 },
                        inpTotal: { sampleSize: 80 },
                        clsTotal: { sampleSize: 110 },
                      },
                    },
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
      automatedSamples: 7375,
      automatedClientsSeparated: true,
      measurementScope: 'document-loads',
      navigationTypes: ['navigate', 'reload', 'back-forward', 'restore', 'prerender'],
      knownBotsExcluded: true,
      measurementSource: 'cloudflare-web-analytics',
      sampleCountSource: 'cloudflare-confidence',
      minimumSamples: 50,
      periodStartedOn: '2026-09-15',
      periodEndedOn: '2026-10-14',
      fetchedAt: '2026-10-15T12:00:00.000Z',
    });
    const [url, init] = fetchSpy.mock.calls[0];
    expect(String(url)).toBe('https://api.cloudflare.com/client/v4/graphql');
    expect(init.headers.Authorization).toBe('Bearer private-cloudflare-token');
    const requestBody = JSON.parse(String(init.body));
    expect(requestBody.variables).toEqual({
      accountTag: 'account-id',
      host: 'www.alethical.com',
      start: '2026-09-15',
      end: '2026-10-14',
    });
    expect(requestBody.query).not.toMatch(/path|referrer|country|device|element|resource/i);
    // Browser and version separate the automated client pool and do nothing else:
    // they appear only in not-equal and not-in clauses, never as something grouped
    // by, so no reader is ever counted or published by what they browse with.
    expect(requestBody.query).toContain('userAgentBrowser_neq:');
    expect(requestBody.query).toContain('browserVersion_notin:');
    expect(requestBody.query).not.toMatch(/browserVersion\s*}/);
    expect(requestBody.query).not.toMatch(/userAgentBrowser\s*}/);
    expect(requestBody.query).toContain('bot: 0');
    expect(requestBody.query).toContain(
      'navigationType_in: ["navigate","reload","back-forward","restore","prerender"]',
    );
    expect(requestBody.query).toContain('confidence(level: 0.95)');
    expect(requestBody.query).not.toContain('deliveryType:');
  });

  it('returns null for a score with fewer than 50 samples', async () => {
    mockGroup({
      quantiles: {
        largestContentfulPaintP75: 1_000_000,
        interactionToNextPaintP75: 100_000,
        cumulativeLayoutShiftP75: 0.01,
      },
      confidence: {
        sum: {
          lcpTotal: { sampleSize: 49 },
          inpTotal: { sampleSize: 0 },
          clsTotal: { sampleSize: 10 },
        },
      },
      avg: { sampleInterval: 1 },
    });
    const recorder = responseRecorder();

    await handler({ method: 'GET' }, recorder.response);

    expect(recorder.read().body).toMatchObject({ lcpP75Ms: null, inpP75Ms: null, clsP75: null });
  });

  it('withholds a reader score once the automated pool leaves too few measurements', async () => {
    // What this prevents: on 15 to 21 Sep 2026, /money/search drew 7,834 document
    // loads and 7 of them were not the pool. Scoring 7 measurements would publish a
    // reader figure resting on almost nothing; "Building sample" is the honest answer.
    mockGroup(measuredGroup(7), null, measuredGroup(7834));
    const recorder = responseRecorder();

    await handler({ method: 'GET' }, recorder.response);

    expect(recorder.read().body).toMatchObject({
      lcpP75Ms: null,
      lcpSamples: 7,
      automatedSamples: 7827,
      automatedClientsSeparated: true,
    });
  });

  it('shortens the window to the first day the pool can be separated', async () => {
    // Cloudflare recorded no browser version before 2026-09-12, so a longer window
    // would publish a figure with the pool still in it. The page prints the window
    // it actually read, so a shortened one is visible rather than silent.
    vi.setSystemTime(new Date('2026-09-25T12:00:00.000Z'));
    const fetchSpy = mockGroup(measuredGroup());
    const recorder = responseRecorder();

    await handler({ method: 'GET' }, recorder.response);

    expect(recorder.read().body).toMatchObject({
      periodStartedOn: '2026-09-12',
      periodEndedOn: '2026-09-24',
    });
    expect(JSON.parse(String(fetchSpy.mock.calls[0][1].body)).variables).toMatchObject({
      start: '2026-09-12',
      end: '2026-09-24',
    });
  });

  it('never reports more readers than clients', async () => {
    mockGroup(measuredGroup(500), null, measuredGroup(400));
    const recorder = responseRecorder();

    await handler({ method: 'GET' }, recorder.response);

    expect(recorder.read().status).toBe(503);
  });

  it('does not treat adaptive estimates as actual measurements or divide by an average', async () => {
    const group = measuredGroup();
    group.confidence.sum.lcpTotal.sampleSize = 1045;
    group.confidence.sum.inpTotal.sampleSize = 12;
    group.confidence.sum.clsTotal.sampleSize = 1042;
    mockGroup({ ...group, sum: { lcpTotal: 10470, inpTotal: 120, clsTotal: 10440 } });
    const recorder = responseRecorder();

    await handler({ method: 'GET' }, recorder.response);

    expect(recorder.read().body).toMatchObject({
      lcpP75Ms: 4716,
      lcpSamples: 1045,
      inpP75Ms: null,
      inpSamples: 12,
      clsP75: 0,
      clsSamples: 1042,
      sampleInterval: 10.023584905660377,
    });
  });

  it('publishes scores at exactly 50 measurements and retains a genuine zero score', async () => {
    mockGroup(measuredGroup(50), []);
    const recorder = responseRecorder();

    await handler({ method: 'GET' }, recorder.response);

    expect(recorder.read().body).toMatchObject({ lcpP75Ms: 4716, inpP75Ms: 64, clsP75: 0 });
    expect(recorder.read().headers.get('Cache-Control')).toBe(
      'public, max-age=0, s-maxage=300, stale-while-revalidate=60',
    );
  });

  it('returns a collecting state for zero measurements, including source negative sentinels', async () => {
    const group = measuredGroup(0);
    group.quantiles.largestContentfulPaintP75 = -1;
    group.quantiles.interactionToNextPaintP75 = -1;
    group.quantiles.cumulativeLayoutShiftP75 = -1;
    mockGroup(group);
    const recorder = responseRecorder();

    await handler({ method: 'GET' }, recorder.response);

    expect(recorder.read().status).toBe(200);
    expect(recorder.read().body).toMatchObject({
      lcpP75Ms: null,
      lcpSamples: 0,
      inpP75Ms: null,
      inpSamples: 0,
      clsP75: null,
      clsSamples: 0,
    });
  });

  it.each([undefined, null, '50', -1, 49.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])(
    'does not turn a missing or invalid sample count %s into zero or an estimate',
    async (sampleSize) => {
      const group = measuredGroup();
      group.confidence.sum.inpTotal.sampleSize = sampleSize;
      mockGroup({ ...group, sum: { lcpTotal: 500, inpTotal: 500, clsTotal: 500 } });
      const recorder = responseRecorder();

      await handler({ method: 'GET' }, recorder.response);

      expect(recorder.read().status).toBe(503);
      expect(recorder.read().body).toEqual({
        error: 'Page speed data is temporarily unavailable.',
      });
      expect(recorder.read().headers.get('Cache-Control')).toBe('no-store');
    },
  );

  it('does not call a malformed score collecting when enough measurements exist', async () => {
    const group = measuredGroup();
    group.quantiles.largestContentfulPaintP75 = -1;
    mockGroup(group);
    const recorder = responseRecorder();

    await handler({ method: 'GET' }, recorder.response);

    expect(recorder.read().status).toBe(503);
  });

  it.each([null, '10', 0, Infinity])(
    'rejects an invalid sampling interval %s',
    async (sampleInterval) => {
      mockGroup({ ...measuredGroup(), avg: { sampleInterval } });
      const recorder = responseRecorder();

      await handler({ method: 'GET' }, recorder.response);

      expect(recorder.read().status).toBe(503);
    },
  );

  it('marks source errors unavailable rather than showing a collecting state', async () => {
    mockGroup(measuredGroup(), [{ message: 'private source detail' }]);
    const recorder = responseRecorder();

    await handler({ method: 'GET' }, recorder.response);

    expect(recorder.read().status).toBe(503);
    expect(recorder.read().body).toEqual({ error: 'Page speed data is temporarily unavailable.' });
  });

  it('marks an absent source group unavailable rather than inventing zero measurements', async () => {
    mockGroup(undefined);
    const recorder = responseRecorder();

    await handler({ method: 'GET' }, recorder.response);

    expect(recorder.read().status).toBe(503);
  });

  it('handles source transport failures without leaking source details', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('private source detail')));
    const recorder = responseRecorder();

    await handler({ method: 'GET' }, recorder.response);

    expect(recorder.read().status).toBe(503);
    expect(recorder.read().body).toEqual({ error: 'Page speed data is temporarily unavailable.' });
  });

  it('requires configured source access without making a request', async () => {
    vi.stubEnv('CLOUDFLARE_ANALYTICS_API_TOKEN', '');
    const fetchSpy = mockGroup(measuredGroup());
    const recorder = responseRecorder();

    await handler({ method: 'GET' }, recorder.response);

    expect(recorder.read().status).toBe(503);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('rejects methods other than GET without making a request', async () => {
    const fetchSpy = mockGroup(measuredGroup());
    const recorder = responseRecorder();

    await handler({ method: 'POST' }, recorder.response);

    expect(recorder.read().status).toBe(405);
    expect(recorder.read().headers.get('Allow')).toBe('GET');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('keeps 30 complete dates across a year boundary and excludes the current UTC day', async () => {
    vi.setSystemTime(new Date('2027-01-01T00:00:00.000Z'));
    const fetchSpy = mockGroup(measuredGroup());
    const recorder = responseRecorder();

    await handler({ method: 'GET' }, recorder.response);

    expect(recorder.read().body).toMatchObject({
      periodStartedOn: '2026-12-02',
      periodEndedOn: '2026-12-31',
    });
    expect(JSON.parse(String(fetchSpy.mock.calls[0][1].body)).variables).toMatchObject({
      start: '2026-12-02',
      end: '2026-12-31',
    });
  });
});
