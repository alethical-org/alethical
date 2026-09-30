import { afterEach, describe, expect, it, vi } from 'vitest';

import { requireSiteMetricsAdmin } from '../../../../../api/_lib/requireSiteMetricsAdmin';
import trafficHandler from '../../../../../api/traffic';
import googleHandler from '../../../../../api/traffic-google';
import bingHandler from '../../../../../api/traffic-bing';
import uptimeHandler from '../../../../../api/traffic-uptime';
import performanceHandler from '../../../../../api/traffic-performance';

function recorder() {
  const headers = new Map<string, string>();
  let status = 0;
  let body = '';
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
  return { response, read: () => ({ status, headers, body }) };
}

afterEach(() => vi.unstubAllGlobals());

describe('private Site Metrics access', () => {
  it.each([
    ['traffic', trafficHandler],
    ['google', googleHandler],
    ['bing', bingHandler],
    ['uptime', uptimeHandler],
    ['performance', performanceHandler],
  ])('rejects an unsigned %s request before contacting a provider', async (_name, handler) => {
    const provider = vi.fn();
    vi.stubGlobal('fetch', provider);
    const result = recorder();
    await handler({ method: 'GET' }, result.response);
    expect(result.read().status).toBe(401);
    expect(result.read().headers.get('Cache-Control')).toBe('private, no-store');
    expect(provider).not.toHaveBeenCalled();
  });

  it('accepts only an explicit administrator answer from the server', async () => {
    const access = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ data: { is_admin: false } }),
    });
    vi.stubGlobal('fetch', access);
    const denied = recorder();
    expect(
      await requireSiteMetricsAdmin(
        { headers: { authorization: 'Bearer sample' } },
        denied.response,
      ),
    ).toBe(false);
    expect(denied.read().status).toBe(403);
    expect(denied.read().headers.get('Vary')).toBe('Authorization');

    access.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ data: { is_admin: true } }),
    });
    const allowed = recorder();
    expect(
      await requireSiteMetricsAdmin(
        { headers: { authorization: 'Bearer sample' } },
        allowed.response,
      ),
    ).toBe(true);
    expect(allowed.read().headers.get('Cache-Control')).toBe('private, no-store');
    expect(access).toHaveBeenLastCalledWith(
      expect.stringContaining('/api/v1/admin/access'),
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer sample' }),
        cache: 'no-store',
      }),
    );
  });

  it('fails closed when the access check is unavailable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    const result = recorder();
    expect(
      await requireSiteMetricsAdmin(
        { headers: { authorization: 'Bearer sample' } },
        result.response,
      ),
    ).toBe(false);
    expect(result.read().status).toBe(503);
    expect(result.read().headers.get('X-Site-Metrics-Access')).toBe('unavailable');
  });
});
