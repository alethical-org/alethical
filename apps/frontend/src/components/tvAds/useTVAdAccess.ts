import { useCallback, useEffect, useRef, useState } from 'react';
import { apiRequest, ApiError } from '../../data/api';
import { useAuth } from '../../providers/AuthProvider';
import { denyTV, onTVDenied } from './api';

/** Session capability alone is not sufficient for private TV entrances. */
export function useTVAdAccess(scope = '') {
  const { user, accessToken, isSignedIn, isLoading } = useAuth();
  const identity = user?.id;
  const revocation = useRef(0);
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<{
    identity: string;
    scope: string;
    token: string;
    state: 'allowed' | 'restricted' | 'error';
  } | null>(null);
  const retry = useCallback(() => setAttempt((value) => value + 1), []);
  useEffect(
    () =>
      onTVDenied((token) => {
        if (accessToken === token && identity) {
          revocation.current += 1;
          setResult({ identity, scope, token, state: 'restricted' });
        }
      }),
    [accessToken, identity, scope],
  );
  useEffect(() => {
    if (!identity || !accessToken || !isSignedIn || isLoading) return;
    const controller = new AbortController();
    const startedAt = revocation.current;
    setResult(null);
    void apiRequest<{ allowed?: boolean; is_admin?: boolean }>(
      '/ads/access',
      { method: 'GET', cache: 'no-store', signal: controller.signal },
      accessToken,
    ).then(
      (answer) => {
        if (controller.signal.aborted || startedAt !== revocation.current) return;
        const allowed = answer.allowed === true || answer.is_admin === true;
        setResult({
          identity,
          scope,
          token: accessToken,
          state: allowed ? 'allowed' : 'restricted',
        });
        if (!allowed) denyTV(accessToken);
      },
      (error: unknown) => {
        if (controller.signal.aborted || startedAt !== revocation.current) return;
        const denied = error instanceof ApiError && [401, 403, 404].includes(error.status);
        setResult({ identity, scope, token: accessToken, state: denied ? 'restricted' : 'error' });
        if (denied) denyTV(accessToken);
      },
    );
    return () => controller.abort();
  }, [identity, accessToken, isSignedIn, isLoading, attempt, scope]);
  useEffect(() => {
    const focus = () => retry();
    window.addEventListener('focus', focus);
    return () => window.removeEventListener('focus', focus);
  }, [retry]);
  return {
    state: isLoading
      ? 'loading'
      : !isSignedIn || !accessToken || !identity
        ? 'signed-out'
        : result?.identity === identity && result.token === accessToken && result.scope === scope
          ? result.state
          : 'loading',
    retry,
  };
}
