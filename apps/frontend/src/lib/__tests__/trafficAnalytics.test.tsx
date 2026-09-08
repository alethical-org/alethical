// @vitest-environment jsdom
import { act, createElement, StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  auth: {
    accessToken: null as string | null,
    isLoading: false,
    isSignedIn: false,
    user: null as { id: string } | null,
  },
  beforeSend: null as ((event: { url: string }) => { url: string } | null) | null,
  injected: false,
  views: [] as { url: string }[],
}));

vi.hoisted(() => {
  process.env.EXPO_PUBLIC_API_URL = 'https://api.example.test';
});
vi.mock('../../providers/AuthProvider', () => ({ useAuth: () => state.auth }));
vi.mock('../siteMetricEvents', () => ({ setSiteMetricSession: vi.fn() }));
vi.mock('@vercel/analytics/react', async () => {
  const { useEffect } = await import('react');
  return {
    Analytics: ({ beforeSend }: { beforeSend: typeof state.beforeSend }) => {
      useEffect(() => {
        // Like Vercel's injected script, the callback survives unmounting.
        state.beforeSend = beforeSend;
        // The script emits once on injection and never retries a rejected view.
        if (!state.injected) {
          state.injected = true;
          const view = beforeSend?.({ url: 'https://www.alethical.com/bills?q=private' });
          if (view) state.views.push(view);
        }
      }, [beforeSend]);
      return null;
    },
  };
});

import { TrafficAnalytics } from '../../components/TrafficAnalytics.web';

let root: Root;
let container: HTMLDivElement;

async function render() {
  await act(async () => root.render(createElement(TrafficAnalytics)));
}

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  state.auth = { accessToken: null, isLoading: false, isSignedIn: false, user: null };
  state.beforeSend = null;
  state.injected = false;
  state.views = [];
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  vi.stubGlobal('fetch', vi.fn());
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

const event = { url: 'https://www.alethical.com/bills?q=private#private' };

describe('event-time traffic permission', () => {
  it('emits the first signed-out view once after delayed session restoration', async () => {
    state.auth.isLoading = true;
    await render();
    expect(state.injected).toBe(false);
    state.auth.isLoading = false;
    await render();
    await render();
    expect(state.views).toEqual([{ url: 'https://www.alethical.com/bills' }]);
  });

  it('emits the first signed-in view once after delayed collection permission', async () => {
    let finish: ((response: Response) => void) | undefined;
    vi.mocked(fetch).mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    state.auth = {
      isLoading: false,
      isSignedIn: true,
      accessToken: 'test-reader-token',
      user: { id: 'test-reader' },
    };
    await render();
    expect(state.injected).toBe(false);
    await act(async () =>
      finish?.({
        ok: true,
        json: async () => ({ collect: true, teamAccount: false, teamExclusionConfigured: true }),
      } as Response),
    );
    await render();
    expect(state.views).toEqual([{ url: 'https://www.alethical.com/bills' }]);
  });

  it('does not inject or emit for an initially excluded team account', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({ collect: false, teamAccount: true, teamExclusionConfigured: true }),
    } as Response);
    state.auth = {
      isLoading: false,
      isSignedIn: true,
      accessToken: 'test-team-token',
      user: { id: 'test-team' },
    };
    await render();
    expect(state.injected).toBe(false);
    expect(state.views).toEqual([]);
  });

  it('keeps the script through token refresh without duplicating its first view', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({ collect: true, teamAccount: false, teamExclusionConfigured: true }),
    } as Response);
    state.auth = {
      isLoading: false,
      isSignedIn: true,
      accessToken: 'test-reader-token',
      user: { id: 'test-reader' },
    };
    await render();
    const originalCallback = state.beforeSend;
    state.auth.isLoading = true;
    await render();
    expect(state.beforeSend?.(event)).toBeNull();
    state.auth = { ...state.auth, isLoading: false, accessToken: 'test-refreshed-token' };
    await render();
    expect(state.beforeSend).toBe(originalCallback);
    expect(state.beforeSend?.(event)).toEqual({ url: 'https://www.alethical.com/bills' });
    expect(state.views).toEqual([{ url: 'https://www.alethical.com/bills' }]);
  });

  it('keeps collecting public traffic after a StrictMode setup cycle', async () => {
    await act(async () =>
      root.render(createElement(StrictMode, null, createElement(TrafficAnalytics))),
    );
    expect(state.beforeSend?.(event)).not.toBeNull();
    expect(state.views).toEqual([{ url: 'https://www.alethical.com/bills' }]);
  });

  it.each(['/admin', '/admin/users?email=private#private', '/%61dmin/users'])(
    'never sends private administration addresses: %s',
    async (path) => {
      await render();
      expect(state.beforeSend?.({ url: `https://www.alethical.com${path}` })).toBeNull();
      expect(state.beforeSend?.({ url: 'https://www.alethical.com/administrator' })).not.toBeNull();
    },
  );

  it('blocks incomplete identity and survives a permanent unmount safely', async () => {
    state.auth = {
      isLoading: false,
      isSignedIn: false,
      user: { id: 'stale-user' },
      accessToken: null,
    };
    await render();
    expect(state.beforeSend).toBeNull();
    state.auth = { isLoading: false, isSignedIn: true, user: null, accessToken: 'test-token' };
    await render();
    expect(state.beforeSend).toBeNull();
    state.auth = { isLoading: false, isSignedIn: false, user: null, accessToken: null };
    await render();
    await act(async () => root.render(null));
    expect(state.beforeSend?.(event)).toBeNull();
  });

  it('stops the existing script while sign-in is unresolved and after team sign-in', async () => {
    await render();
    expect(state.beforeSend?.(event)).toEqual({ url: 'https://www.alethical.com/bills' });

    state.auth = { ...state.auth, isLoading: true };
    await render();
    expect(state.beforeSend?.(event)).toBeNull();

    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({ collect: false, teamAccount: true, teamExclusionConfigured: true }),
    } as Response);
    state.auth = {
      isLoading: false,
      isSignedIn: true,
      accessToken: 'test-team-token',
      user: { id: 'test-team' },
    };
    await render();
    expect(state.beforeSend?.(event)).toBeNull();
  });

  it('does not reuse another account permission while its replacement is pending', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({ collect: true, teamAccount: false, teamExclusionConfigured: true }),
    } as Response);
    state.auth = {
      isLoading: false,
      isSignedIn: true,
      accessToken: 'test-reader-token',
      user: { id: 'test-reader' },
    };
    await render();
    expect(state.beforeSend?.(event)).not.toBeNull();
    vi.mocked(fetch).mockImplementation(() => new Promise(() => {}));
    state.auth = { ...state.auth, accessToken: 'test-next-token', user: { id: 'test-next' } };
    await render();
    expect(state.beforeSend?.(event)).toBeNull();
  });

  it('does not reuse permission after the token changes, or accept a late answer', async () => {
    let finish: ((response: Response) => void) | undefined;
    vi.mocked(fetch).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    state.auth = {
      isLoading: false,
      isSignedIn: true,
      accessToken: 'test-old-token',
      user: { id: 'test-reader' },
    };
    await render();
    vi.mocked(fetch).mockImplementation(() => new Promise(() => {}));
    state.auth = { ...state.auth, accessToken: 'test-new-token' };
    await render();
    await act(async () =>
      finish?.({
        ok: true,
        json: async () => ({ collect: true, teamAccount: false, teamExclusionConfigured: true }),
      } as Response),
    );
    expect(state.beforeSend).toBeNull();
    expect(vi.mocked(fetch).mock.calls[1][1]?.headers).toMatchObject({
      Authorization: 'Bearer test-new-token',
    });
  });

  it('fails closed on a failed decision, then resumes after a settled sign-out', async () => {
    await render();
    vi.mocked(fetch).mockRejectedValue(new Error('offline'));
    state.auth = {
      isLoading: false,
      isSignedIn: true,
      accessToken: 'test-reader-token',
      user: { id: 'test-reader' },
    };
    await render();
    expect(state.beforeSend?.(event)).toBeNull();
    state.auth = { isLoading: false, isSignedIn: false, accessToken: null, user: null };
    await render();
    expect(state.beforeSend?.(event)).toEqual({ url: 'https://www.alethical.com/bills' });
  });
});
