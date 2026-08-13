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
});
