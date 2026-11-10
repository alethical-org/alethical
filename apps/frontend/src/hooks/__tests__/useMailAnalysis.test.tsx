// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { MailAnalysis } from '../../data/mailAnalysis';

const calls = vi.hoisted(() => ({ get: vi.fn(), retry: vi.fn() }));
vi.mock('../../data/mailUpload', async (load) => ({
  ...(await load<typeof import('../../data/mailUpload')>()),
  getMailAnalysis: calls.get,
  retryMailAnalysis: calls.retry,
}));
import { useMailAnalysis } from '../useMailAnalysis';
import { MailUploadError } from '../../data/mailUpload';

const pending: MailAnalysis = {
  status: 'pending',
  sides: [],
  payers: [],
  matching_mailers: { count: null },
};
const partial: MailAnalysis = {
  ...pending,
  status: 'partial',
  can_retry: true,
  sides: [
    {
      side: 'front',
      status: 'read',
      text: 'Words from the front',
      complete: false,
      disclosures: [],
    },
  ],
};
let container: HTMLDivElement;
let root: Root;
let hook: ReturnType<typeof useMailAnalysis>;
function Probe({ id = 'first', token = 'private-token' }: { id?: string | null; token?: string }) {
  hook = useMailAnalysis(id ? { id, token } : null);
  return null;
}
const render = (id: string | null = 'first', token = 'private-token') =>
  act(async () => root.render(createElement(Probe, { id, token })));
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.useFakeTimers();
  calls.get.mockReset().mockResolvedValue(pending);
  calls.retry.mockReset().mockResolvedValue({ ...partial, status: 'pending', can_retry: false });
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.useRealTimers();
});

it('reads only saved submissions and stops polling when results are terminal', async () => {
  await render(null);
  expect(calls.get).not.toHaveBeenCalled();
  calls.get.mockResolvedValueOnce(pending).mockResolvedValueOnce({ ...partial, status: 'ready' });
  await render();
  expect(calls.get).toHaveBeenCalledTimes(1);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(2000);
  });
  expect(hook.result?.status).toBe('ready');
  await act(async () => {
    await vi.advanceTimersByTimeAsync(10_000);
  });
  expect(calls.get).toHaveBeenCalledTimes(2);
});

it('aborts and ignores a late old-submission response after upload another', async () => {
  const old = deferred<MailAnalysis>();
  calls.get.mockReturnValueOnce(old.promise);
  await render();
  const signal = calls.get.mock.calls[0][2].signal;
  await render(null);
  expect(signal.aborted).toBe(true);
  await act(async () => old.resolve(partial));
  expect(hook.result).toBeNull();
  await render('second');
  expect(hook.result?.status).toBe('pending');
  expect(hook.result?.sides).toEqual([]);
});

it('isolates a changed session and aborts requests on unmount', async () => {
  const old = deferred<MailAnalysis>();
  const current = deferred<MailAnalysis>();
  calls.get.mockReturnValueOnce(old.promise).mockReturnValueOnce(current.promise);
  await render();
  const oldSignal = calls.get.mock.calls[0][2].signal;
  await render('first', 'another-session');
  expect(oldSignal.aborted).toBe(true);
  await act(async () => old.resolve(partial));
  expect(hook.result).toBeNull();
  const signal = calls.get.mock.calls[1][2].signal;
  await act(async () => root.render(null));
  expect(signal.aborted).toBe(true);
  await act(async () => current.resolve(partial));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(10_000);
  });
  expect(calls.get).toHaveBeenCalledTimes(2);
});

it('keeps a newer submission visible when an aborted older request resolves late', async () => {
  const old = deferred<MailAnalysis>();
  const newer = { ...partial, status: 'ready' as const, matching_mailers: { count: 3 } };
  calls.get.mockReturnValueOnce(old.promise).mockResolvedValueOnce(newer);
  await render('first');
  await render('second');
  expect(hook.result).toEqual(newer);
  await act(async () => old.resolve(partial));
  expect(hook.result).toEqual(newer);
});

it('retains readable results during one retry and refuses duplicate or exhausted retries', async () => {
  calls.get.mockResolvedValueOnce(partial);
  const retry = deferred<MailAnalysis>();
  calls.retry.mockReturnValueOnce(retry.promise);
  await render();
  await act(async () => {
    hook.retry();
    hook.retry();
  });
  expect(calls.retry).toHaveBeenCalledTimes(1);
  expect(hook.retrying).toBe(true);
  expect(hook.result?.sides[0].text).toBe('Words from the front');
  await act(async () => retry.resolve({ ...pending, can_retry: false }));
  expect(hook.result?.sides[0].text).toBe('Words from the front');
  expect(hook.retrying).toBe(true);
  calls.get.mockResolvedValueOnce({ ...partial, can_retry: false });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(2000);
  });
  await act(async () => hook.retry());
  expect(calls.retry).toHaveBeenCalledTimes(1);
  expect(hook.result?.can_retry).toBe(false);
  expect(hook.retrying).toBe(false);
});

it('retains results on a network failure and refreshes without spending an analysis retry', async () => {
  calls.get.mockResolvedValueOnce(pending).mockRejectedValueOnce(new Error('secret body'));
  await render();
  await act(async () => {
    await vi.advanceTimersByTimeAsync(2000);
  });
  expect(hook.error).toBe('unavailable');
  expect(hook.result).toEqual(pending);
  const refresh = deferred<MailAnalysis>();
  calls.get.mockReturnValueOnce(refresh.promise);
  await act(async () => {
    hook.refresh();
    hook.refresh();
  });
  expect(hook.error).toBe('unavailable');
  expect(hook.refreshing).toBe(true);
  expect(calls.get).toHaveBeenCalledTimes(3);
  await act(async () => refresh.resolve(partial));
  expect(hook.result).toEqual(partial);
  expect(hook.error).toBeNull();
  expect(hook.refreshing).toBe(false);
  expect(calls.retry).not.toHaveBeenCalled();
});

it('retains same-owner evidence on expiry while refusing further fetches or retries until reset', async () => {
  calls.get.mockResolvedValueOnce(partial);
  calls.retry.mockRejectedValueOnce(new MailUploadError(401, 'Expired'));
  await render();
  await act(async () => hook.retry());
  expect(hook.error).toBe('expired');
  expect(hook.result?.sides).toEqual(partial.sides);
  expect(hook.result?.can_retry).toBe(false);
  await act(async () => {
    hook.retry();
    hook.refresh();
  });
  expect(calls.retry).toHaveBeenCalledTimes(1);
  expect(calls.get).toHaveBeenCalledTimes(1);
  await render('second', 'fresh-session');
  expect(hook.error).toBeNull();
  expect(hook.result?.sides).toEqual([]);
  expect(calls.get).toHaveBeenCalledTimes(2);
});
