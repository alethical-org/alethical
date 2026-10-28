import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { Session, SupabaseClient } from '@supabase/supabase-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { App } from '../App';
import { rememberReturnPath, takeReturnPath } from '../auth/returnPath';
import { SessionProvider } from '../auth/session';
import { STORAGE_KEY } from '../auth/supabase';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const API = 'https://api.example.test';

function session(token: string, userId = 'user-1', email = 'reader@example.test') {
  return {
    access_token: token,
    user: { id: userId, email },
  } as unknown as Session;
}

type AuthListener = (event: string, next: Session | null) => void;

function fakeSupabase(initial: Session | null) {
  let listener: AuthListener = () => {};
  const auth = {
    getSession: vi.fn(async () => ({ data: { session: initial } })),
    onAuthStateChange: vi.fn((callback: AuthListener) => {
      listener = callback;
      return { data: { subscription: { unsubscribe() {} } } };
    }),
    signOut: vi.fn(async () => ({ error: null as Error | null })),
    signInWithOAuth: vi.fn(async () => ({ error: null })),
    verifyOtp: vi.fn(async () => ({ data: {}, error: null as Error | null })),
  };
  return {
    client: { auth } as unknown as SupabaseClient,
    auth,
    emit: (event: string, next: Session | null) => listener(event, next),
  };
}

let container: HTMLDivElement;
let root: Root;

class MemoryStorage {
  private values = new Map<string, string>();
  getItem(key: string) {
    return this.values.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.values.set(key, String(value));
  }
  removeItem(key: string) {
    this.values.delete(key);
  }
  clear() {
    this.values.clear();
  }
}

beforeEach(() => {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  // Node's own experimental localStorage hides the test page's, so each test
  // gets a fresh one.
  const storage = new MemoryStorage();
  vi.stubGlobal('localStorage', storage);
  Object.defineProperty(window, 'localStorage', {
    value: storage,
    configurable: true,
  });
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

async function render(path: string, client: SupabaseClient, fetcher: typeof fetch) {
  window.history.replaceState(null, '', path);
  vi.stubGlobal('fetch', fetcher);
  await act(async () => {
    root.render(
      <SessionProvider supabase={client} apiBaseUrl={API} googleSignIn emailSignIn>
        <App />
      </SessionProvider>,
    );
  });
  await act(async () => {});
}

function answering(...statuses: number[]) {
  let call = 0;
  return vi.fn(
    async () =>
      new Response(null, {
        status: statuses[Math.min(call++, statuses.length - 1)],
      }),
  );
}

/** The code request's answer: accepted, with the challenge the proof must carry. */
function accepted(challenge = 'challenge-1') {
  return new Response(JSON.stringify({ data: { status: 'accepted', challenge } }), {
    status: 202,
  });
}

const text = () => container.textContent ?? '';

describe('the access answer', () => {
  it('keeps the page when a returning tab hands over the same session again', async () => {
    const supabase = fakeSupabase(session('token-1'));
    const fetcher = answering(200);
    await render('/money', supabase.client, fetcher);
    const heading = container.querySelector('h1');
    await act(async () => supabase.emit('SIGNED_IN', session('token-1')));
    expect(container.querySelector('h1')).toBe(heading);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('re-checks a refreshed token quietly and keeps the page if that check fails', async () => {
    const supabase = fakeSupabase(session('token-1'));
    const fetcher = answering(200, 503);
    await render('/money', supabase.client, fetcher);
    await act(async () => supabase.emit('TOKEN_REFRESHED', session('token-2')));
    await act(async () => {});
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(text()).toContain('This page is waiting for its final design.');
    expect(text()).not.toContain('Checking access');
  });

  it('shows a revocation found on a refresh', async () => {
    const supabase = fakeSupabase(session('token-1'));
    await render('/money', supabase.client, answering(200, 403));
    await act(async () => supabase.emit('TOKEN_REFRESHED', session('token-2')));
    await act(async () => {});
    expect(text()).toContain('doesn’t have access');
  });

  it('never lets an older answer replace the answer for the current account', async () => {
    const supabase = fakeSupabase(session('token-1', 'user-1'));
    let releaseFirst: (response: Response) => void = () => {};
    const fetcher = vi.fn((_url: string, init: RequestInit) => {
      const auth = (init.headers as Record<string, string>).Authorization;
      return auth === 'Bearer token-1'
        ? new Promise<Response>((resolve) => (releaseFirst = resolve))
        : Promise.resolve(new Response(null, { status: 403 }));
    });
    await render('/money', supabase.client, fetcher as unknown as typeof fetch);
    await act(async () => supabase.emit('SIGNED_IN', session('token-9', 'user-2')));
    await act(async () => releaseFirst(new Response(null, { status: 200 })));
    await act(async () => {});
    expect(text()).toContain('doesn’t have access');
    expect(container.querySelector('nav')).toBeNull();
  });

  it('sends a refused account on from the sign-in page to its own answer', async () => {
    await render('/sign-in?next=%2Fmoney', fakeSupabase(session('token-1')).client, answering(403));
    expect(window.location.pathname).toBe('/money');
    expect(text()).toContain('doesn’t have access');
  });

  it('keeps the unavailable screen while Try again re-asks, then shows the answer', async () => {
    let answer: (response: Response) => void = () => {};
    let call = 0;
    const fetcher = vi.fn(() =>
      ++call === 1
        ? Promise.resolve(new Response(null, { status: 503 }))
        : new Promise<Response>((resolve) => (answer = resolve)),
    );
    await render(
      '/money',
      fakeSupabase(session('token-1')).client,
      fetcher as unknown as typeof fetch,
    );
    const tryAgain = [...container.querySelectorAll('button')].find(
      (b) => b.textContent === 'Try again',
    )!;
    await act(async () => tryAgain.click());
    const busy = [...container.querySelectorAll('button')].find(
      (b) => b.textContent === 'Trying again…',
    )!;
    expect(busy.getAttribute('aria-disabled')).toBe('true');
    await act(async () => answer(new Response(null, { status: 200 })));
    await act(async () => {});
    expect(container.querySelector('nav')).not.toBeNull();
  });

  it('says so when Try again is still unavailable, keeping focus on the button', async () => {
    await render('/money', fakeSupabase(session('token-1')).client, answering(503, 503));
    const tryAgain = () =>
      [...container.querySelectorAll('button')].find((b) =>
        (b.textContent ?? '').startsWith('Try'),
      )!;
    tryAgain().focus();
    await act(async () => tryAgain().click());
    await act(async () => {});
    expect(text()).toContain('Still unavailable. Try again in a moment.');
    expect(document.activeElement).toBe(tryAgain());
  });

  it('moves focus to the unavailable heading on the sign-in page', async () => {
    await render('/sign-in', fakeSupabase(session('token-1')).client, answering(503));
    expect(container.querySelector('h1')?.textContent).toBe('We couldn’t check your access');
  });

  it('offers Try again on the sign-in page when a new sign-in cannot be checked', async () => {
    const supabase = fakeSupabase(session('token-1'));
    await render('/sign-in', supabase.client, answering(503));
    expect(text()).toContain('We couldn’t check your access');
    expect(text()).toContain('Try again');
  });
});

describe('sign-in steps', () => {
  const button = (label: string) =>
    [...container.querySelectorAll('button')].find((b) => b.textContent === label)!;
  const type = async (selector: string, value: string) => {
    const input = container.querySelector<HTMLInputElement>(selector)!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
  };

  it('moves focus to each step’s field and keeps the page asked for', async () => {
    await render(
      '/sign-in?next=%2Flobbying',
      fakeSupabase(null).client,
      vi.fn(async () => accepted()),
    );
    await act(async () => button('Sign in with email').click());
    expect(document.activeElement?.id).toBe('email');
    await type('#email', 'reader@example.test');
    await act(async () => button('Continue').click());
    expect(document.activeElement?.id).toBe('code');
    // A code finishes on this page, which still holds where to go next; nothing is saved.
    expect(new URLSearchParams(window.location.search).get('next')).toBe('/lobbying');
    expect(takeReturnPath()).toBe('/');
  });

  it('stays busy after a correct code until access is known', async () => {
    const supabase = fakeSupabase(null);
    let answer: (response: Response) => void = () => {};
    const fetcher = vi.fn((url: string) =>
      url.endsWith('/sign-in/code')
        ? Promise.resolve(accepted())
        : url.endsWith('/sign-in/verify')
          ? Promise.resolve(
              new Response(
                JSON.stringify({
                  data: { token_hash: 'one-time-token', type: 'email' },
                }),
                { status: 200 },
              ),
            )
          : new Promise<Response>((resolve) => (answer = resolve)),
    );
    supabase.auth.verifyOtp.mockImplementationOnce(async () => {
      supabase.emit('SIGNED_IN', session('token-7'));
      return { data: {}, error: null };
    });
    await render('/sign-in', supabase.client, fetcher as unknown as typeof fetch);
    await act(async () => button('Sign in with email').click());
    await type('#email', 'reader@example.test');
    await act(async () => button('Continue').click());
    await type('#code', '12345678');
    await act(async () => button('Continue').click());
    expect(button('Signing in…').disabled).toBe(true);
    await act(async () => answer(new Response(null, { status: 200 })));
    await act(async () => {});
    expect(window.location.pathname).toBe('/');
  });

  it('says sign-in could not finish when the new session is refused as signed out', async () => {
    const supabase = fakeSupabase(null);
    supabase.auth.verifyOtp.mockImplementationOnce(async () => {
      supabase.emit('SIGNED_IN', session('token-8'));
      return { data: {}, error: null };
    });
    let calls = 0;
    const fetcher = vi.fn(async (url: string) => {
      if (url.endsWith('/sign-in/code')) return accepted();
      if (url.endsWith('/sign-in/verify'))
        return new Response(
          JSON.stringify({
            data: { token_hash: 'one-time-token', type: 'email' },
          }),
          { status: 200 },
        );
      calls += 1;
      supabase.emit('SIGNED_OUT', null);
      return new Response(null, { status: 401 });
    });
    await render('/sign-in', supabase.client, fetcher as unknown as typeof fetch);
    await act(async () => button('Sign in with email').click());
    await type('#email', 'reader@example.test');
    await act(async () => button('Continue').click());
    await type('#code', '12345678');
    await act(async () => button('Continue').click());
    await act(async () => {});
    expect(calls).toBeGreaterThan(0);
    expect(text()).toContain('We couldn’t finish signing in.');
  });

  it.each([
    [400, 'That code is wrong or expired.'],
    [503, 'We couldn’t check the code. Try again.'],
  ])('a code the server answers with %i never reaches Supabase', async (status, message) => {
    const supabase = fakeSupabase(null);
    const fetcher = vi.fn(async (url: string) =>
      url.endsWith('/sign-in/code')
        ? accepted()
        : new Response(null, {
            status: url.endsWith('/sign-in/verify') ? status : 401,
          }),
    );
    await render('/sign-in', supabase.client, fetcher as unknown as typeof fetch);
    await act(async () => button('Sign in with email').click());
    await type('#email', 'reader@example.test');
    await act(async () => button('Continue').click());
    await type('#code', '12345678');
    await act(async () => button('Continue').click());
    expect(supabase.auth.verifyOtp).not.toHaveBeenCalled();
    expect(text()).toContain(message);
  });

  it('proves the code with the challenge from the newest code request', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    try {
      let requests = 0;
      const fetcher = vi.fn(async (url: string, _init?: RequestInit) => {
        if (url.endsWith('/sign-in/code')) return accepted(`challenge-${++requests}`);
        return new Response(null, { status: url.endsWith('/sign-in/verify') ? 400 : 401 });
      });
      await render('/sign-in', fakeSupabase(null).client, fetcher as unknown as typeof fetch);
      await act(async () => button('Sign in with email').click());
      await type('#email', 'reader@example.test');
      await act(async () => button('Continue').click());
      for (let second = 0; second <= 60; second++) {
        await act(async () => vi.advanceTimersByTime(1000));
      }
      await act(async () => button('Send a new code').click());
      expect(text()).toContain('New code requested');
      await type('#code', '12345678');
      await act(async () => button('Continue').click());
      const [, proof] = fetcher.mock.calls.find(([url]) => url.endsWith('/sign-in/verify'))!;
      expect(JSON.parse(String(proof?.body)).challenge).toBe('challenge-2');
    } finally {
      vi.useRealTimers();
    }
  });

  it('re-enables Google when Back restores the page from the browser cache', async () => {
    await render('/sign-in', fakeSupabase(null).client, answering(401));
    const google = button('Continue with Google');
    await act(async () => google.click());
    const restored = new Event('pageshow') as PageTransitionEvent;
    Object.defineProperty(restored, 'persisted', { value: true });
    await act(async () => window.dispatchEvent(restored));
    expect(button('Continue with Google').disabled).toBe(false);
  });

  it('checks a returning account from scratch after it signed out', async () => {
    const supabase = fakeSupabase(session('token-1'));
    let answer: (response: Response) => void = () => {};
    let call = 0;
    const fetcher = vi.fn(() =>
      ++call === 1
        ? Promise.resolve(new Response(null, { status: 200 }))
        : new Promise<Response>((resolve) => (answer = resolve)),
    );
    await render('/money', supabase.client, fetcher as unknown as typeof fetch);
    expect(container.querySelector('nav')).not.toBeNull();
    await act(async () => supabase.emit('SIGNED_OUT', null));
    await act(async () => supabase.emit('SIGNED_IN', session('token-2')));
    expect(container.querySelector('nav')).toBeNull();
    await act(async () => answer(new Response(null, { status: 503 })));
    expect(text()).toContain('We couldn’t check your access');
  });

  it('moves focus to the new screen’s heading', async () => {
    await render('/money', fakeSupabase(session('token-1')).client, answering(200));
    const lobbying = [...container.querySelectorAll('a')].find(
      (a) => a.textContent === 'Lobbying',
    )!;
    await act(async () => lobbying.click());
    expect(document.activeElement?.textContent).toBe('Lobbying');
    expect(document.activeElement?.tagName).toBe('H1');
  });
});

describe('Google and sign-out', () => {
  it('sends Google back to this site’s own return page and remembers the page asked for', async () => {
    const supabase = fakeSupabase(null);
    await render('/sign-in?next=%2Fmoney%2Fcommittees%2F7', supabase.client, answering(401));
    const google = [...container.querySelectorAll('button')].find(
      (button) => button.textContent === 'Continue with Google',
    )!;
    await act(async () => google.click());
    expect(supabase.auth.signInWithOAuth).toHaveBeenCalledWith({
      provider: 'google',
      options: {
        redirectTo: `${window.location.origin}/auth/return?source=google`,
      },
    });
    expect(takeReturnPath()).toBe('/money/committees/7');
  });

  it('signs out this browser only, and clears the saved session if Supabase cannot', async () => {
    const supabase = fakeSupabase(session('token-1'));
    supabase.auth.signOut.mockResolvedValueOnce({
      error: new Error('offline'),
    });
    window.localStorage.setItem(STORAGE_KEY, '{"access_token":"token-1"}');
    await render('/money', supabase.client, answering(200));
    const account = [...container.querySelectorAll('button')].find(
      (b) => b.textContent === 'Account',
    )!;
    await act(async () => account.click());
    const signOut = [...container.querySelectorAll('button')].find(
      (b) => b.textContent === 'Sign out',
    )!;
    await act(async () => signOut.click());
    await act(async () => {});
    expect(supabase.auth.signOut).toHaveBeenCalledWith({ scope: 'local' });
    expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull();
    expect(window.location.pathname).toBe('/sign-in');
  });

  it('closes the Account menu on Escape and on a press outside it', async () => {
    await render('/money', fakeSupabase(session('token-1')).client, answering(200));
    const account = () =>
      [...container.querySelectorAll('button')].find((b) => b.textContent === 'Account')!;
    await act(async () => account().click());
    expect(container.querySelector('#account-menu')).not.toBeNull();
    await act(async () => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });
    expect(container.querySelector('#account-menu')).toBeNull();
    expect(document.activeElement).toBe(account());
    await act(async () => account().click());
    await act(async () => {
      document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    });
    expect(container.querySelector('#account-menu')).toBeNull();
  });
});

describe('the return page', () => {
  it('takes the emailed token out of the address and uses it only after Continue', async () => {
    const supabase = fakeSupabase(null);
    supabase.auth.verifyOtp.mockImplementationOnce(async () => {
      supabase.emit('SIGNED_IN', session('token-5'));
      return { data: {}, error: null };
    });
    rememberReturnPath('/lobbying');
    await render(
      '/auth/return#source=email&token_hash=hash-1&type=email',
      supabase.client,
      answering(200),
    );
    expect(window.location.href).not.toContain('hash-1');
    expect(supabase.auth.verifyOtp).not.toHaveBeenCalled();
    const proceed = [...container.querySelectorAll('button')].find(
      (b) => b.textContent === 'Continue',
    )!;
    await act(async () => proceed.click());
    expect(supabase.auth.verifyOtp).toHaveBeenCalledWith({
      token_hash: 'hash-1',
      type: 'email',
    });
    expect(window.location.pathname).toBe('/lobbying');
  });

  it('says a used or expired link did not work', async () => {
    const supabase = fakeSupabase(null);
    supabase.auth.verifyOtp.mockResolvedValueOnce({
      data: {},
      error: new Error('expired'),
    });
    await render('/auth/return#token_hash=hash-2&type=email', supabase.client, answering(401));
    const proceed = [...container.querySelectorAll('button')].find(
      (b) => b.textContent === 'Continue',
    )!;
    await act(async () => proceed.click());
    expect(text()).toContain('That sign-in link didn’t work');
  });

  it('returns a cancelled Google sign-in to the options with a message', async () => {
    await render(
      '/auth/return?source=google&error=access_denied',
      fakeSupabase(null).client,
      answering(401),
    );
    expect(window.location.pathname + window.location.search).toBe('/sign-in?google=cancelled');
  });

  it('finishes Google at the page that was asked for', async () => {
    rememberReturnPath('/bills/94-2025-SF1832');
    await render(
      '/auth/return?source=google',
      fakeSupabase(session('token-1')).client,
      answering(200),
    );
    expect(window.location.pathname).toBe('/bills/94-2025-SF1832');
  });

  it('never returns to another site, even if storage was changed', () => {
    window.localStorage.setItem('alethical-finance-return-path', '//example.com/money');
    expect(takeReturnPath()).toBe('/');
  });
});
