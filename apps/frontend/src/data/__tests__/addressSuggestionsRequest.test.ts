import { afterEach, describe, expect, it, vi } from 'vitest';

const responseBody = {
  data: {
    suggestions: [
      {
        matched_address: '3040 Excelsior Boulevard, Minneapolis, MN 55416',
        latitude: 44.9475,
        longitude: -93.3212,
        state_code: 'MN',
      },
    ],
  },
};

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe('suggestRepresentativeAddressesFromApi', () => {
  it('posts the partial address and maps only the usable choice fields', async () => {
    vi.stubEnv('EXPO_PUBLIC_API_URL', 'https://api.example.test');
    const fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(responseBody), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetch);
    const { suggestRepresentativeAddressesFromApi } = await import('../api');

    await expect(suggestRepresentativeAddressesFromApi('3040 Ex')).resolves.toEqual([
      {
        matchedAddress: '3040 Excelsior Boulevard, Minneapolis, MN 55416',
        latitude: 44.9475,
        longitude: -93.3212,
      },
    ]);
    expect(fetch).toHaveBeenCalledWith(
      'https://api.example.test/api/v1/address-suggestions',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ address_text: '3040 Ex' }),
      }),
    );
  });

  it('does not request suggestions for an empty value', async () => {
    vi.stubEnv('EXPO_PUBLIC_API_URL', 'https://api.example.test');
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    const { suggestRepresentativeAddressesFromApi } = await import('../api');

    await expect(suggestRepresentativeAddressesFromApi('   ')).resolves.toEqual([]);
    expect(fetch).not.toHaveBeenCalled();
  });
});
