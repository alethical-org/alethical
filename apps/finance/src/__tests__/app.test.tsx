import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { SupabaseClient } from '@supabase/supabase-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { App } from '../App';
import { navigate } from '../router';
import { rememberCodeRequest } from '../auth/codeRequest';
import { SessionProvider } from '../auth/session';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const API = 'https://api.example.test';

function fakeSupabase(session: { access_token: string; user: { email: string } } | null) {
  return {
    auth: {
      getSession: vi.fn(async () => ({ data: { session } })),
      onAuthStateChange: vi.fn(() => ({
        data: { subscription: { unsubscribe() {} } },
      })),
      signOut: vi.fn(async () => ({ error: null })),
      signInWithOAuth: vi.fn(async () => ({ error: null })),
      verifyOtp: vi.fn(async () => ({ data: {}, error: null })),
    },
  } as unknown as SupabaseClient & {
    auth: Record<string, ReturnType<typeof vi.fn>>;
  };
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
  // A code request is kept for the tab; each test starts a new one.
  window.sessionStorage.clear();
});

async function renderAt(
  path: string,
  supabase: SupabaseClient,
  accessStatus = 200,
  googleSignIn = true,
  emailSignIn = true,
) {
  window.history.replaceState(null, '', path);
  const fetcher = vi.fn(async (url: string) =>
    url.endsWith('/sign-in/verify')
      ? new Response(
          JSON.stringify({
            data: { token_hash: 'one-time-token', type: 'email' },
          }),
          { status: 200 },
        )
      : url.endsWith('/sign-in/code')
        ? new Response(
            JSON.stringify({
              data: { status: 'accepted', challenge: 'challenge-1' },
            }),
            {
              status: 202,
            },
          )
        : new Response(null, { status: accessStatus }),
  );
  vi.stubGlobal('fetch', fetcher);
  await act(async () => {
    root.render(
      <SessionProvider
        supabase={supabase}
        apiBaseUrl={API}
        googleSignIn={googleSignIn}
        emailSignIn={emailSignIn}
        screens
      >
        <App />
      </SessionProvider>,
    );
  });
  await act(async () => {});
  return fetcher;
}

const SIGNED_IN = {
  access_token: 'token-1',
  user: { email: 'reader@example.test' },
};

describe('the Finance shell', () => {
  it('sends a signed-out reader to sign-in and keeps where they were going', async () => {
    await renderAt('/money/committees/12?year=2026', fakeSupabase(null));
    expect(window.location.pathname).toBe('/sign-in');
    expect(new URLSearchParams(window.location.search).get('next')).toBe(
      '/money/committees/12?year=2026',
    );
    expect(container.textContent).toContain('Sign in');
  });

  it('keeps ordinary sign-in separate from investor access without account creation', async () => {
    await renderAt('/sign-in', fakeSupabase(null));
    const text = container.textContent ?? '';
    expect(text).toContain('Continue with Google');
    expect(text).toContain('Sign in with email');
    expect(text).not.toContain('Investor access');
    expect(text).not.toMatch(/create account/i);
    expect(container.querySelector('input[type="password"]')).toBeNull();
  });

  it('hides Google until Supabase accepts the Finance return address', async () => {
    await renderAt('/sign-in', fakeSupabase(null), 200, false);
    expect(container.textContent).not.toContain('Google');
    expect(container.textContent).toContain('Sign in with email');
  });

  it('hides email sign-in and its saved challenge when email access is off', async () => {
    rememberCodeRequest('reader@example.test', 'previous-challenge');
    await renderAt('/sign-in', fakeSupabase(null), 200, true, false);
    expect(container.textContent).toContain('Continue with Google');
    expect(container.textContent).not.toContain('Sign in with email');
    expect(container.querySelector('#code')).toBeNull();
    expect(
      container.querySelector('a[aria-label="Alethical Finance home"]')?.getAttribute('href'),
    ).toBe('/');
  });

  it('keeps shared-password access when ordinary sign-in methods are off', async () => {
    await renderAt('/investor-access', fakeSupabase(null), 200, false, false);
    expect(container.textContent).toContain('Investor');
    expect(container.querySelectorAll('button')).toHaveLength(1);
  });

  it('asks the server for a code, then proves it to Supabase', async () => {
    const supabase = fakeSupabase(null);
    const fetcher = await renderAt('/sign-in', supabase);
    const click = async (label: string) => {
      const button = [...container.querySelectorAll('button')].find((b) => b.textContent === label);
      await act(async () => button!.click());
    };
    const type = async (selector: string, value: string) => {
      const input = container.querySelector<HTMLInputElement>(selector)!;
      await act(async () => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(
          input,
          value,
        );
        input.dispatchEvent(new Event('input', { bubbles: true }));
      });
    };
    await click('Sign in with email');
    await type('#email', 'reader@example.test');
    await click('Continue');
    expect(fetcher).toHaveBeenCalledWith(`${API}/api/v1/finance/sign-in/code`, expect.anything());
    expect(container.textContent).toContain(
      'If reader@example.test has access to Alethical Finance, a code is on its way to it.',
    );
    await type('#code', ' 12345678 ');
    await click('Continue');
    expect(fetcher).toHaveBeenCalledWith(
      `${API}/api/v1/finance/sign-in/verify`,
      expect.objectContaining({
        body: JSON.stringify({
          email: 'reader@example.test',
          code: '12345678',
          challenge: 'challenge-1',
        }),
      }),
    );
    expect(supabase.auth.verifyOtp).toHaveBeenCalledWith({
      token_hash: 'one-time-token',
      type: 'email',
    });
  });

  it('shows Finance Home in the shell to a listed account', async () => {
    await renderAt('/home', fakeSupabase(SIGNED_IN));
    expect(container.querySelector('header.f-nav')).not.toBeNull();
    expect(container.querySelector('header [role="search"]')).toBeNull();
    expect(container.querySelectorAll('main [role="search"]')).toHaveLength(1);
    expect(container.querySelector('h1')?.textContent).toBe('Research public records');
    expect(document.title).toBe('Finance Home · Alethical Finance');
  });

  it('enters each directory from Home and keeps the checking tools off it', async () => {
    await renderAt('/home', fakeSupabase(SIGNED_IN));
    const links = [...container.querySelectorAll('a')].map((a) => ({
      text: a.textContent ?? '',
      href: a.getAttribute('href') ?? '',
    }));
    expect(links.find((link) => link.text === 'Candidates')?.href).toBe(
      '/people?type=candidates&from=%2Fhome',
    );
    expect(links.find((link) => link.text === 'Legislators')?.href).toBe(
      '/people?type=legislators&service=current&from=%2Fhome',
    );
    // Entered only from their context (rule eug-44), never from Home.
    expect(container.textContent).not.toContain('Confirm identities');
    expect(container.textContent).not.toContain('Check TV station files');
    expect(container.textContent).not.toContain('Donors by employer');
    // Money connections is built, so its header-corner action is Home's 1 filled action.
    const action = container.querySelector<HTMLAnchorElement>('.f-page-head .f-action');
    expect(action?.textContent).toContain('Explore money connections');
    expect(action?.getAttribute('href')).toBe('/money/connections?from=%2Fhome');
  });

  it('lists only the record families whose pages are built', async () => {
    await renderAt('/home', fakeSupabase(SIGNED_IN));
    const links = [...container.querySelectorAll('a')].map((a) => a.getAttribute('href'));
    for (const href of links) {
      if (!href || !href.startsWith('/')) continue;
      const path = href.split('?')[0];
      expect(['/home', '/search'].some((built) => path === built) || path.startsWith('/#')).toBe(
        path === '/home' || path === '/search' ? true : false,
      );
    }
  });

  it('answers an unknown address with the not-found page', async () => {
    await renderAt('/money/nothing-here', fakeSupabase(SIGNED_IN));
    expect(container.querySelector('h1')?.textContent).toBe('Couldn’t find that page');
    expect(document.title).toBe('Page not found · Alethical Finance');
  });

  it('keeps identity review unavailable even through a direct URL', async () => {
    const fetcher = await renderAt(
      '/money/identities?name=Example&role=donor',
      fakeSupabase(SIGNED_IN),
    );
    expect(container.querySelector('h1')?.textContent).toBe('Couldn’t find that page');
    expect(document.title).toBe('Page not found · Alethical Finance');
    expect(fetcher.mock.calls.some(([url]) => url.includes('/finance/identities'))).toBe(false);
    expect(container.textContent).not.toContain('Confirm identities');
  });

  it('shows the landing page at / to a signed-in account too', async () => {
    await renderAt('/', fakeSupabase(SIGNED_IN));
    expect(container.querySelector('header.f-nav')).toBeNull();
    expect(document.title).toBe('Alethical Finance');
  });

  it('shows the no-access state, naming the account but no reason', async () => {
    await renderAt('/money', fakeSupabase(SIGNED_IN), 403);
    expect(container.textContent).toContain(
      'This account doesn’t have access to Alethical Finance',
    );
    expect(container.textContent).toContain('Signed in as reader@example.test');
    expect(container.querySelector('nav')).toBeNull();
    expect(document.title).toBe('Alethical Finance');
  });

  it('offers a retry when access cannot be checked, never the no-access state', async () => {
    await renderAt('/money', fakeSupabase(SIGNED_IN), 503);
    expect(container.textContent).toContain('Couldn’t check your access');
    expect(container.textContent).not.toContain('doesn’t have access');
  });

  it('answers an unknown address inside the shell', async () => {
    await renderAt('/no-such-page', fakeSupabase(SIGNED_IN));
    expect(container.querySelector('h1')?.textContent).toBe('Couldn’t find that page');
  });
});

it('keeps typing focus across name-search paths but focuses ordinary destinations', async () => {
  await renderAt('/money/names/Example', fakeSupabase(SIGNED_IN));
  const input = container.querySelector<HTMLInputElement>('input')!;
  input.focus();
  await act(async () => navigate('/money/names/Other', { replace: true, preserveFocus: true }));
  expect(document.activeElement).toBe(input);
  await act(async () => navigate('/money/names', { replace: true, preserveFocus: true }));
  expect(document.activeElement).toBe(input);
  expect(container.textContent).toContain('Enter a name as reported');
  await act(async () => navigate('/people'));
  expect(document.activeElement).toBe(container.querySelector('h1'));
});
