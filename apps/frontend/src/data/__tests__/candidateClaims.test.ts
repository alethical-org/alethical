import { afterEach, beforeEach, expect, it, vi } from 'vitest';
beforeEach(() => {
  vi.resetModules();
  vi.stubEnv('EXPO_PUBLIC_API_URL', 'https://api.alethical.com');
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async () =>
        new Response(JSON.stringify({ statement: null, claims: [], account_id: 'account-a' })),
    ),
  );
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
it('sends authenticated claim requests with explicit account and version guards in the body', async () => {
  const api = await import('../candidateClaims');
  const signal = new AbortController().signal;
  const identity = { expected_account_id: 'account-a', expected_version: 4 };
  await api.requestCandidateClaim(
    'test-token',
    {
      ...identity,
      candidate_id: 'a'.repeat(64),
      evidence_url: 'https://example.org/',
      request_note: 'An independent verification request',
    },
    signal,
  );
  await api.saveCandidateStatement(
    'test-token',
    'claim-a',
    { ...identity, body: 'Plain campaign words' },
    signal,
  );
  await api.removeCandidateStatement('test-token', 'claim-a', identity, signal);
  for (const [, options] of vi.mocked(fetch).mock.calls) {
    expect(options).toMatchObject({
      signal,
      cache: 'no-store',
      headers: { Authorization: 'Bearer test-token' },
    });
    expect(JSON.parse(options!.body as string)).toMatchObject(identity);
  }
  expect(vi.mocked(fetch).mock.calls[2][1]?.method).toBe('DELETE');
});
it('loads public statements and accepts reports without account data or cookies', async () => {
  const api = await import('../candidateClaims');
  const signal = new AbortController().signal;
  const id = 'a'.repeat(64);
  await api.getCandidateStatement(id, signal);
  await api.reportCandidateStatement(id, 'Reason for review', signal);
  for (const [url, options] of vi.mocked(fetch).mock.calls) {
    expect(url).toMatch(/\/candidate-statements\/[a-f0-9]{64}/);
    expect(options).toMatchObject({ cache: 'no-store', credentials: 'omit' });
    expect((options?.headers as Record<string, string>).Authorization).toBeUndefined();
  }
  expect(vi.mocked(fetch).mock.calls[1][1]?.body).toBe(
    JSON.stringify({ reason: 'Reason for review' }),
  );
});
it('keeps private statement history and staff review data on authenticated no-store requests', async () => {
  const api = await import('../candidateClaims');
  const signal = new AbortController().signal;
  await api.getPrivateCandidateStatement('test-token', 'claim-a', signal);
  await api.getAdminCandidateClaims('test-token', 'all', signal, 25);
  await api.getCandidateStatementReports('test-token', 25, signal);
  for (const [, options] of vi.mocked(fetch).mock.calls)
    expect(options).toMatchObject({
      cache: 'no-store',
      signal,
      headers: { Authorization: 'Bearer test-token' },
    });
  expect(vi.mocked(fetch).mock.calls[1][0]).toBe(
    'https://api.alethical.com/api/v1/admin/candidate-claims?status=all&offset=25&limit=25',
  );
});
