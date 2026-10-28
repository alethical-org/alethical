import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { SupabaseClient } from '@supabase/supabase-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { App } from '../App';
import { SessionProvider } from '../auth/session';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const API = 'https://api.example.test';

function fakeSupabase(session: { access_token: string; user: { email: string } } | null) {
  return {
    auth: {
      getSession: vi.fn(async () => ({ data: { session } })),
      onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe() {} } } })),
      signOut: vi.fn(async () => ({ error: null })),
      signInWithOAuth: vi.fn(async () => ({ error: null })),
      verifyOtp: vi.fn(async () => ({ data: {}, error: null })),
    },
  } as unknown as SupabaseClient & { auth: Record<string, ReturnType<typeof vi.fn>> };
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
});

async function renderAt(
  path: string,
  supabase: SupabaseClient,
  accessStatus = 200,
  googleSignIn = true,
  emailSignIn = true,
) {
  window.history.replaceState(null, '', path);
  const fetcher = vi.fn(
    async (url: string) =>
      new Response(null, { status: url.endsWith('/sign-in/code') ? 202 : accessStatus }),
  );
  vi.stubGlobal('fetch', fetcher);
  await act(async () => {
    root.render(
      <SessionProvider
        supabase={supabase}
        apiBaseUrl={API}
        googleSignIn={googleSignIn}
        emailSignIn={emailSignIn}
      >
        <App />
      </SessionProvider>,
    );
  });
  await act(async () => {});
  return fetcher;
}

const SIGNED_IN = { access_token: 'token-1', user: { email: 'reader@example.test' } };

describe('the Finance shell', () => {
  it('sends a signed-out reader to sign-in and keeps where they were going', async () => {
    await renderAt('/money/committees/12?year=2026', fakeSupabase(null));
    expect(window.location.pathname).toBe('/sign-in');
    expect(new URLSearchParams(window.location.search).get('next')).toBe(
      '/money/committees/12?year=2026',
    );
    expect(container.textContent).toContain('Sign in to Alethical Finance');
  });

  it('offers Google and email, and never a password or account creation', async () => {
    await renderAt('/sign-in', fakeSupabase(null));
    const text = container.textContent ?? '';
    expect(text).toContain('Continue with Google');
    expect(text).toContain('Sign in with email');
    expect(text).not.toMatch(/password|create account/i);
    expect(container.querySelector('input[type="password"]')).toBeNull();
  });

  it('hides Google until Supabase accepts the Finance return address', async () => {
    await renderAt('/sign-in', fakeSupabase(null), 200, false);
    expect(container.textContent).not.toContain('Google');
    expect(container.textContent).toContain('Sign in with email');
  });

  it('offers no email sign-in until its server route ships', async () => {
    await renderAt('/sign-in', fakeSupabase(null), 200, true, false);
    expect(container.textContent).toContain('Continue with Google');
    expect(container.textContent).not.toContain('Sign in with email');
  });

  it('says sign-in is not open when neither way is on', async () => {
    await renderAt('/sign-in', fakeSupabase(null), 200, false, false);
    expect(container.textContent).toContain('Sign-in to Alethical Finance is not open yet.');
    expect(container.querySelectorAll('button')).toHaveLength(0);
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
    expect(supabase.auth.verifyOtp).toHaveBeenCalledWith({
      email: 'reader@example.test',
      token: '12345678',
      type: 'email',
    });
  });

  it('shows the shell and the page placeholder to a listed account', async () => {
    await renderAt('/media-buys', fakeSupabase(SIGNED_IN));
    const nav = container.querySelector('nav[aria-label="Record families"]')!;
    expect([...nav.querySelectorAll('a')].map((a) => a.textContent)).toEqual([
      'Campaign money',
      'Lobbying',
      'People',
      'Legislation',
      'Media buys',
    ]);
    expect(nav.querySelector('[aria-current="page"]')?.textContent).toBe('Media buys');
    expect(container.querySelector('h1')?.textContent).toBe('Media buys');
    expect(document.title).toBe('Media buys · Alethical Finance');
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
    expect(container.textContent).toContain('We couldn’t check your access');
    expect(container.textContent).not.toContain('doesn’t have access');
  });

  it('answers an unknown address inside the shell', async () => {
    await renderAt('/no-such-page', fakeSupabase(SIGNED_IN));
    expect(container.querySelector('h1')?.textContent).toBe('We couldn’t find that page');
  });
});
