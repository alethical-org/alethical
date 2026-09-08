import { useCallback, useEffect, useState } from 'react';

import { getAdminAccessFromApi, ApiError } from '../data/api';
import { currentAdminAccess, type AdminAccessResult } from '../lib/adminAccess';
import { useAuth } from '../providers/AuthProvider';

/** Use the server's session capability immediately; older servers can fall back. */
export function useAdminAccess() {
  const { isLoading, isSignedIn, user, accessToken } = useAuth();
  const userId = user?.id;
  const isAdmin = user?.isAdmin;
  const [result, setResult] = useState<AdminAccessResult | null>(null);
  const [attempt, setAttempt] = useState(0);
  const retry = useCallback(() => {
    setResult(null);
    setAttempt((value) => value + 1);
  }, []);

  useEffect(() => {
    setResult(null);
    if (isLoading || !isSignedIn || !userId || !accessToken || typeof isAdmin === 'boolean') return;
    const controller = new AbortController();
    void getAdminAccessFromApi(accessToken, controller.signal).then(
      (allowed) => {
        if (!controller.signal.aborted)
          setResult({ userId, accessToken, state: allowed ? 'allowed' : 'restricted' });
      },
      (error: unknown) => {
        if (!controller.signal.aborted)
          setResult({
            userId,
            accessToken,
            state: error instanceof ApiError && error.status === 403 ? 'restricted' : 'error',
          });
      },
    );
    return () => controller.abort();
  }, [isLoading, isSignedIn, userId, accessToken, isAdmin, attempt]);

  return {
    state: currentAdminAccess(result, { isLoading, isSignedIn, userId, accessToken, isAdmin }),
    retry,
  };
}
