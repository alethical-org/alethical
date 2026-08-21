import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));

function source(relativePath: string) {
  return readFileSync(resolve(here, relativePath), 'utf8');
}

describe('rev 9 sign-in integration guards', () => {
  it('lets only the newest account check change the open session', () => {
    for (const provider of [
      '../../providers/AuthProvider.web.tsx',
      '../../providers/AuthProvider.tsx',
    ]) {
      const providerSource = source(provider);

      expect(providerSource).toContain('const generation = ++validationGeneration.current');
      expect(providerSource).toContain('generation !== validationGeneration.current');
      expect(providerSource).toContain('return authFailure(null)');
      expect(providerSource).toContain('validationGeneration.current += 1');
    }
  });

  // A Track press made while signed out is held by the server and written at
  // sign-in, on a path that does NOT go through useSetTrackedBill. It used to
  // write the row and refresh nothing, so the reader landed back on the bill with
  // the Track button still offering to track it, and the account menu's count one
  // short (#1698). Both read one shared saved list, so one refresh fixes both.
  it('refreshes the watchlist after finishing a held Track press', () => {
    const modalProvider = source('../../providers/SignInModalProvider.tsx');
    const queries = source('../../hooks/useAppQueries.ts');

    expect(modalProvider).toContain('useRefreshTrackedBills(user?.id)');
    expect(modalProvider).toContain('await completePendingTrackActionFromApi(');
    expect(modalProvider).toContain('refreshTrackedBills();');

    // Nothing is watching that list while the write happens — the account menu is
    // shut — so the refresh has to reach an unwatched query, not just active ones.
    expect(queries).toContain("refetchType: 'all'");
    expect(queries).toContain('export function useRefreshTrackedBills');
    // One refresh for every watchlist write, so the two paths cannot drift.
    expect(queries).toContain('onSuccess: refreshTrackedBills');
  });

  it('closes a completed email-link flow without running its saved action twice', () => {
    const modalProvider = source('../../providers/SignInModalProvider.tsx');

    expect(modalProvider).toContain(
      "if (request?.pendingCompletion === 'email-link') return finishSignedInRequest();",
    );
  });

  it('treats a pending action already used in another tab as finished', () => {
    const modalProvider = source('../../providers/SignInModalProvider.tsx');

    expect(modalProvider).toContain('error instanceof ApiError && error.status === 410');
    expect(modalProvider).toContain('finishSignedInRequest();');
  });

  it('retries a one-use email link from the verified temporary session', () => {
    const emailLinkPage = source('../../screens/auth/EmailLinkPage.tsx');

    expect(emailLinkPage).toContain('if (temporarySession.current)');
    expect(emailLinkPage).toContain('continueVerifiedSession(temporarySession.current)');
    // Only a deactivation ends the temporary session; a request failure keeps
    // it so the link-fail screen's Try again can resume without a new token.
    expect(emailLinkPage).toContain("if (failureScreen === 'deactivated')");
  });

  it('requires a password after every old confirmation link before signing in', () => {
    const emailLinkPage = source('../../screens/auth/EmailLinkPage.tsx');

    expect(emailLinkPage).toContain("setScreen('new-password')");
    expect(emailLinkPage).toContain("if (kind === 'confirm')");
    expect(emailLinkPage).toContain(
      "label={kind === 'confirm' ? 'Save password' : 'Change password'}",
    );
    expect(emailLinkPage).toContain('finishTemporarySessionAfterPassword({');
    expect(emailLinkPage).toContain('const currentOrdinary = await ordinaryClientAndAccount()');
  });

  it('ends a verified email-link flow only after a deactivated account result', () => {
    const emailLinkPage = source('../../screens/auth/EmailLinkPage.tsx');

    expect(emailLinkPage).toContain('emailLinkFailureScreen(safeAccount.error.kind)');
    expect(emailLinkPage).toContain("if (screen === 'deactivated')");
    expect(emailLinkPage).toContain('This account has been deactivated');
    // The match-failure screen was removed as verified unreachable (#1533);
    // every remaining check failure gets the shared link-fail floor instead.
    expect(emailLinkPage).not.toContain('match-failed');
    expect(emailLinkPage).toContain("if (screen === 'link-fail')");
    expect(emailLinkPage).toContain('We couldn’t check that link');
  });

  it('keeps an expired-link resend disabled after the provider rate-limits it', () => {
    const emailLinkPage = source('../../screens/auth/EmailLinkPage.tsx');

    expect(emailLinkPage).toContain("setDeadResendStatus('rate-limited')");
    expect(emailLinkPage).toContain('secondsRemaining={deadResendSeconds}');
    expect(emailLinkPage).toContain("deadResendStatus !== 'rate-limited'");
  });

  it('focuses the first invalid email-link field after a submit', () => {
    const emailLinkPage = source('../../screens/auth/EmailLinkPage.tsx');

    expect(emailLinkPage).toContain('const emailRef = useRef<any>(null)');
    expect(emailLinkPage).toContain('const passwordRef = useRef<any>(null)');
    expect(emailLinkPage).toContain('const confirmationRef = useRef<any>(null)');
    expect(emailLinkPage).toMatch(
      /if \(fieldFailure\) \{[\s\S]*?emailRef\.current\?\.focus\?\.\(\);[\s\S]*?return;[\s\S]*?\}/,
    );
    expect(emailLinkPage).toContain(
      '(firstFailure ? passwordRef : confirmationRef).current?.focus?.();',
    );
    expect(emailLinkPage).toContain('inputRef={emailRef}');
    expect(emailLinkPage).toContain('inputRef={passwordRef}');
    expect(emailLinkPage).toContain('inputRef={confirmationRef}');
  });

  it('keeps short email-link messages free of final periods', () => {
    const emailLinkPage = source('../../screens/auth/EmailLinkPage.tsx');

    for (const message of [
      'Something went wrong checking this link',
      'Enter your email address to request another confirmation link',
      'Start the Forgot password flow again and open the newest email',
      'This link has expired or has already been used',
      'If a confirmation email arrives, open the newest one',
      'You’re signed in',
      'To switch accounts later, sign out from the normal account menu',
      'Finishing up — closing this reset session',
      'Confirm this email, then choose the password you’ll use to sign in',
      'Press the button to check this reset link and choose a new password',
    ]) {
      expect(emailLinkPage).toContain(message);
      expect(emailLinkPage).not.toContain(`${message}.`);
    }
  });

  it('reaches Forgot password even when short-lived browser storage is unavailable', () => {
    const emailLinkPage = source('../../screens/auth/EmailLinkPage.tsx');

    expect(emailLinkPage).toContain('function goToForgotPassword()');
    expect(emailLinkPage).toContain("window.location.replace('/#auth_screen=forgot')");
    expect(source('../../providers/SignInModalProvider.tsx')).toContain(
      'requestedSignInState(storedScreen, window.location.hash)',
    );
  });

  it('moves serious email-and-password results off the ordinary form', () => {
    const modalProvider = source('../../providers/SignInModalProvider.tsx');

    expect(modalProvider.match(/dedicatedSignInOutcome\(result\.error\.kind\)/g)).toHaveLength(2);
    expect(modalProvider).toContain("dispatch({ type: 'fail', kind: outcome })");
  });

  it('reopens provider results after a full-page return or stale account read', () => {
    const modalProvider = source('../../providers/SignInModalProvider.tsx');

    expect(modalProvider).toContain('const serious = dedicatedSignInOutcome(kind)');
    expect(modalProvider).toContain("state.status !== 'connecting' && !request");
    expect(modalProvider).toContain("type: 'reopenWithError'");
    expect(modalProvider).toContain('dismissAuthError()');
  });
});
