// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  auth: {
    isLoading: false,
    isSignedIn: true,
    user: { id: 'test-admin' } as { id: string } | null,
    accessToken: 'test-token-a' as string | null,
  },
  access: vi.fn(),
  search: vi.fn(),
  signIn: vi.fn(),
}));

vi.mock('../../providers/AuthProvider', () => ({ useAuth: () => state.auth }));
vi.mock('../../providers/signInModalContext', () => ({
  useSignInModal: () => ({ openSignIn: state.signIn }),
}));
vi.mock('../../hooks/useResponsive', () => ({ useResponsive: () => ({ isMobile: false }) }));
vi.mock('../../navigation/documentTitle', () => ({ useDocumentTitle: vi.fn() }));
vi.mock('../../navigation/topNavRoutes', () => ({ navigateTopNavItem: vi.fn() }));
vi.mock('../../components/GoBackLink', () => ({ GoBackLink: () => null }));
vi.mock('../../components/search/searchPieces', () => ({
  SearchPageShell: ({ hero, children }: { hero: React.ReactNode; children: React.ReactNode }) => (
    <main>
      {hero}
      {children}
    </main>
  ),
}));
vi.mock('../../data/api', () => ({
  getAdminAccessFromApi: (...args: unknown[]) => state.access(...args),
  searchAdminUsersFromApi: (...args: unknown[]) => state.search(...args),
  ApiError: class extends Error {
    constructor(public status: number) {
      super('Request failed');
    }
  },
}));

import { AdminUsersScreen } from '../redesign/AdminUsersScreen';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

const fixture = {
  data: [
    {
      id: 'test-user',
      email: 'fixture@example.com',
      created_at: '2026-09-07T00:00:00Z',
      confirmed_at: '2026-09-07T00:01:00Z',
      sign_in_methods: ['google'],
    },
  ],
  summary: {
    confirmed_accounts: 1,
    pending_accounts: 0,
    confirmed_today: 0,
    confirmed_7d: 1,
    confirmed_30d: 1,
  },
  page: { offset: 0, limit: 25, total: 1, has_more: false },
  as_of: '2026-09-07T12:00:00Z',
};
let host: HTMLDivElement;
let root: Root;
const render = async () => {
  await act(async () => {
    root.render(
      <AdminUsersScreen
        navigation={{ navigate: vi.fn(), canGoBack: () => false } as any}
        route={{ name: 'AdminUsers', key: 'admin' }}
      />,
    );
  });
};

beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  state.auth = {
    isLoading: false,
    isSignedIn: true,
    user: { id: 'test-admin' },
    accessToken: 'test-token-a',
  };
  state.access.mockReset().mockResolvedValue(true);
  state.search.mockReset().mockResolvedValue(fixture);
  state.signIn.mockReset();
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

describe('private Users access and cleanup', () => {
  it('never requests private rows for a signed-out or ordinary account', async () => {
    state.auth = { isLoading: false, isSignedIn: false, user: null, accessToken: null };
    await render();
    expect(host.textContent).toContain('Sign in with an administrator account');
    expect(state.access).not.toHaveBeenCalled();
    expect(state.search).not.toHaveBeenCalled();
    state.auth = {
      isLoading: false,
      isSignedIn: true,
      user: { id: 'reader' },
      accessToken: 'test-reader-token',
    };
    state.access.mockResolvedValue(false);
    await render();
    expect(host.textContent).toContain('Restricted access');
    expect(state.search).not.toHaveBeenCalled();
  });
  it('clears visible private rows on account change and ignores late permission replies', async () => {
    await render();
    expect(host.textContent).toContain('fixture@example.com');
    const pending = deferred<boolean>();
    state.access.mockReturnValueOnce(pending.promise);
    state.auth = { ...state.auth, user: { id: 'reader' }, accessToken: 'test-reader-token' };
    await render();
    expect(host.textContent).not.toContain('fixture@example.com');
    expect(host.textContent).toContain('Checking access');
    state.auth = { isLoading: false, isSignedIn: false, user: null, accessToken: null };
    await render();
    await act(async () => pending.resolve(true));
    expect(host.textContent).not.toContain('fixture@example.com');
    expect(state.search).toHaveBeenCalledTimes(1);
    expect(state.access.mock.calls[1][1].aborted).toBe(true);
  });
  it('aborts a pending private search on sign-out and cannot print its late reply', async () => {
    const pending = deferred<typeof fixture>();
    state.search.mockReturnValueOnce(pending.promise);
    await render();
    expect(host.textContent).toContain('Loading accounts');
    const signal = state.search.mock.calls[0][2] as AbortSignal;
    state.auth = { isLoading: false, isSignedIn: false, user: null, accessToken: null };
    await render();
    expect(signal.aborted).toBe(true);
    await act(async () => pending.resolve(fixture));
    expect(host.textContent).not.toContain('fixture@example.com');
  });
  it('shows failure and Retry, rather than an empty count, when the data service fails', async () => {
    state.search.mockRejectedValueOnce(new Error('unavailable'));
    await render();
    expect(host.textContent).toContain('We couldn’t load accounts');
    expect(host.textContent).toContain('Retry');
    expect(host.textContent).not.toContain('0 matching accounts');
    await act(async () => {
      Array.from(host.querySelectorAll('[role="button"]'))
        .find((node) => node.textContent === 'Retry')
        ?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(host.textContent).toContain('fixture@example.com');
  });
});
