import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { useElectionAttachment, type ElectionAttachment } from '../pages/elections/attachments';
import { electionSourcePath, financeSourcePath } from '../pages/elections/data';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const session = vi.hoisted(() => ({
  apiBaseUrl: 'https://api.example.test',
  accessToken: 'token' as string | null,
  email: 'reader@example.test',
  status: 'granted',
  revoked: false,
}));
vi.mock('../auth/session', () => ({ useFinanceSession: () => session }));

const source = 'a'.repeat(64);
const snapshot = 'b'.repeat(64);
const collection = 'c'.repeat(64);
const firstPath = electionSourcePath('mn-2026-11-03-general', source, snapshot);
const nextPath = financeSourcePath('mn-2026-11-03-general', source, collection);
let container: HTMLDivElement;
let root: Root;
let latest: ElectionAttachment;
const frames: ElectionAttachment[] = [];
let fetcher: ReturnType<typeof vi.fn<typeof fetch>>;
let createUrl: ReturnType<typeof vi.fn<typeof URL.createObjectURL>>;
let revokeUrl: ReturnType<typeof vi.fn<typeof URL.revokeObjectURL>>;

function Probe({ path }: { path: string | null }) {
  latest = useElectionAttachment(path);
  frames.push(latest);
  return <span>{latest.state}</span>;
}
async function render(path: string | null = firstPath) {
  await act(async () => root.render(<Probe path={path} />));
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => (resolve = done));
  return { promise, resolve };
}
function response(content = 'retained bytes', type = 'application/octet-stream') {
  return new Response(content, { headers: { 'content-type': type } });
}

beforeEach(() => {
  Object.assign(session, {
    accessToken: 'token',
    email: 'reader@example.test',
    status: 'granted',
    revoked: false,
  });
  frames.length = 0;
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  fetcher = vi.fn<typeof fetch>().mockResolvedValue(response());
  vi.stubGlobal('fetch', fetcher);
  let sequence = 0;
  createUrl = vi.fn<typeof URL.createObjectURL>(() => `blob:attachment-${++sequence}`);
  revokeUrl = vi.fn<typeof URL.revokeObjectURL>();
  vi.stubGlobal(
    'URL',
    class extends URL {
      static createObjectURL = createUrl;
      static revokeObjectURL = revokeUrl;
    },
  );
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

it('loads exact bytes privately with their source MIME type and revokes on unmount', async () => {
  fetcher.mockResolvedValue(response('%PDF-retained', 'application/pdf'));
  await render();
  expect(latest.state).toBe('ready');
  expect(latest.objectUrl).toBe('blob:attachment-1');
  expect(latest.contentType).toBe('application/pdf');
  const blob = createUrl.mock.calls[0][0] as Blob;
  expect(await blob.text()).toBe('%PDF-retained');
  expect(blob.type).toBe('application/pdf');
  expect(fetcher).toHaveBeenCalledWith(`https://api.example.test/api/v1/${firstPath}`, {
    headers: { Authorization: 'Bearer token' },
    cache: 'no-store',
    redirect: 'error',
    signal: expect.any(AbortSignal),
  });
  await act(async () => root.render(null));
  expect(revokeUrl).toHaveBeenCalledExactlyOnceWith('blob:attachment-1');
  expect((fetcher.mock.calls[0][1]?.signal as AbortSignal).aborted).toBe(true);
});

it.each([
  'https://elsewhere.invalid/private',
  '//elsewhere.invalid/private',
  '/finance/elections/private',
  'finance/../people/private',
  firstPath.replace('finance/elections', 'finance%2f..%2felsewhere/elections'),
  firstPath.replace('snapshot_id', 'collection_id'),
  `${firstPath}&snapshot_id=${snapshot}`,
  `${firstPath}#fragment`,
  firstPath.split('?')[0],
  firstPath.replace('/sources/', '/sources/%2e%2e/'),
])('rejects an untrusted or unpinned route without sending a token: %s', async (path) => {
  await render(path);
  expect(latest.state).toBe('failed');
  expect(latest.objectUrl).toBeNull();
  expect(fetcher).not.toHaveBeenCalled();
});

it('hides old content on the first render of a changed path and revokes it', async () => {
  await render();
  const pending = deferred<Response>();
  fetcher.mockReturnValue(pending.promise);
  frames.length = 0;
  await render(nextPath);
  expect(frames.every((frame) => frame.objectUrl === null)).toBe(true);
  expect(latest.state).toBe('loading');
  expect(revokeUrl).toHaveBeenCalledWith('blob:attachment-1');
  await act(async () => pending.resolve(response('new bytes')));
  expect(latest.objectUrl).toBe('blob:attachment-2');
});

it('discards a late old response even when the mock transport ignores abort', async () => {
  const old = deferred<Response>();
  fetcher.mockReturnValueOnce(old.promise);
  await render();
  const oldSignal = fetcher.mock.calls[0][1]?.signal as AbortSignal;
  await render(nextPath);
  expect(oldSignal.aborted).toBe(true);
  expect(latest.objectUrl).toBe('blob:attachment-1');
  await act(async () => old.resolve(response('old secret')));
  expect(createUrl).toHaveBeenCalledTimes(1);
  expect(latest.objectUrl).toBe('blob:attachment-1');
  expect(await (createUrl.mock.calls[0][0] as Blob).text()).toBe('retained bytes');
});

it('discards a late old body read after the account changes', async () => {
  const body = deferred<Blob>();
  const oldResponse = response();
  vi.spyOn(oldResponse, 'blob').mockReturnValue(body.promise);
  fetcher.mockResolvedValueOnce(oldResponse);
  await render();
  session.email = 'other@example.test';
  session.accessToken = 'other-token';
  await render();
  await act(async () => body.resolve(new Blob(['old secret'])));
  expect(createUrl).toHaveBeenCalledTimes(1);
  expect(fetcher.mock.calls[1][1]?.headers).toEqual({
    Authorization: 'Bearer other-token',
  });
});

it.each(['signout', 'token', 'account', 'revoked', 'disabled'])(
  'clears and revokes current content on %s without exposing a stale frame',
  async (change) => {
    await render();
    fetcher.mockReturnValue(new Promise(() => {}));
    if (change === 'signout') {
      session.accessToken = null;
      session.status = 'signed-out';
    }
    if (change === 'token') session.accessToken = 'refreshed-token';
    if (change === 'account') session.email = 'different@example.test';
    if (change === 'revoked') session.revoked = true;
    frames.length = 0;
    await render(change === 'disabled' ? null : firstPath);
    expect(frames.every((frame) => frame.objectUrl === null)).toBe(true);
    expect(revokeUrl).toHaveBeenCalledExactlyOnceWith('blob:attachment-1');
    expect(fetcher).toHaveBeenCalledTimes(['token', 'account'].includes(change) ? 2 : 1);
    expect(latest.state).toBe(['token', 'account'].includes(change) ? 'loading' : 'idle');
  },
);

it.each([401, 403, 404, 503])(
  'rejects status %s and can retry without reusing failed data',
  async (status) => {
    fetcher.mockResolvedValueOnce(new Response('private error', { status }));
    await render();
    expect(latest.state).toBe('failed');
    expect(latest.objectUrl).toBeNull();
    expect(latest.accessDenied).toBe(status === 401 || status === 403);
    expect(createUrl).not.toHaveBeenCalled();
    await act(async () => latest.retry());
    expect(latest.state).toBe('ready');
    expect(latest.accessDenied).toBe(false);
    expect(fetcher).toHaveBeenCalledTimes(2);
  },
);

it.each(['text/html', 'application/json', 'text/plain'])(
  'refuses executable or error MIME type %s',
  async (type) => {
    fetcher.mockResolvedValue(response('<script>private</script>', type));
    await render();
    expect(latest.state).toBe('failed');
    expect(createUrl).not.toHaveBeenCalled();
  },
);

it('refuses a redirected response even if a transport follows it', async () => {
  const redirected = response();
  Object.defineProperty(redirected, 'redirected', { value: true });
  fetcher.mockResolvedValue(redirected);
  await render();
  expect(latest.state).toBe('failed');
  expect(createUrl).not.toHaveBeenCalled();
});

it('downloads a release-pinned outside CSV privately and rejects incomplete versions', async () => {
  const path = `finance/elections/mn-2026-11-03-general/outside-spending/source?election_snapshot_id=${snapshot}&version=0123456789abcdef&release_id=00000000-0000-0000-0000-000000000123`;
  await render(path);
  expect(latest.state).toBe('ready');
  expect(fetcher.mock.calls[0][1]?.headers).toEqual({ Authorization: 'Bearer token' });
  fetcher.mockClear();
  await render(path.replace('&version=0123456789abcdef', ''));
  expect(latest.state).toBe('failed');
  expect(latest.objectUrl).toBeNull();
  expect(fetcher).not.toHaveBeenCalled();
});

it('distinguishes a replaced publication from an ordinary source failure', async () => {
  fetcher.mockResolvedValue(
    new Response(JSON.stringify({ type: 'https://api.alethical.com/problems/records-changed' }), {
      status: 409,
      headers: { 'content-type': 'application/json' },
    }),
  );
  await render();
  expect(latest.state).toBe('failed');
  expect(latest.changed).toBe(true);
  expect(latest.objectUrl).toBeNull();
});

const analyticsCsvPath = `finance/elections/mn-2026-11-03-general/analytics/sources/expenditures?snapshot_id=${snapshot}&version=0123456789abcdef`;
function delayedSource(ms: number) {
  fetcher.mockImplementation(
    (_url, options) =>
      new Promise<Response>((resolve, reject) => {
        const timer = setTimeout(() => {
          options?.signal?.removeEventListener('abort', abort);
          resolve(response('exact,12.50'));
        }, ms);
        const abort = () => {
          clearTimeout(timer);
          reject(new DOMException('Aborted', 'AbortError'));
        };
        options?.signal?.addEventListener('abort', abort, { once: true });
      }),
  );
}
it('keeps a healthy 20-second whole-election source CSV alive', async () => {
  vi.useFakeTimers();
  try {
    delayedSource(20_000);
    await render(analyticsCsvPath);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(20_000);
    });
    expect(latest.state).toBe('ready');
    expect(createUrl).toHaveBeenCalledTimes(1);
  } finally {
    vi.clearAllTimers();
    vi.useRealTimers();
  }
});

it('still ends an unfinished analytics source body at 90 seconds', async () => {
  vi.useFakeTimers();
  try {
    fetcher.mockImplementation(async (_url, options) => {
      const reply = response();
      vi.spyOn(reply, 'blob').mockImplementation(
        () =>
          new Promise((_resolve, reject) => {
            options?.signal?.addEventListener('abort', () =>
              reject(new DOMException('Aborted', 'AbortError')),
            );
          }),
      );
      return reply;
    });
    await render(analyticsCsvPath);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(90_000);
    });
    expect((fetcher.mock.calls[0][1]?.signal as AbortSignal).aborted).toBe(true);
    expect(latest.state).toBe('failed');
    expect(createUrl).not.toHaveBeenCalled();
  } finally {
    vi.clearAllTimers();
    vi.useRealTimers();
  }
});
it('cancels a long source CSV on sign-out without exposing the old body', async () => {
  vi.useFakeTimers();
  try {
    delayedSource(20_000);
    await render(analyticsCsvPath);
    expect(fetcher.mock.calls[0][1]?.headers).toEqual({ Authorization: 'Bearer token' });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_000);
    });
    session.accessToken = null;
    session.status = 'signed-out';
    await render(analyticsCsvPath);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect((fetcher.mock.calls[0][1]?.signal as AbortSignal).aborted).toBe(true);
    expect(latest.state).toBe('idle');
    expect(createUrl).not.toHaveBeenCalled();
    expect(fetcher).toHaveBeenCalledTimes(1);
  } finally {
    vi.clearAllTimers();
    vi.useRealTimers();
  }
});
