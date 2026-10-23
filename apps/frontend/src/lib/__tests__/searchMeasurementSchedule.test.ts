import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ identity: vi.fn(), google: vi.fn(), bing: vi.fn() }));
vi.mock('../../../../../api/traffic-google', () => ({ googleSearchIdentity: mocks.identity }));
vi.mock('../../../../../api/_lib/searchMeasurement', () => ({
  googleSearchExport: mocks.google,
  bingSearchExport: mocks.bing,
}));
import handler from '../../../../../api/search-measurements';
function recorder() {
  const result = { status: 0, body: '' };
  const response = {
    status(value: number) {
      result.status = value;
      return response;
    },
    send(value: string) {
      result.body = value;
    },
    setHeader() {},
  };
  return { response, result };
}
const auth = { authorization: `Bearer ${'c'.repeat(32)}` };
beforeEach(() => {
  vi.stubEnv('CRON_SECRET', 'c'.repeat(32));
  vi.stubEnv('SEARCH_MEASUREMENT_WRITE_TOKEN', 'w'.repeat(32));
  vi.stubEnv('VERCEL_ENV', 'production');
  vi.stubEnv('EXPO_PUBLIC_API_URL', 'https://api.alethical.com');
  vi.stubEnv('BING_WEBMASTER_SITE_URL', 'site');
  vi.stubEnv('BING_WEBMASTER_API_KEY', 'private-bing-key');
  mocks.identity.mockResolvedValue({ siteUrl: 'site', accessToken: 'private-google-token' });
  mocks.google.mockResolvedValue({ rows: ['PRIVATE QUERY'] });
  mocks.bing.mockResolvedValue({ rows: ['PRIVATE QUERY'] });
});
afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
describe('scheduled private measurements', () => {
  it('keeps raw rows only in authenticated private writes, returns only outcomes', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response('{"stored":true}'));
    vi.stubGlobal('fetch', fetcher);
    const { response, result } = recorder();
    await handler({ method: 'GET', headers: auth }, response);
    expect(result.status).toBe(200);
    expect(result.body).not.toMatch(/PRIVATE QUERY|private-google-token|private-bing-key/);
    expect(fetcher).toHaveBeenCalledTimes(5);
    for (const [url, init] of fetcher.mock.calls) {
      expect(url).toBe('https://api.alethical.com/internal/v1/search-measurements');
      expect(init.redirect).toBe('error');
      expect(init.headers['X-Search-Measurement-Token']).toBe('w'.repeat(32));
      expect(JSON.parse(init.body)).toMatchObject({
        status: 'success',
        payload: { rows: ['PRIVATE QUERY'] },
      });
    }
  });
  it('persists safe failure receipts and continues independent providers', async () => {
    mocks.google.mockRejectedValue(new Error('PRIVATE PROVIDER FAILURE'));
    const fetcher = vi.fn().mockResolvedValue(new Response('{"stored":true}'));
    vi.stubGlobal('fetch', fetcher);
    const { response, result } = recorder();
    await handler({ method: 'GET', headers: auth }, response);
    expect(result.status).toBe(503);
    expect(result.body).not.toContain('PRIVATE');
    expect(fetcher).toHaveBeenCalledTimes(5);
    expect(JSON.parse(fetcher.mock.calls[0][1].body)).toMatchObject({
      provider: 'google',
      status: 'unavailable',
      payload: null,
    });
    expect(JSON.parse(fetcher.mock.calls[4][1].body)).toMatchObject({
      provider: 'bing',
      status: 'success',
    });
  });
  it('distinguishes failed storage from a saved provider failure', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('PRIVATE STORAGE ERROR', { status: 500 })),
    );
    const { response, result } = recorder();
    await handler({ method: 'GET', headers: auth }, response);
    expect(result.status).toBe(503);
    expect(
      JSON.parse(result.body).outcomes.every(
        (item: { status: string }) => item.status === 'storage-unavailable',
      ),
    ).toBe(true);
    expect(result.body).not.toContain('PRIVATE');
  });
  it.each([
    ['EXPO_PUBLIC_API_URL', 'https://other.example'],
    ['EXPO_PUBLIC_API_URL', 'invalid'],
    ['VERCEL_ENV', 'preview'],
    ['SEARCH_MEASUREMENT_WRITE_TOKEN', 'c'.repeat(32)],
  ])('rejects unsafe %s before reading any provider', async (key, value) => {
    vi.stubEnv(key, value);
    const fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);
    const { response, result } = recorder();
    await handler({ method: 'GET', headers: auth }, response);
    expect(result.status).toBe(503);
    expect(mocks.identity).not.toHaveBeenCalled();
    expect(fetcher).not.toHaveBeenCalled();
  });
});
