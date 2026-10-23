import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('@vercel/oidc', () => ({ getVercelOidcToken: vi.fn() }));
vi.mock('google-auth-library', () => ({ ExternalAccountClient: { fromJSON: vi.fn() } }));
import google from '../../../../../api/traffic-google';
import bing from '../../../../../api/traffic-bing';
import scheduled from '../../../../../api/search-measurements';
function recorder() {
  const result = { status: 0, body: '', headers: {} as Record<string, string> };
  const response = {
    status(value: number) {
      result.status = value;
      return response;
    },
    send(value: string) {
      result.body = value;
    },
    setHeader(key: string, value: string) {
      result.headers[key] = value;
    },
  };
  return { response, result };
}
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
describe('private export access', () => {
  it.each([
    ['google', google],
    ['bing', bing],
  ] as const)('denies anonymous %s exports before any provider request', async (_, handler) => {
    const fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);
    const { response, result } = recorder();
    await handler({ method: 'GET', url: '/?view=queries' }, response);
    expect(result.status).toBe(401);
    expect(result.headers['Cache-Control']).toBe('private, no-store');
    expect(fetcher).not.toHaveBeenCalled();
  });
  it.each([
    ['google', google],
    ['bing', bing],
  ] as const)('denies a non-admin %s export without provider access', async (_, handler) => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ data: { is_admin: false } })));
    vi.stubGlobal('fetch', fetcher);
    const { response, result } = recorder();
    await handler(
      { method: 'GET', url: '/?view=queries', headers: { authorization: 'Bearer reader' } },
      response,
    );
    expect(result.status).toBe(403);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(String(fetcher.mock.calls[0][0])).toContain('/admin/access');
  });
  it('does not let missing cron configuration or a browser token run collection', async () => {
    const fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);
    vi.stubEnv('CRON_SECRET', '');
    const first = recorder();
    await scheduled({ method: 'GET' }, first.response);
    expect(first.result.status).toBe(401);
    vi.stubEnv('CRON_SECRET', 'x'.repeat(32));
    const second = recorder();
    await scheduled(
      { method: 'GET', headers: { authorization: 'Bearer reader' } },
      second.response,
    );
    expect(second.result.status).toBe(401);
    expect(fetcher).not.toHaveBeenCalled();
  });
});
