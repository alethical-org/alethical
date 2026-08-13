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
    expect(emailLinkPage).toContain("safeAccount.error.kind !== 'request-failure'");
  });

  it('ends a verified email-link flow after a deactivated or unsafe account result', () => {
    const emailLinkPage = source('../../screens/auth/EmailLinkPage.tsx');

    expect(emailLinkPage).toContain('setScreen(emailLinkFailureScreen(safeAccount.error.kind))');
    expect(emailLinkPage).toContain("if (screen === 'deactivated' || screen === 'match-failed')");
    expect(emailLinkPage).toContain('This account has been deactivated');
    expect(emailLinkPage).toContain('We couldn’t match this sign-in');
  });

  it('keeps an expired-link resend disabled after the provider rate-limits it', () => {
    const emailLinkPage = source('../../screens/auth/EmailLinkPage.tsx');

    expect(emailLinkPage).toContain("setDeadResendStatus('rate-limited')");
    expect(emailLinkPage).toContain('secondsRemaining={deadResendSeconds}');
    expect(emailLinkPage).toContain("deadResendStatus !== 'rate-limited'");
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
