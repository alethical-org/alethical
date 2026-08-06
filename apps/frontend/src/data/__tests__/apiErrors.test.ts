/**
 * Telling one refusal apart from another (#1092).
 *
 * A deactivated account gets signed out; every other 403 must not. Before this,
 * `ApiError` kept the response body only as an unparsed string, so nothing could
 * distinguish them and nothing tried -- a locked-out reader stayed "signed in"
 * with their name on screen while every feature of theirs silently failed.
 *
 * The parsing is what these cover. The signing-out is wired in `AuthProvider`.
 */
import { describe, expect, it } from 'vitest';

import { ApiError, apiErrorFromBody, isAccountDeactivatedError, isNotFoundError } from '../api';

/** The exact body the backend sends, from `alethical/api/problems.py`. */
const DEACTIVATED_BODY = JSON.stringify({
  type: 'https://api.alethical.com/problems/account-deactivated',
  title: 'Forbidden',
  status: 403,
  detail: 'This account has been deactivated.',
  instance: '/api/v1/me',
});

describe('isAccountDeactivatedError', () => {
  it('recognises the real refusal', () => {
    const error = apiErrorFromBody(403, DEACTIVATED_BODY);
    expect(error.problem).toBe('account-deactivated');
    expect(isAccountDeactivatedError(error)).toBe(true);
  });

  it('does not fire on a different 403', () => {
    const forbidden = apiErrorFromBody(
      403,
      JSON.stringify({ type: 'https://api.alethical.com/problems/forbidden', status: 403 }),
    );
    expect(isAccountDeactivatedError(forbidden)).toBe(false);
  });

  it('does not fire on a 403 whose body is not a problem document', () => {
    // A proxy or gateway can return an HTML 403. Signing the reader out because
    // Cloudflare said no would be worse than the problem being solved.
    expect(isAccountDeactivatedError(apiErrorFromBody(403, '<html>Forbidden</html>'))).toBe(false);
    expect(apiErrorFromBody(403, '<html>Forbidden</html>').problem).toBeNull();
    expect(isAccountDeactivatedError(apiErrorFromBody(403, ''))).toBe(false);
    expect(isAccountDeactivatedError(apiErrorFromBody(403, 'null'))).toBe(false);
    expect(isAccountDeactivatedError(apiErrorFromBody(403, '"account-deactivated"'))).toBe(false);
    expect(isAccountDeactivatedError(apiErrorFromBody(403, '{"type": 42}'))).toBe(false);
    // Asserted on the slug itself, not just the boolean: a coercing parser
    // (String(type)) still answers false here while quietly inventing "42".
    expect(apiErrorFromBody(403, '{"type": 42}').problem).toBeNull();
    expect(apiErrorFromBody(403, '{"title": "Forbidden"}').problem).toBeNull();
  });

  it('does not fire on the signed-out 401, which is the one this must not be confused with', () => {
    // Signed out is fixed by signing in; deactivated never will be. Treating the
    // 401 as deactivation would tell a reader with an expired token that their
    // account was locked.
    const unauthorized = apiErrorFromBody(
      401,
      JSON.stringify({ type: 'https://api.alethical.com/problems/unauthorized', status: 401 }),
    );
    expect(isAccountDeactivatedError(unauthorized)).toBe(false);
  });

  it('needs the status as well as the slug', () => {
    expect(isAccountDeactivatedError(apiErrorFromBody(500, DEACTIVATED_BODY))).toBe(false);
  });

  it('is safe on things that are not ApiErrors at all', () => {
    for (const value of [null, undefined, new Error('boom'), 'account-deactivated', 403, {}]) {
      expect(isAccountDeactivatedError(value)).toBe(false);
    }
  });
});

describe('ApiError', () => {
  it('carries no problem slug unless one is given', () => {
    expect(apiErrorFromBody(404, 'nope').problem).toBeNull();
    expect(new ApiError(404, 'nope').problem).toBeNull();
  });

  it('leaves the existing 404 helper alone', () => {
    expect(isNotFoundError(new ApiError(404, 'nope'))).toBe(true);
    expect(isNotFoundError(apiErrorFromBody(403, DEACTIVATED_BODY))).toBe(false);
  });
});
