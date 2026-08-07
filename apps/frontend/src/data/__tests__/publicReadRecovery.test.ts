import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const API_ORIGIN = 'https://api.example.test';
const ATTEMPT_TIMEOUT_MS = 5_000;

function okSessionsResponse() {
  return new Response(JSON.stringify({ data: [] }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

async function loadApi() {
  vi.stubEnv('EXPO_PUBLIC_API_URL', API_ORIGIN);
  vi.resetModules();
  return import('../api');
}

describe('public read recovery', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('retries 1 short network failure, then returns the successful response', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(new TypeError('connection dropped'))
      .mockResolvedValueOnce(okSessionsResponse());
    vi.stubGlobal('fetch', fetchMock);
    const { listSessionsFromApi } = await loadApi();

    await expect(listSessionsFromApi()).resolves.toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('retries 1 server failure, then returns the successful response', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response('temporary failure', { status: 503 }))
      .mockResolvedValueOnce(okSessionsResponse());
    vi.stubGlobal('fetch', fetchMock);
    const { listSessionsFromApi } = await loadApi();

    await expect(listSessionsFromApi()).resolves.toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('does not retry a valid missing-record response', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response('missing', { status: 404 }));
    vi.stubGlobal('fetch', fetchMock);
    const { listSessionsFromApi } = await loadApi();

    await expect(listSessionsFromApi()).rejects.toMatchObject({ status: 404 });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('stops a public read after 2 timed attempts instead of loading forever', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(() => new Promise(() => {}));
    vi.stubGlobal('fetch', fetchMock);
    const { listSessionsFromApi } = await loadApi();

    const request = listSessionsFromApi();
    const outcome = request.then(
      () => 'resolved',
      () => 'rejected',
    );
    await vi.advanceTimersByTimeAsync(ATTEMPT_TIMEOUT_MS + 1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(ATTEMPT_TIMEOUT_MS + 1);

    await expect(outcome).resolves.toBe('rejected');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('adds no retry, request, or wait to a successful read', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(okSessionsResponse());
    vi.stubGlobal('fetch', fetchMock);
    const { listSessionsFromApi } = await loadApi();

    await expect(listSessionsFromApi()).resolves.toEqual([]);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });
});
