import { useCallback, useEffect, useState } from 'react';

import { getAdminAccessFromApi, ApiError } from '../data/api';
import { currentAdminAccess, type AdminAccessResult } from '../lib/adminAccess';
import { useAuth } from '../providers/AuthProvider';

/** Permission belongs only to this mounted surface and this exact session. */
export function useAdminAccess() {
  const { isLoading, isSignedIn, user, accessToken } = useAuth();
  const userId = user?.id;
  const [result, setResult] = useState<AdminAccessResult | null>(null);
  const [attempt, setAttempt] = useState(0);
  const retry = useCallback(() => {
    setResult(null);
    setAttempt((value) => value + 1);
  }, []);

  useEffect(() => {
    setResult(null);
    if (isLoading || !isSignedIn || !userId || !accessToken) return;
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
  }, [isLoading, isSignedIn, userId, accessToken, attempt]);

  return {
    state: currentAdminAccess(result, { isLoading, isSignedIn, userId, accessToken }),
    retry,
  };
}
