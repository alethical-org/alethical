// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  signInWorkPendingOnLoad,
  PENDING_SIGN_IN_KEY,
  REQUESTED_SCREEN_KEY,
} from '../signInWorkPending';

const storedSession = vi.hoisted(() => ({ present: false }));

vi.mock('../../supabaseConfig', () => ({
  hasStoredAuthSession: () => storedSession.present,
}));

/**
 * The gate that decides whether a page fetches sign-in at all
 * ([#1976](https://github.com/alethical-org/alethical/issues/1976)). A wrong
 * `false` is the dangerous answer: a reader who IS signed in would see the page
 * as a stranger, so every way sign-in work can start without a press has a case
 * here.
 */
describe('signInWorkPendingOnLoad', () => {
  beforeEach(() => {
    storedSession.present = false;
    window.sessionStorage.clear();
    window.history.replaceState(null, '', '/money/committees');
  });

  afterEach(() => {
    window.sessionStorage.clear();
  });

  it('says no on an ordinary page with nobody signed in', () => {
    expect(signInWorkPendingOnLoad()).toBe(false);
  });

  it('says no on a money page carrying its own filters', () => {
    window.history.replaceState(null, '', '/money/committees?year=2026&kind=candidate&page=3');
    expect(signInWorkPendingOnLoad()).toBe(false);
  });

  it('says yes when this browser has a session saved', () => {
    storedSession.present = true;
    expect(signInWorkPendingOnLoad()).toBe(true);
  });

  it('says yes when the address is a completed sign-in coming back', () => {
    window.history.replaceState(null, '', '/bills?code=not-a-real-value');
    expect(signInWorkPendingOnLoad()).toBe(true);
  });

  it('says yes when the address carries a sign-in return in its fragment', () => {
    window.history.replaceState(null, '', '/bills#access_token=not-a-real-value');
    expect(signInWorkPendingOnLoad()).toBe(true);
  });

  it('says yes when the address carries a sign-in failure', () => {
    window.history.replaceState(null, '', '/bills?error=access_denied&error_code=provider_email');
    expect(signInWorkPendingOnLoad()).toBe(true);
  });

  it('says yes when a sign-in was under way before the redirect', () => {
    window.sessionStorage.setItem(
      PENDING_SIGN_IN_KEY,
      JSON.stringify({ intent: 'track', billId: 'bill-1', returnTo: '/bills/hf-1' }),
    );
    expect(signInWorkPendingOnLoad()).toBe(true);
  });

  it('says yes when a link asked for the recover screen by name', () => {
    window.history.replaceState(null, '', '/#auth_screen=forgot');
    expect(signInWorkPendingOnLoad()).toBe(true);
  });

  it('says yes when a stashed request names the create screen', () => {
    window.sessionStorage.setItem(REQUESTED_SCREEN_KEY, 'create');
    expect(signInWorkPendingOnLoad()).toBe(true);
  });

  it('leaves the stash and the address exactly as it found them', () => {
    // The provider's own reader clears the stash and rewrites the address.
    // Answering the question by destroying it would lose the requested screen.
    window.sessionStorage.setItem(REQUESTED_SCREEN_KEY, 'create');
    window.history.replaceState(null, '', '/#auth_screen=forgot');
    signInWorkPendingOnLoad();
    expect(window.sessionStorage.getItem(REQUESTED_SCREEN_KEY)).toBe('create');
    expect(window.location.hash).toBe('#auth_screen=forgot');
  });

  it('says no rather than throwing when the browser refuses storage', () => {
    const getItem = vi.spyOn(window.sessionStorage, 'getItem').mockImplementation(() => {
      throw new Error('storage is blocked');
    });
    expect(signInWorkPendingOnLoad()).toBe(false);
    getItem.mockRestore();
  });
});
