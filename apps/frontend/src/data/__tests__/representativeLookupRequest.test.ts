import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const responseBody = {
  data: {
    status: 'address-choice',
    resolved_place: { address_text: '350 S 5th St, Minneapolis, MN 55415' },
    address_choices: [
      {
        matched_address: '350 S 5TH ST, MINNEAPOLIS, MN 55415',
        latitude: 44.976,
        longitude: -93.266,
      },
    ],
  },
};

function successfulResponse() {
  return new Response(JSON.stringify(responseBody), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

async function loadLookup(fetch: ReturnType<typeof vi.fn>) {
  vi.stubEnv('EXPO_PUBLIC_API_URL', 'https://api.example.test');
  vi.stubGlobal('fetch', fetch);
  const { lookupRepresentativeFromApi } = await import('../api');
  return lookupRepresentativeFromApi;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-08-07T12:00:00Z'));
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe('lookupRepresentativeFromApi request reuse', () => {
  it('shares an identical request that is already running', async () => {
    let finishRequest: ((response: Response) => void) | undefined;
    const fetch = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          finishRequest = resolve;
        }),
    );
    const lookup = await loadLookup(fetch);

    const first = lookup('350 S 5th St, Minneapolis, MN 55415');
    const second = lookup('350 S 5th St, Minneapolis, MN 55415');

    expect(fetch).toHaveBeenCalledOnce();
    finishRequest?.(successfulResponse());
    await expect(Promise.all([first, second])).resolves.toHaveLength(2);
  });

  it('reuses a successful identical lookup for 60 seconds, then refreshes it', async () => {
    const fetch = vi.fn().mockImplementation(() => Promise.resolve(successfulResponse()));
    const lookup = await loadLookup(fetch);

    await lookup('350 S 5th St, Minneapolis, MN 55415');
    await lookup('350 S 5th St, Minneapolis, MN 55415');
    expect(fetch).toHaveBeenCalledOnce();

    vi.advanceTimersByTime(60_001);
    await lookup('350 S 5th St, Minneapolis, MN 55415');
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('does not save failed lookups or share different inputs', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(new Response('unavailable', { status: 502 }))
      .mockImplementation(() => Promise.resolve(successfulResponse()));
    const lookup = await loadLookup(fetch);

    await expect(lookup('350 S 5th St, Minneapolis, MN 55415')).rejects.toThrow();
    await lookup('350 S 5th St, Minneapolis, MN 55415');
    await lookup({ latitude: 44.976, longitude: -93.266 });

    expect(fetch).toHaveBeenCalledTimes(3);
  });
});
