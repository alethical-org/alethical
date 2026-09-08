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

describe('retired unauthenticated collection decision', () => {
  it.each(['GET', 'POST', 'OPTIONS', 'DELETE'])(
    'fails closed for %s without disclosing account membership',
    (method) => {
      vi.stubEnv('TRAFFIC_EXCLUDED_ACCOUNT_IDS', 'team-account');
      for (const userId of ['team-account', 'reader-account', '']) {
        const recorder = responseRecorder();
        handler({ method, body: { userId } }, recorder.response);
        const { body, headers, status } = recorder.read();
        expect(status).toBe(410);
        expect(body).toEqual({ error: 'Reload to use the current collection check.' });
        expect(headers.get('Cache-Control')).toBe('private, no-store');
        expect(body).not.toHaveProperty('collect');
        expect(body).not.toHaveProperty('teamAccount');
      }
    },
  );
});
