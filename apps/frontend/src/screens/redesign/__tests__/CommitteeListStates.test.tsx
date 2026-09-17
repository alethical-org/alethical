// @vitest-environment jsdom

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  (globalThis as { __DEV__?: boolean }).__DEV__ = false;
  process.env.EXPO_PUBLIC_API_URL = 'http://records.test';
  // React only flushes work inside act() when it is told it is under test.
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
vi.mock('../../../hooks/useAppQueries', () => ({
  useCampaignFinanceCommittees: () => currentRead,
  usePrefetchCommitteeMoney: () => () => {},
}));
vi.mock('../../../providers/AuthProvider', () => ({
  useAuth: () => ({ accessToken: null, user: null, session: null }),
}));

// Two packages ship TypeScript that this runner does not compile, and both are
// only drawing: the icons in the page's chrome, and the navigator the top bar
// asks which address it is on. Neither can change what the page says it found.
vi.mock('react-native-svg', () => {
  const nothing = () => null;
  return {
    default: nothing,
    Svg: nothing,
    Circle: nothing,
    Defs: nothing,
    Ellipse: nothing,
    G: nothing,
    Line: nothing,
    LinearGradient: nothing,
    Path: nothing,
    Polygon: nothing,
    Polyline: nothing,
    Rect: nothing,
    Stop: nothing,
    Text: nothing,
  };
});
// The top bar offers a sign-in dialog it expects an app-wide provider to own.
// Nothing on this page opens it.
vi.mock('../../../providers/signInModalContext', () => ({
  useSignInModal: () => ({ openSignIn: () => {} }),
}));
vi.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: () => {}, push: () => {}, setParams: () => {} }),
  useRoute: () => ({ name: 'MoneySearch', params: {} }),
  useIsFocused: () => true,
}));

import { CommitteeListScreen } from '../CommitteeListScreen';

const retry = vi.fn();
const currentRead = {
  data: null as unknown,
  isPending: false,
  isPlaceholderData: false,
  isSuccess: true,
  isError: false,
  isFetching: false,
  refetch: retry,
};
const register = {
  state: 'reported',
  orderedBy: 'name',
  total: 1,
  registerTotal: 1603,
  byKind: { candidate_committee: 778, party_unit: 299, political_committee_or_fund: 526 },
  asOf: '2026-08-12',
  hasMore: false,
  committees: [
    {
      name: 'Sample for Senate',
      registrationNumber: '12345',
      kind: 'candidate_committee',
      subType: null,
      office: 'Senate',
      district: '41',
      isClosed: false,
      terminationDate: null,
    },
  ],
};
const roots: ReturnType<typeof createRoot>[] = [];
function mount(params: Record<string, string> = {}) {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  roots.push(root);
  const setParams = vi.fn();
  const render = (next = params) =>
    act(() =>
      root.render(
        <CommitteeListScreen
          navigation={{ setParams, navigate: vi.fn(), push: vi.fn(), replace: vi.fn() } as never}
          route={{ name: 'CommitteeList', key: 'directory', params: next } as never}
        />,
      ),
    );
  render();
  return { host, setParams, render, words: () => host.textContent ?? '' };
}
afterEach(() => {
  roots.splice(0).forEach((root) => act(() => root.unmount()));
  document.body.innerHTML = '';
  Object.assign(currentRead, {
    data: null,
    isPending: false,
    isPlaceholderData: false,
    isSuccess: true,
    isError: false,
    isFetching: false,
  });
  retry.mockClear();
});

describe('committee directory states', () => {
  it('hides previous-query rows and counts while the new filter loads', () => {
    Object.assign(currentRead, { data: register, isPlaceholderData: true, isFetching: true });
    const page = mount({ q: 'Jones', kind: 'party_unit' });
    expect(page.words()).toContain('Loading committees');
    expect(page.words()).not.toContain('Sample for Senate');
    expect(page.words()).not.toContain('1,603 registered filers');
    expect(page.words()).not.toContain('No party units match');
  });
  it('keeps whole-category counts while showing a searched subset', () => {
    currentRead.data = register;
    const page = mount({ q: 'Sample' });
    expect(page.words()).toContain('1,603 registered filers · State register dated Aug 12, 2026');
    expect(page.words()).toContain('Candidate committees778');
    expect(page.words()).toContain('1 registered filer');
    expect(page.host.querySelector('a[href*="sample-for-senate-12345"]')).not.toBeNull();
  });
  it('keeps a served register date when the total is unavailable', () => {
    currentRead.data = { ...register, registerTotal: null, total: null, byKind: {} };
    const page = mount();
    expect(page.words()).toContain('State register dated Aug 12, 2026');
    expect(page.words()).not.toContain('1,603');
    expect(page.words()).not.toContain('0 registered');
  });
  it('distinguishes a failed read from an empty register and offers retry', () => {
    Object.assign(currentRead, { isError: true, isSuccess: false });
    const page = mount();
    expect(page.words()).toContain('We couldn’t load the register just now');
    expect(page.words()).not.toContain('No committees in our copy');
    const button = [...page.host.querySelectorAll('[role="button"],button')].find(
      (node) => node.textContent === 'Try again',
    ) as HTMLElement;
    act(() => button.click());
    expect(retry).toHaveBeenCalledOnce();
  });
  it('removes only the kind filter from an empty search', () => {
    currentRead.data = { ...register, committees: [], total: 0 };
    const page = mount({ q: 'Sample', kind: 'party_unit', page: '2' });
    expect(page.words()).toContain('No party units match “Sample”');
    const button = [...page.host.querySelectorAll('[role="button"],button')].find(
      (node) => node.textContent === 'Show all kinds',
    ) as HTMLElement;
    act(() => button.click());
    expect(page.setParams).toHaveBeenCalledWith({ kind: undefined, page: undefined });
  });
});

it('returns to the top when the numbered page changes without jumping on initial load', () => {
  const scrollTo = vi.fn();
  Object.defineProperty(HTMLElement.prototype, 'scroll', { configurable: true, value: scrollTo });
  currentRead.data = { ...register, total: 151 };
  const page = mount();
  expect(scrollTo).not.toHaveBeenCalled();
  page.render({ page: '2' });
  expect(scrollTo).toHaveBeenCalledWith(expect.objectContaining({ top: 0, behavior: 'auto' }));
  delete (HTMLElement.prototype as unknown as { scroll?: unknown }).scroll;
});
