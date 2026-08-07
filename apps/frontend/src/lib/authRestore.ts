export const AUTH_RESTORE_TIMEOUT_MESSAGE = 'Sign-in could not be restored in time.';
const AUTH_RESTORE_TIMEOUT_MS = 5_000;

interface SessionLookupResult<T> {
  data: { session: T | null };
  error: { message: string } | null;
}

interface RestoredSession<T> {
  session: T | null;
  errorMessage: string | null;
  timedOut: boolean;
}

class AuthRestoreTimeoutError extends Error {}

export async function restoreAuthSession<T>(
  getSession: () => Promise<SessionLookupResult<T>>,
): Promise<RestoredSession<T>> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => reject(new AuthRestoreTimeoutError()), AUTH_RESTORE_TIMEOUT_MS);
  });

  try {
    const result = await Promise.race([getSession(), timedOut]);
    return {
      session: result.error ? null : result.data.session,
      errorMessage: result.error?.message ?? null,
      timedOut: false,
    };
  } catch (error) {
    if (error instanceof AuthRestoreTimeoutError) {
      return {
        session: null,
        errorMessage: AUTH_RESTORE_TIMEOUT_MESSAGE,
        timedOut: true,
      };
    }
    return {
      session: null,
      errorMessage: error instanceof Error ? error.message : 'Sign-in could not be restored.',
      timedOut: false,
    };
  } finally {
    if (timeout !== undefined) {
      clearTimeout(timeout);
    }
  }
}
