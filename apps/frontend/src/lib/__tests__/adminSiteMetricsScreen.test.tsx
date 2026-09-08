// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { leadershipFixture } from './leadershipMetricsFixture';

const state = vi.hoisted(() => ({
  auth: {
    isLoading: false,
    isSignedIn: true,
    user: { id: 'test-admin' } as { id: string } | null,
    accessToken: 'test-token' as string | null,
  },
  access: { state: 'allowed', retry: vi.fn() },
}));
vi.mock('../../providers/AuthProvider', () => ({ useAuth: () => state.auth }));
vi.mock('../../hooks/useAdminAccess', () => ({ useAdminAccess: () => state.access }));
vi.mock('../../hooks/useResponsive', () => ({
  useResponsive: () => ({ isMobile: true, isDesktop: false }),
}));
vi.mock('../../data/api', () => ({
  ApiError: class extends Error {
    status = 403;
  },
}));
vi.mock('../../data/siteMetricsApi', () => ({ getLeadershipMetricsFromApi: vi.fn() }));
vi.mock('../../providers/signInModalContext', () => ({
  useSignInModal: () => ({ openSignIn: vi.fn() }),
}));
vi.mock('../../navigation/documentTitle', () => ({ useDocumentTitle: vi.fn() }));
vi.mock('../../navigation/topNavRoutes', () => ({ navigateTopNavItem: vi.fn() }));
vi.mock('../../components/GoBackLink', () => ({ GoBackLink: () => null }));
vi.mock('../../components/search/searchPieces', () => ({
  SearchPageShell: ({ hero, children }: any) => (
    <div>
      {hero}
      {children}
    </div>
  ),
}));

import { getLeadershipMetricsFromApi } from '../../data/siteMetricsApi';
import { AdminSiteMetricsScreen } from '../../screens/redesign/AdminSiteMetricsScreen';

let container: HTMLDivElement;
let root: Root;
async function render() {
  await act(async () =>
    root.render(createElement(AdminSiteMetricsScreen, { navigation: {} } as any)),
  );
}
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  state.auth = {
    isLoading: false,
    isSignedIn: true,
    user: { id: 'test-admin' },
    accessToken: 'test-token',
  };
  state.access = { state: 'allowed', retry: vi.fn() };
  vi.mocked(getLeadershipMetricsFromApi).mockReset().mockResolvedValue(leadershipFixture());
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

describe('private leadership screen', () => {
  it('distinguishes stored people from the current roster and explains vacant seats', async () => {
    await render();
    expect(container.textContent).toContain('Legislator records, current and former206');
    expect(container.textContent).toContain('Currently serving200');
    expect(container.textContent).toContain('Minnesota has 201 seats. Vacant seats aren’t listed.');
    expect(container.textContent).not.toContain('Stored legislators');
  });
  it.each(['signed-out', 'restricted', 'loading', 'error'])(
    'does not request metrics without allowed access: %s',
    async (access) => {
      state.access.state = access;
      await render();
      expect(getLeadershipMetricsFromApi).not.toHaveBeenCalled();
      expect(container.textContent).not.toContain('2,001');
      if (access === 'error') {
        const retry = Array.from(container.querySelectorAll('[role="button"]')).find(
          (node) => node.textContent === 'Retry',
        );
        await act(async () => (retry as HTMLElement).click());
        expect(state.access.retry).toHaveBeenCalledOnce();
      }
    },
  );
  it('clears loaded counts and aborts on a token or account change, then on sign-out', async () => {
    await render();
    expect(container.textContent).toContain('2,001');
    const originalSignal = vi.mocked(getLeadershipMetricsFromApi).mock.calls[0][1]!;
    vi.mocked(getLeadershipMetricsFromApi).mockImplementation(() => new Promise(() => {}));
    state.auth = { ...state.auth, user: { id: 'test-next-admin' }, accessToken: 'test-next-token' };
    await render();
    expect(originalSignal.aborted).toBe(true);
    expect(container.textContent).not.toContain('2,001');
    expect(container.textContent).toContain('Loading Admin metrics');
    state.auth = { ...state.auth, isSignedIn: false, user: null, accessToken: null };
    state.access.state = 'signed-out';
    await render();
    expect(vi.mocked(getLeadershipMetricsFromApi).mock.calls[1][1]!.aborted).toBe(true);
    expect(container.textContent).not.toContain('2,001');
  });
  it('rejects a late answer from the previous account', async () => {
    let finish: ((value: ReturnType<typeof leadershipFixture>) => void) | undefined;
    vi.mocked(getLeadershipMetricsFromApi).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    await render();
    const replacement = leadershipFixture();
    replacement.operations!.corpus.bills = 9876;
    vi.mocked(getLeadershipMetricsFromApi).mockResolvedValue(replacement);
    state.auth = { ...state.auth, accessToken: 'test-replacement-token' };
    await render();
    await act(async () => finish?.(leadershipFixture()));
    expect(container.textContent).toContain('9,876');
    expect(container.textContent).not.toContain('2,001');
  });
  it('keeps available sources visible while showing a failed source reason', async () => {
    const partial = leadershipFixture();
    partial.operations = null;
    partial.errors.operations = 'Source records could not be loaded.';
    vi.mocked(getLeadershipMetricsFromApi).mockResolvedValue(partial);
    await render();
    expect(container.textContent).toContain('Source records could not be loaded.');
    expect(container.textContent).toContain('Current surviving accounts created23');
    expect(container.textContent).toContain(
      'Accounts first used counts first signed-in use, not sign-ups.',
    );
    expect(container.textContent).not.toContain('2,001');
  });
  it('shows source and cost limitations, and changes only activity and creation ranges', async () => {
    const fixture = leadershipFixture();
    Object.assign(fixture.activity!.history!.newReaderAccounts, {
      current7dComplete: false,
      previous7dComplete: false,
    });
    vi.mocked(getLeadershipMetricsFromApi).mockResolvedValue(fixture);
    await render();
    expect(container.textContent).toContain('Partial range');
    expect(container.querySelector('[role="table"]')).not.toBeNull();
    expect(container.querySelectorAll('[role="columnheader"]')).toHaveLength(3);
    expect(container.textContent).toContain(
      'Deleted accounts are not included, so past creation totals can decrease.',
    );
    expect(container.textContent).toContain('not proof that every bill is current');
    expect(container.textContent).toContain(
      'not invoices, reserved budgets, or total operating cost',
    );
    expect(container.textContent).toContain('Partial records');
    expect(container.textContent).toContain('Total operating costUnavailable');
    const thirty = Array.from(container.querySelectorAll('[role="button"]')).find(
      (node) => node.textContent === 'Last 30 days',
    );
    await act(async () => (thirty as HTMLElement).click());
    expect(container.textContent).toContain('Surviving accounts created in last 30 days8');
    expect(container.textContent).toContain('Stored bills2,001');
    expect(getLeadershipMetricsFromApi).toHaveBeenCalledOnce();
  });
  it('offers a bounded manual retry after the private request fails', async () => {
    vi.mocked(getLeadershipMetricsFromApi).mockRejectedValueOnce(new Error('offline'));
    await render();
    expect(container.textContent).toContain('Admin metrics are unavailable');
    const retry = Array.from(container.querySelectorAll('[role="button"]')).find(
      (node) => node.textContent === 'Retry',
    );
    await act(async () => (retry as HTMLElement).click());
    expect(getLeadershipMetricsFromApi).toHaveBeenCalledTimes(2);
    expect(container.textContent).toContain('2,001');
  });
});
