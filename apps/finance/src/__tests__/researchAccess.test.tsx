import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { AuthChangeEvent, Session, SupabaseClient } from '@supabase/supabase-js';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { App } from '../App';
import { SessionProvider, useFinanceSession, type FinanceSession } from '../auth/session';
import { STORAGE_KEY } from '../auth/supabase';
import {
  RESEARCH_SESSION_KEY,
  readResearchSession,
  saveResearchSession,
} from '../auth/researchSession';
import { navigate } from '../router';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const TOKEN = `finance_research_${'a'.repeat(43)}`;
const research = () => ({
  access_token: TOKEN,
  email: 'demo@example.test',
  expires_at: new Date(Date.now() + 3600000).toISOString(),
});
let root: Root;
let container: HTMLDivElement;
let fetcher: ReturnType<typeof vi.fn>;
let authListener: (event: AuthChangeEvent, session: Session | null) => void;
let currentSession: FinanceSession;
function SessionProbe() {
  currentSession = useFinanceSession();
  return null;
}
const ordinary = {
  access_token: 'ordinary-token',
  user: { id: 'ordinary-user', email: 'ordinary@example.test' },
} as Session;
function storageValues() {
  return Array.from(
    { length: window.localStorage.length },
    (_, index) => window.localStorage.getItem(window.localStorage.key(index)!) ?? '',
  );
}
const auth = {
  getSession: vi.fn(async (): Promise<{ data: { session: Session | null } }> => ({
    data: { session: null },
  })),
  onAuthStateChange: vi.fn((_listener: typeof authListener) => ({
    data: { subscription: { unsubscribe() {} } },
  })),
  signOut: vi.fn(async () => ({ error: null })),
};
function json(data: unknown, status = 200) {
  return new Response(JSON.stringify({ data }), { status });
}
beforeEach(() => {
  const values = new Map<string, string>();
  const storage = {
    get length() {
      return values.size;
    },
    key: (index: number) => [...values.keys()][index] ?? null,
    clear: () => values.clear(),
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  };
  Object.defineProperty(window, 'localStorage', {
    value: storage,
    configurable: true,
  });
  Object.defineProperty(window, 'sessionStorage', {
    value: storage,
    configurable: true,
  });
  auth.getSession.mockReset().mockResolvedValue({ data: { session: null } });
  auth.signOut.mockReset().mockResolvedValue({ error: null });
  auth.onAuthStateChange.mockImplementation((listener) => {
    authListener = listener;
    return { data: { subscription: { unsubscribe() {} } } };
  });
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  fetcher = vi.fn(async (url: string) => {
    if (url.endsWith('/sign-in/research')) return json(research());
    if (url.endsWith('/access')) return json({ allowed: true, can_edit: false });
    if (url.endsWith('/sign-out')) return json({ signed_out: true });
    return json({
      rows: [],
      counts: {},
      stations: [],
      sources: [],
      total: 0,
      tab: 'files',
      q: '',
    });
  });
  vi.stubGlobal('fetch', fetcher);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  vi.useRealTimers();
});
async function render(path: string) {
  window.history.replaceState(null, '', path);
  await act(async () =>
    root.render(
      <SessionProvider
        supabase={{ auth } as unknown as SupabaseClient}
        apiBaseUrl="https://api.example.test"
        screens
        googleSignIn
        emailSignIn
      >
        <SessionProbe />
        <App />
      </SessionProvider>,
    ),
  );
}
const text = () => container.textContent ?? '';
function button(label: string) {
  return [...container.querySelectorAll('button')].find((b) => b.textContent === label)!;
}
async function type(id: string, value: string) {
  const input = container.querySelector<HTMLInputElement>(id)!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
async function passwordForm() {
  await render('/sign-in?next=%2Fmedia-buys');
  await act(async () => button('Investor login').click());
  await type('#email', 'demo@example.test');
  await type('#password', 'demo-test-password');
}
it('signs in without a mailbox, keeps the requested page, and hides edit controls', async () => {
  await passwordForm();
  await act(async () => button('Sign in').click());
  expect(window.location.pathname).toBe('/media-buys');
  expect(text()).toContain('Media buys');
  expect(text()).not.toContain('Check TV station files');
  expect(text()).not.toMatch(/reset password|create account/i);
  expect(readResearchSession()?.access_token).toBe(TOKEN);
  expect(window.localStorage.getItem(RESEARCH_SESSION_KEY)).not.toContain('demo-test-password');
  expect(
    fetcher.mock.calls.filter(([url]) => String(url).endsWith('/sign-in/research')),
  ).toHaveLength(1);
  expect(auth.signOut).toHaveBeenCalledWith({ scope: 'local' });
});
it.each([
  ['/money/identities', 'Confirm identities'],
  ['/media-buys/check', 'Check TV station files'],
])('refuses a direct edit-page visit to %s', async (path, label) => {
  saveResearchSession(research());
  await render(path);
  expect(text()).toContain('We couldn’t find that page');
  expect(text()).not.toContain(label);
  expect(
    fetcher.mock.calls.some(
      ([url]) => String(url).includes('/identities') || String(url).includes('/queue'),
    ),
  ).toBe(false);
});
it.each([
  [401, 'That email or password is not right'],
  [429, 'Too many sign-in attempts'],
  [503, 'We couldn’t sign you in'],
])('keeps entered fields for a retry after %i', async (status, message) => {
  fetcher.mockImplementation(async () => new Response(null, { status }));
  await passwordForm();
  await act(async () => button('Sign in').click());
  expect(text()).toContain(message);
  expect(container.querySelector<HTMLInputElement>('#email')?.value).toBe('demo@example.test');
  expect(button('Sign in').disabled).toBe(false);
  expect(readResearchSession()).toBeNull();
});
it('signs out only the current session and clears it locally', async () => {
  saveResearchSession(research());
  await render('/media-buys');
  await act(async () => button('Account').click());
  await act(async () => button('Sign out').click());
  expect(readResearchSession()).toBeNull();
  expect(storageValues().join(' ')).not.toContain(TOKEN);
  expect(window.location.pathname).toBe('/sign-in');
  const call = fetcher.mock.calls.find(([url]) => String(url).endsWith('/research/sign-out'));
  expect(call).toBeTruthy();
  expect(call?.[1]).toMatchObject({
    headers: { Authorization: `Bearer ${TOKEN}` },
  });
  expect(auth.signOut).not.toHaveBeenCalled();
});
it('drops a revoked session when the tab returns', async () => {
  saveResearchSession(research());
  await render('/media-buys');
  fetcher.mockImplementation(async () => new Response(null, { status: 401 }));
  await act(async () => window.dispatchEvent(new Event('focus')));
  expect(readResearchSession()).toBeNull();
  expect(storageValues().join(' ')).not.toContain(TOKEN);
  expect(window.location.pathname).toBe('/sign-in');
  expect(text()).not.toContain('Search records');
});
it('expires locally even if the access service is unavailable', async () => {
  vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
  saveResearchSession({
    ...research(),
    expires_at: new Date(Date.now() + 1000).toISOString(),
  });
  await render('/media-buys');
  fetcher.mockImplementation(async () => new Response(null, { status: 503 }));
  await act(async () => vi.advanceTimersByTimeAsync(1001));
  expect(readResearchSession()).toBeNull();
  expect(storageValues().join(' ')).not.toContain(TOKEN);
  expect(window.location.pathname).toBe('/sign-in');
});
it('handles sign-out from another tab and hides previously viewed research', async () => {
  saveResearchSession(research());
  await render('/media-buys');
  saveResearchSession(null);
  await act(async () =>
    window.dispatchEvent(new StorageEvent('storage', { key: RESEARCH_SESSION_KEY })),
  );
  expect(text()).toContain('Sign in');
  await act(async () => navigate('/money/identities'));
  expect(text()).not.toContain('Confirm identities');
});

it('stores a nonsecret research identity outside the session record', async () => {
  saveResearchSession(research());
  await render('/media-buys');
  expect(window.localStorage.getItem('alethical-finance-draft-account')).toBe(
    'research:demo@example.test',
  );
  for (let index = 0; index < window.localStorage.length; index += 1) {
    const key = window.localStorage.key(index)!;
    if (key !== RESEARCH_SESSION_KEY) expect(window.localStorage.getItem(key)).not.toContain(TOKEN);
  }
});
it('never restores a delayed ordinary session after research sign-out', async () => {
  let resolve!: (value: { data: { session: Session | null } }) => void;
  auth.getSession.mockReturnValue(
    new Promise((done) => {
      resolve = done;
    }),
  );
  await passwordForm();
  await act(async () => button('Sign in').click());
  expect(currentSession.canEdit).toBe(false);
  await act(async () => resolve({ data: { session: ordinary } }));
  await act(async () => authListener('TOKEN_REFRESHED', ordinary));
  await act(async () => currentSession.signOut());
  await act(async () => authListener('TOKEN_REFRESHED', ordinary));
  expect(currentSession.status).toBe('signed-out');
  expect(currentSession.accessToken).toBeNull();
  expect(currentSession.email).toBeNull();
  expect(storageValues().join(' ')).not.toContain(TOKEN);
});
it.each(['returned', 'thrown'])(
  'enters research when ordinary local sign-out fails (%s)',
  async (failure) => {
    window.localStorage.setItem(STORAGE_KEY, 'old-ordinary-session');
    if (failure === 'thrown') auth.signOut.mockRejectedValueOnce(new Error('offline'));
    else auth.signOut.mockResolvedValueOnce({ error: new Error('offline') } as never);
    await passwordForm();
    await act(async () => button('Sign in').click());
    expect(currentSession.status).toBe('granted');
    expect(currentSession.canEdit).toBe(false);
    expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull();
  },
);
it('allows ordinary sign-in after leaving research and handles thrown sign-out', async () => {
  saveResearchSession(research());
  await render('/media-buys');
  await act(async () => currentSession.signOut());
  await act(async () => authListener('SIGNED_IN', ordinary));
  expect(currentSession.status).toBe('signed-out');
  await act(async () => currentSession.beginOrdinarySignIn());
  await act(async () => authListener('SIGNED_IN', ordinary));
  expect(currentSession.status).toBe('granted');
  expect(currentSession.canEdit).toBe(true);
  expect(currentSession.email).toBe('ordinary@example.test');
  window.localStorage.setItem(STORAGE_KEY, 'old-ordinary-session');
  auth.signOut.mockRejectedValueOnce(new Error('offline'));
  await act(async () => currentSession.signOut());
  expect(currentSession.status).toBe('signed-out');
  expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull();
});
it('ignores a pending access answer after research is removed in another tab', async () => {
  let resolve!: (response: Response) => void;
  fetcher.mockImplementation(
    () =>
      new Promise<Response>((done) => {
        resolve = done;
      }),
  );
  saveResearchSession(research());
  await render('/media-buys');
  saveResearchSession(null);
  await act(async () =>
    window.dispatchEvent(new StorageEvent('storage', { key: RESEARCH_SESSION_KEY })),
  );
  await act(async () => resolve(json({ allowed: true, can_edit: false })));
  expect(currentSession.status).toBe('signed-out');
  expect(currentSession.accessToken).toBeNull();
  expect(storageValues().join(' ')).not.toContain(TOKEN);
});

it('removes an already-expired research bearer when opening the site', async () => {
  auth.getSession.mockResolvedValue({ data: { session: ordinary } });
  window.localStorage.setItem(STORAGE_KEY, 'old-ordinary-session');
  saveResearchSession({ ...research(), expires_at: new Date(Date.now() - 1000).toISOString() });
  await render('/media-buys');
  await act(async () => authListener('INITIAL_SESSION', ordinary));
  await act(async () => authListener('SIGNED_IN', ordinary));
  expect(currentSession.status).toBe('signed-out');
  expect(storageValues().join(' ')).not.toContain(TOKEN);
});

it.each(['SIGNED_IN', 'INITIAL_SESSION'] as const)(
  'keeps a pending ordinary access answer after repeated %s for the same token',
  async (event) => {
    let resolve!: (response: Response) => void;
    auth.getSession.mockResolvedValue({ data: { session: ordinary } });
    fetcher.mockImplementation((url: string) => {
      if (url.endsWith('/access'))
        return new Promise<Response>((done) => {
          resolve = done;
        });
      return Promise.resolve(
        json({ rows: [], counts: {}, stations: [], sources: [], total: 0, tab: 'files', q: '' }),
      );
    });
    await render('/media-buys');
    expect(currentSession.status).toBe('checking');
    await act(async () => authListener(event, { ...ordinary }));
    await act(async () => resolve(json({ allowed: true })));
    expect(currentSession.status).toBe('granted');
    expect(currentSession.canEdit).toBe(true);
  },
);

it('accepts cross-tab ordinary sign-in after an initial signed-out auth event', async () => {
  await render('/sign-in');
  await act(async () => authListener('INITIAL_SESSION', null));
  expect(currentSession.status).toBe('signed-out');
  await act(async () => authListener('SIGNED_IN', ordinary));
  expect(currentSession.status).toBe('granted');
  expect(currentSession.canEdit).toBe(true);
  expect(currentSession.email).toBe('ordinary@example.test');
});
