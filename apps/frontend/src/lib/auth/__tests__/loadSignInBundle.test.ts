import { beforeEach, describe, expect, it, vi } from 'vitest';

describe('sign-in download request listeners', () => {
  let loader: typeof import('../loadSignInBundle');
  const importedBundle = vi.fn();

  beforeEach(async () => {
    vi.resetModules();
    importedBundle.mockClear();
    vi.doMock('../signInBundle', () => {
      importedBundle();
      return { supabase: { auth: {} } };
    });
    loader = await import('../loadSignInBundle');
  });

  it('registers and removes listeners without downloading sign-in code', async () => {
    const listener = vi.fn();
    const unsubscribe = loader.onSignInBundleRequested(listener);
    await vi.dynamicImportSettled();

    expect(importedBundle).not.toHaveBeenCalled();
    expect(listener).not.toHaveBeenCalled();
    unsubscribe();
    await loader.loadSignInBundle();
    expect(importedBundle).toHaveBeenCalledTimes(1);
    expect(listener).not.toHaveBeenCalled();
  });

  it('publishes one pending download before synchronously notifying listeners', async () => {
    const order: string[] = [];
    let nestedRequest: ReturnType<typeof loader.loadSignInBundle> | undefined;
    const listener = vi.fn(() => {
      order.push('notified');
      nestedRequest = loader.loadSignInBundle();
    });
    loader.onSignInBundleRequested(listener);

    const firstRequest = loader.loadSignInBundle();
    order.push('returned');
    const secondRequest = loader.loadSignInBundle();

    expect(order).toEqual(['notified', 'returned']);
    expect(nestedRequest).toBe(firstRequest);
    expect(secondRequest).toBe(firstRequest);
    expect(listener).toHaveBeenCalledTimes(1);
    await firstRequest;
    expect(importedBundle).toHaveBeenCalledTimes(1);
  });

  it('immediately notifies a listener registered after the download was requested', async () => {
    const pending = loader.loadSignInBundle();
    const listener = vi.fn();
    const unsubscribe = loader.onSignInBundleRequested(listener);

    expect(listener).toHaveBeenCalledTimes(1);
    await pending;
    await loader.loadSignInBundle();
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
  });

  it('immediately notifies a listener mounted after the download finished', async () => {
    await loader.loadSignInBundle();
    const listener = vi.fn();
    const unsubscribe = loader.onSignInBundleRequested(listener);

    expect(listener).toHaveBeenCalledTimes(1);
    expect(importedBundle).toHaveBeenCalledTimes(1);
    unsubscribe();
  });
});
