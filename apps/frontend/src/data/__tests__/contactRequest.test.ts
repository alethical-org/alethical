import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe('sendContactMessageFromApi', () => {
  it('posts the complete message to the public Contact us route', async () => {
    vi.stubEnv('EXPO_PUBLIC_API_URL', 'https://api.example.test');
    const fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ status: 'accepted' }), {
        status: 202,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetch);
    const { sendContactMessageFromApi } = await import('../api');
    const message = {
      requestId: 'b432b691-308f-45c4-b447-2e947c0dcde5',
      name: 'Ada Lovelace',
      email: 'ada@example.com',
      phone: '612-555-0199',
      subject: 'A correction',
      message: 'Please check the source link.',
    };

    await expect(sendContactMessageFromApi(message)).resolves.toEqual({ status: 'accepted' });
    expect(fetch).toHaveBeenCalledWith(
      'https://api.example.test/api/v1/contact',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          request_id: message.requestId,
          name: message.name,
          email: message.email,
          phone: message.phone,
          subject: message.subject,
          message: message.message,
        }),
      }),
    );
  });
});
