import { afterEach, describe, expect, it, vi } from 'vitest';

import handler from '../../../../../api/traffic-collection';

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
  return {
    response,
    read: () => ({ body: JSON.parse(body), headers, status }),
  };
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('traffic collection decision', () => {
  it('does not collect an account listed in the private server setting', () => {
    vi.stubEnv('TRAFFIC_EXCLUDED_ACCOUNT_IDS', 'account-1, account-2');
    const recorder = responseRecorder();

    handler({ method: 'POST', body: { userId: 'account-2' } }, recorder.response);

    const { body, headers, status } = recorder.read();
    expect(status).toBe(200);
    expect(body).toEqual({ collect: false, teamAccount: true, teamExclusionConfigured: true });
    expect(JSON.stringify(body)).not.toContain('account-1');
    expect(JSON.stringify(body)).not.toContain('account-2');
    expect(headers.get('Cache-Control')).toBe('private, no-store');
  });

  it('collects a signed-in account that is not listed', () => {
    vi.stubEnv('TRAFFIC_EXCLUDED_ACCOUNT_IDS', 'account-1,account-2');
    const recorder = responseRecorder();

    handler({ method: 'POST', body: { userId: 'reader-3' } }, recorder.response);

    expect(recorder.read()).toMatchObject({
      body: { collect: true, teamAccount: false, teamExclusionConfigured: true },
      status: 200,
    });
  });

  it('keeps collection working before the 4 team accounts are supplied', () => {
    vi.stubEnv('TRAFFIC_EXCLUDED_ACCOUNT_IDS', '');
    const recorder = responseRecorder();

    handler({ method: 'POST', body: { userId: 'reader-3' } }, recorder.response);

    expect(recorder.read()).toMatchObject({
      body: { collect: true, teamAccount: false, teamExclusionConfigured: false },
      status: 200,
    });
  });
});
