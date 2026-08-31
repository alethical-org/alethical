import { QueryObserver } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { APP_QUERY_STALE_TIME, createAppQueryClient } from '../appQueryClient';

const clients: ReturnType<typeof createAppQueryClient>[] = [];

afterEach(() => {
  clients.splice(0).forEach((client) => client.clear());
  vi.restoreAllMocks();
});

function activeQuery(queryKey: readonly unknown[], queryFn: () => Promise<string>) {
  const client = createAppQueryClient();
  clients.push(client);
  client.setQueryData(queryKey, 'old', { updatedAt: Date.now() });
  const observer = new QueryObserver(client, { queryKey, queryFn });
  const unsubscribe = observer.subscribe(() => undefined);
  return {
    client,
    query: client.getQueryCache().find({ queryKey })!,
    unsubscribe,
  };
}

describe('app query refresh', () => {
  it('keeps bill data quiet during the 5-minute fresh window', async () => {
    const request = vi.fn(async () => 'new');
    const { query, unsubscribe } = activeQuery(['bill', 'bill-1'], request);

    query.onFocus();
    await Promise.resolve();

    expect(request).not.toHaveBeenCalled();
    unsubscribe();
  });

  it('refreshes a stale bill when the tab regains focus', async () => {
    const request = vi.fn(async () => 'new');
    const { client, query, unsubscribe } = activeQuery(['bill', 'bill-1'], request);
    client.setQueryData(['bill', 'bill-1'], 'old', {
      updatedAt: Date.now() - APP_QUERY_STALE_TIME - 1,
    });

    query.onFocus();
    await vi.waitFor(() => expect(client.getQueryData(['bill', 'bill-1'])).toBe('new'));

    expect(request).toHaveBeenCalledTimes(1);
    unsubscribe();
  });

  it('refreshes a stale bill when the network reconnects', async () => {
    const request = vi.fn(async () => 'new');
    const { client, query, unsubscribe } = activeQuery(['tracked-bills', 'reader-1'], request);
    client.setQueryData(['tracked-bills', 'reader-1'], 'old', {
      updatedAt: Date.now() - APP_QUERY_STALE_TIME - 1,
    });

    query.onOnline();
    await vi.waitFor(() => expect(client.getQueryData(['tracked-bills', 'reader-1'])).toBe('new'));

    expect(request).toHaveBeenCalledTimes(1);
    unsubscribe();
  });

  it('shares 1 request across a burst of focus and reconnect signals', async () => {
    let finishRequest!: (value: string) => void;
    const request = vi.fn(
      () =>
        new Promise<string>((resolve) => {
          finishRequest = resolve;
        }),
    );
    const { client, query, unsubscribe } = activeQuery(['bills', 'current'], request);
    client.setQueryData(['bills', 'current'], 'old', {
      updatedAt: Date.now() - APP_QUERY_STALE_TIME - 1,
    });

    query.onFocus();
    query.onFocus();
    query.onOnline();
    query.onOnline();
    await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(1));

    finishRequest('new');
    await vi.waitFor(() => expect(client.getQueryData(['bills', 'current'])).toBe('new'));
    unsubscribe();
  });

  it('never reruns a free-form Ask request on focus or reconnect', async () => {
    const request = vi.fn(async () => 'new');
    const { client, query, unsubscribe } = activeQuery(['ask', 'What changed?'], request);
    client.setQueryData(['ask', 'What changed?'], 'old', {
      updatedAt: Date.now() - APP_QUERY_STALE_TIME - 1,
    });

    query.onFocus();
    query.onOnline();
    await Promise.resolve();

    expect(request).not.toHaveBeenCalled();
    unsubscribe();
  });
});
