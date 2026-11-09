// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const id = '0e4c8dd7-558d-491e-b621-2d04a3228509';
const session = {
  token: 'private-session-token',
  expires_at: '2099-01-01T00:00:00Z',
  supported_content_types: ['image/jpeg'],
};
const draft = { id, status: 'draft', front: null, back: null, likes_ad: null, comment: null };
let api: typeof import('../mailUpload');
let fetcher: ReturnType<typeof vi.fn>;
const reply = (data: unknown, status = 200) =>
  new Response(JSON.stringify({ data }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

beforeEach(async () => {
  vi.resetModules();
  sessionStorage.clear();
  history.replaceState(null, '', '/mail-upload');
  delete window.__alethicalMailInvitation;
  vi.stubEnv('EXPO_PUBLIC_API_URL', 'https://api.example.test');
  fetcher = vi.fn();
  vi.stubGlobal('fetch', fetcher);
  api = await import('../mailUpload');
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

function invite(value = 'private-invitation') {
  history.replaceState(null, '', `/mail-upload?discard=private#invite=${value}`);
  api.captureMailInvitation();
}

describe('private mail sessions', () => {
  it('removes the entire fragment and query before starting any network request', async () => {
    invite();
    expect(location.pathname + location.search + location.hash).toBe('/mail-upload');
    expect(fetcher).not.toHaveBeenCalled();
    fetcher.mockResolvedValue(reply(session));
    await api.getMailUploadSession();
    const [url, init] = fetcher.mock.calls[0];
    expect(url).toBe('https://api.example.test/api/v1/mail-upload/sessions');
    const proof = JSON.parse(init.body);
    expect(proof.invitation_token).toBe('private-invitation');
    expect(proof.client_secret).toMatch(/^[a-f0-9]{64}$/);
    expect(proof.client_id).toMatch(/^[a-f0-9-]{36}$/);
    expect(init.credentials).toBe('omit');
    expect(init.referrerPolicy).toBe('no-referrer');
    expect(init.cache).toBe('no-store');
    expect(sessionStorage.getItem('alethical.mailUpload.session.v1')).toBeNull();
  });

  it('keeps retry proof only in memory and never writes credentials to browser storage', async () => {
    const storageWrite = vi.spyOn(Object.getPrototypeOf(window.sessionStorage), 'setItem');
    invite();
    fetcher.mockRejectedValueOnce(new Error('network private-invitation'));
    await expect(api.getMailUploadSession()).rejects.toMatchObject({
      status: 0,
      detail: 'Could not connect',
    });
    const firstProof = fetcher.mock.calls[0][1].body;
    fetcher.mockResolvedValueOnce(reply(session));
    await expect(api.getMailUploadSession()).resolves.toEqual(session);
    expect(fetcher.mock.calls[1][1].body).toBe(firstProof);
    await expect(api.getMailUploadSession()).resolves.toEqual(session);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(storageWrite).not.toHaveBeenCalled();
    expect(sessionStorage.length).toBe(0);
  });

  it('opens the plain URL and starts a fresh private session after reload', async () => {
    fetcher.mockResolvedValueOnce(reply(session));
    await expect(api.getMailUploadSession()).resolves.toEqual(session);
    const first = JSON.parse(fetcher.mock.calls[0][1].body);
    expect(first.invitation_token).toBeUndefined();
    vi.resetModules();
    api = await import('../mailUpload');
    fetcher.mockResolvedValueOnce(reply({ ...session, token: 'next-session' }));
    await expect(api.getMailUploadSession()).resolves.toMatchObject({ token: 'next-session' });
    const next = JSON.parse(fetcher.mock.calls[1][1].body);
    expect(next.invitation_token).toBeUndefined();
    expect(next.client_id).not.toBe(first.client_id);
    expect(next.client_secret).not.toBe(first.client_secret);
  });

  it('removes legacy tab credentials without reading or restoring them', async () => {
    sessionStorage.setItem(
      'alethical.mailUpload.session.v1',
      JSON.stringify({
        clientId: id,
        clientSecret: 'a'.repeat(64),
        session,
      }),
    );
    const storageRead = vi.spyOn(Object.getPrototypeOf(window.sessionStorage), 'getItem');
    vi.resetModules();
    api = await import('../mailUpload');
    fetcher.mockResolvedValueOnce(reply(session));
    await expect(api.getMailUploadSession()).resolves.toEqual(session);
    expect(storageRead).not.toHaveBeenCalled();
    expect(sessionStorage.length).toBe(0);
    expect(JSON.parse(fetcher.mock.calls[0][1].body).client_id).not.toBe(id);
  });

  it('shares an in-flight exchange and never lets an old invitation overwrite a new one', async () => {
    invite('old');
    let finish!: (value: Response) => void;
    fetcher.mockReturnValueOnce(
      new Promise<Response>((resolve) => {
        finish = resolve;
      }),
    );
    const first = api.getMailUploadSession();
    const same = api.getMailUploadSession();
    expect(fetcher).toHaveBeenCalledTimes(1);
    invite('new');
    fetcher.mockResolvedValueOnce(reply({ ...session, token: 'new-session' }));
    await expect(api.getMailUploadSession()).resolves.toMatchObject({ token: 'new-session' });
    finish(reply(session));
    await expect(first).rejects.toMatchObject({ status: 401 });
    await expect(same).rejects.toMatchObject({ status: 401 });
    await expect(api.getMailUploadSession()).resolves.toMatchObject({ token: 'new-session' });
  });

  it('consumes the first-HTML bootstrap value once', async () => {
    window.__alethicalMailInvitation = 'bootstrap-invite';
    api.captureMailInvitation();
    expect(window.__alethicalMailInvitation).toBeUndefined();
    fetcher.mockResolvedValue(reply(session));
    await api.getMailUploadSession();
    expect(JSON.parse(fetcher.mock.calls[0][1].body).invitation_token).toBe('bootstrap-invite');
  });

  it('clears expired access so a visitor can start again from the plain URL', async () => {
    invite();
    fetcher.mockResolvedValue(reply({ ...session, expires_at: '2000-01-01T00:00:00Z' }));
    await api.getMailUploadSession();
    await expect(api.getMailUploadSession()).rejects.toMatchObject({ status: 401 });
    fetcher.mockResolvedValueOnce(reply(session));
    await expect(api.getMailUploadSession()).resolves.toEqual(session);
    expect(JSON.parse(fetcher.mock.calls[1][1].body).invitation_token).toBeUndefined();
    expect(sessionStorage.length).toBe(0);
  });
});

describe('mail submission requests', () => {
  it('uses the same caller ID for create/recovery and sends raw image bytes', async () => {
    const storageWrite = vi.spyOn(Object.getPrototypeOf(window.sessionStorage), 'setItem');
    fetcher.mockImplementation(() => Promise.resolve(reply(draft)));
    await api.createMailSubmission(session.token, id);
    await api.getMailSubmission(session.token, id);
    const file = new File(['image-bytes'], 'private-recipient.jpeg', { type: 'image/jpeg' });
    await api.uploadMailImage(session.token, id, 'front', file);
    await api.submitMailSubmission(session.token, id, {
      likes_ad: false,
      comment: 'private comment',
    });
    expect(fetcher.mock.calls.map(([url]) => url)).toEqual([
      `https://api.example.test/api/v1/mail-upload/submissions/${id}`,
      `https://api.example.test/api/v1/mail-upload/submissions/${id}`,
      `https://api.example.test/api/v1/mail-upload/submissions/${id}/images/front`,
      `https://api.example.test/api/v1/mail-upload/submissions/${id}/submit`,
    ]);
    expect(fetcher.mock.calls[2][1].body).toBe(file);
    expect(fetcher.mock.calls[2][1].headers).toEqual({
      'Content-Type': 'image/jpeg',
      Authorization: `Bearer ${session.token}`,
    });
    expect(JSON.parse(fetcher.mock.calls[3][1].body)).toEqual({
      likes_ad: false,
      comment: 'private comment',
    });
    expect(sessionStorage.length).toBe(0);
    expect(storageWrite).not.toHaveBeenCalled();
  });

  it('reports server failures without losing their status', async () => {
    fetcher.mockResolvedValue(
      new Response(JSON.stringify({ status: 409, detail: 'Already saved' }), { status: 409 }),
    );
    await expect(
      api.submitMailSubmission(session.token, id, { likes_ad: true }),
    ).rejects.toMatchObject({ status: 409, detail: 'Already saved' });
  });

  it('invalidates rejected session access', async () => {
    invite();
    fetcher.mockResolvedValueOnce(reply(session));
    await api.getMailUploadSession();
    fetcher.mockResolvedValueOnce(new Response('{}', { status: 401 }));
    await expect(api.getMailSubmission(session.token, id)).rejects.toMatchObject({ status: 401 });
    fetcher.mockResolvedValueOnce(reply({ ...session, token: 'fresh-session' }));
    await expect(api.getMailUploadSession()).resolves.toMatchObject({ token: 'fresh-session' });
    expect(JSON.parse(fetcher.mock.calls[2][1].body).invitation_token).toBeUndefined();
    expect(sessionStorage.length).toBe(0);
  });

  it('marks a timed-out reply uncertain without exposing request data', async () => {
    vi.useFakeTimers();
    fetcher.mockImplementation(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init.signal.addEventListener('abort', () => reject(new Error('private-session-token')));
        }),
    );
    const pending = api.submitMailSubmission(
      session.token,
      id,
      { likes_ad: true, comment: 'private' },
      { timeoutMs: 20 },
    );
    const assertion = expect(pending).rejects.toMatchObject({
      status: 0,
      detail: 'The response could not be confirmed',
    });
    await vi.advanceTimersByTimeAsync(20);
    await assertion;
  });

  it('rejects oversized and unsupported files locally and accepts unnamed HEIC MIME', () => {
    const big = new File([new Uint8Array(api.MAX_MAIL_IMAGE_BYTES + 1)], 'large.jpg', {
      type: 'image/jpeg',
    });
    expect(() => api.uploadMailImage(session.token, id, 'back', big)).toThrow(api.MailUploadError);
    expect(() =>
      api.uploadMailImage(
        session.token,
        id,
        'back',
        new File(['x'], 'x.svg', { type: 'image/svg+xml' }),
      ),
    ).toThrow(api.MailUploadError);
    expect(api.mailImageContentType(new File(['x'], 'IMG_1.HEIC'))).toBe('image/heic');
    expect(fetcher).not.toHaveBeenCalled();
  });
});

it('queues front and back and retries a rate-limited upload with the same bytes', async () => {
  vi.useFakeTimers();
  const front = new File(['front'], 'front.jpg', { type: 'image/jpeg' });
  const back = new File(['back'], 'back.jpg', { type: 'image/jpeg' });
  fetcher.mockResolvedValueOnce(
    new Response('{}', { status: 429, headers: { 'Retry-After': '1' } }),
  );
  fetcher.mockImplementation(() => Promise.resolve(reply(draft)));
  const first = api.uploadMailImage(session.token, id, 'front', front);
  const second = api.uploadMailImage(session.token, id, 'back', back);
  await vi.advanceTimersByTimeAsync(0);
  expect(fetcher).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(1000);
  await Promise.all([first, second]);
  expect(fetcher.mock.calls.map(([, init]) => init.body)).toEqual([front, front, back]);
});

it('stops rate-limit retries and lets the next queued image proceed', async () => {
  vi.useFakeTimers();
  const file = new File(['front'], 'front.jpg', { type: 'image/jpeg' });
  fetcher.mockImplementation(() => Promise.resolve(new Response('{}', { status: 429 })));
  const pending = api.uploadMailImage(session.token, id, 'front', file);
  const assertion = expect(pending).rejects.toMatchObject({ status: 429 });
  await vi.advanceTimersByTimeAsync(2000);
  await assertion;
  expect(fetcher).toHaveBeenCalledTimes(3);
  fetcher.mockResolvedValue(reply(draft));
  await expect(api.uploadMailImage(session.token, id, 'back', file)).resolves.toEqual(draft);
});
