import type { Session } from '@supabase/auth-js';

import { getCurrentUserFromApi, isAccountDeactivatedError } from '../../data/api';
import { PublicAuthError, REV9_AUTH_MESSAGES, mapProviderAuthError } from './rev9Auth';

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  signInMethods: { google: boolean; password: boolean } | null;
}

export type AuthOperationResult<T = undefined> =
  | { ok: true; data: T }
  | { ok: false; error: PublicAuthError };

export function authSuccess<T = undefined>(data?: T): AuthOperationResult<T> {
  return { ok: true, data: data as T };
}

export function authFailure(
  error: unknown,
  email?: string,
  options?: { passwordSave?: boolean },
): AuthOperationResult<never> {
  return { ok: false, error: mapProviderAuthError(error, email, options) };
}

/**
 * A Supabase session is only half of sign-in. Alethical must also confirm that
 * the identity safely reaches the intended product account before the UI may
 * treat the person as signed in.
 */
export async function validateAlethicalSession(
  session: Session,
): Promise<AuthOperationResult<AuthUser>> {
  try {
    return authSuccess(await getCurrentUserFromApi(session.access_token));
  } catch (error) {
    if (isAccountDeactivatedError(error)) {
      return {
        ok: false,
        error: {
          kind: 'deactivated',
          message:
            'This account has been deactivated, so we’ve signed you out. Bills, votes and legislators are all still here to read. Contact us at ask@alethical.com if you think this is a mistake.',
        },
      };
    }
    // The backend has no match-failure answer today (rev 15 verified the old
    // match-failed screen unreachable and #1533 removed it), so any refusal
    // that is not a deactivation reads as the one shared request failure.
    return {
      ok: false,
      error: { kind: 'request-failure', message: REV9_AUTH_MESSAGES.requestFailure },
    };
  }
}
