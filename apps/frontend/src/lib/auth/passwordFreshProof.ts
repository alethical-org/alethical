import type { AuthOperationResult } from './operations';
import { authFailure, authSuccess } from './operations';
import { isUncertainPasswordSave, uncertainPasswordSaveMessage } from './rev9Auth';

interface PasswordAuthClient {
  updateUser: (attributes: {
    password: string;
    nonce: string | undefined;
  }) => Promise<{ error: unknown }>;
  reauthenticate: () => Promise<{ error: unknown }>;
}

/** Save a password, sending and accepting Supabase's fresh-proof code when required. */
export async function savePasswordWithFreshProof(
  auth: PasswordAuthClient,
  password: string,
  freshProofCode: string | undefined,
  email: string | undefined,
): Promise<AuthOperationResult> {
  let updateError: unknown;
  try {
    ({ error: updateError } = await auth.updateUser({
      password,
      nonce: freshProofCode || undefined,
    }));
  } catch (thrown) {
    updateError = thrown;
  }

  if (!updateError) return authSuccess();
  if (
    updateError &&
    typeof updateError === 'object' &&
    (updateError as { code?: unknown }).code === 'same_password'
  ) {
    return authSuccess();
  }

  // A lost reply may have saved the password server-side; the form must
  // stop rather than offer the save again (rev 17 REQUEST FAILURE carve-out).
  if (isUncertainPasswordSave(updateError)) {
    return {
      ok: false,
      error: {
        kind: 'uncertain-password-save',
        message: uncertainPasswordSaveMessage(email ?? 'this account'),
      },
    };
  }

  const failure = authFailure(updateError, email, { passwordSave: true });
  if (!failure.ok && failure.error.kind === 'fresh-proof' && !freshProofCode) {
    let reauthenticateError: unknown;
    try {
      ({ error: reauthenticateError } = await auth.reauthenticate());
    } catch (thrown) {
      reauthenticateError = thrown;
    }
    return reauthenticateError ? authFailure(reauthenticateError, email) : failure;
  }
  return failure;
}
