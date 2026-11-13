import { useCallback, useEffect, useRef, useState } from 'react';

import { requestTimeoutMs } from '../../api/client';
import { useFinanceSession } from '../../auth/session';

export interface ElectionAttachment {
  state: 'idle' | 'loading' | 'ready' | 'failed';
  objectUrl: string | null;
  contentType: string | null;
  accessDenied: boolean;
  changed: boolean;
  retry: () => void;
}

/** Only immutable retained-source routes produced by elections/data are accepted.
 * Do not send a Finance token to an evidence URL copied from a source document. */
function retainedPath(path: string): boolean {
  const external = path.match(
    /^finance\/elections\/mn-\d{4}-\d{2}-\d{2}-(?:general|primary|special)\/external-finance\/sources\/[a-f0-9]{64}\?([^#]+)$/,
  );
  if (external) {
    const entries = [...new URLSearchParams(external[1]).entries()];
    return (
      entries.length === 1 &&
      entries[0][0] === 'generation_id' &&
      /^[a-f0-9]{64}$/.test(entries[0][1])
    );
  }
  const analytics = path.match(
    /^finance\/elections\/mn-\d{4}-\d{2}-\d{2}-(?:general|primary|special)\/analytics\/sources\/(?:contributions|expenditures|independent_expenditures)\?([^#]+)$/,
  );
  if (analytics) {
    const query = new URLSearchParams(analytics[1]);
    return (
      [...query.entries()].length === 2 &&
      /^[a-f0-9]{64}$/.test(query.get('snapshot_id') ?? '') &&
      /^[a-f0-9]{16}$/.test(query.get('version') ?? '')
    );
  }
  const spending = path.match(
    /^finance\/elections\/mn-\d{4}-\d{2}-\d{2}-(?:general|primary|special)\/outside-spending\/source\?([^#]+)$/,
  );
  if (spending) {
    const query = new URLSearchParams(spending[1]);
    return (
      [...query.entries()].length === (query.has('source_hash') ? 4 : 3) &&
      (!query.has('source_hash') || /^[a-f0-9]{64}$/.test(query.get('source_hash') ?? '')) &&
      /^[a-f0-9]{64}$/.test(query.get('election_snapshot_id') ?? '') &&
      /^[a-f0-9]{16}$/.test(query.get('version') ?? '') &&
      /^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(query.get('release_id') ?? '')
    );
  }
  const match = path.match(
    /^finance\/elections\/mn-\d{4}-\d{2}-\d{2}-(?:general|primary|special)\/(finance\/)?sources\/[a-f0-9]{64}(\/raw)?\?([^#]+)$/,
  );
  if (!match || (match[2] && !match[1])) return false;
  const query = new URLSearchParams(match[3]);
  const entries = [...query.entries()];
  const expected = match[1] ? 'collection_id' : 'snapshot_id';
  return entries.length === 1 && entries[0][0] === expected && /^[a-f0-9]{64}$/.test(entries[0][1]);
}

/** Private attachments follow the Media blob loader's lifecycle, with no shared
 * cache. Passing null disables the read. Consumers may open/download objectUrl
 * only while this hook still returns it; it is revoked when the source or
 * signed-in account changes, access is lost, or the consumer unmounts. */
export function useElectionAttachment(path: string | null): ElectionAttachment {
  const {
    apiBaseUrl,
    accessToken,
    email,
    status,
    revoked,
    retry: checkAccess,
  } = useFinanceSession();
  const accessCheck = useRef(checkAccess);
  accessCheck.current = checkAccess;
  const [attempt, setAttempt] = useState(0);
  const retry = useCallback(() => setAttempt((value) => value + 1), []);
  const allowed = status === 'granted' && !revoked && !!accessToken;
  const valid = path !== null && retainedPath(path);
  const key = JSON.stringify([apiBaseUrl, accessToken, email, allowed, path, attempt]);
  const [answer, setAnswer] = useState<{
    key: string;
    objectUrl: string | null;
    contentType: string | null;
    accessDenied: boolean;
    changed: boolean;
  } | null>(null);

  useEffect(() => {
    if (!allowed || !valid || !path || !accessToken) return;
    const controller = new AbortController();
    let live = true;
    let objectUrl: string | null = null;
    let accessDenied = false;
    let changed = false;
    const timer = window.setTimeout(() => controller.abort(), requestTimeoutMs(path));
    void fetch(`${apiBaseUrl.replace(/\/+$/, '')}/api/v1/${path}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      cache: 'no-store',
      redirect: 'error',
      signal: controller.signal,
    })
      .then(async (response) => {
        accessDenied = response.status === 401 || response.status === 403;
        if (response.status === 409) {
          const problem = await response.json().catch(() => null);
          changed = problem?.type === 'https://api.alethical.com/problems/records-changed';
        }
        const contentType = response.headers.get('content-type')?.split(';')[0].trim();
        if (
          !response.ok ||
          response.redirected ||
          !['application/octet-stream', 'application/pdf'].includes(contentType ?? '')
        )
          throw new Error('Attachment unavailable');
        const blob = await response.blob();
        if (!live) return;
        if (controller.signal.aborted) throw new Error('Attachment timed out');
        objectUrl = URL.createObjectURL(blob);
        setAnswer({
          key,
          objectUrl,
          contentType: blob.type,
          accessDenied: false,
          changed: false,
        });
      })
      .catch(() => {
        if (live) {
          setAnswer({ key, objectUrl: null, contentType: null, accessDenied, changed });
          if (accessDenied) accessCheck.current?.();
        }
      })
      .finally(() => window.clearTimeout(timer));
    return () => {
      live = false;
      window.clearTimeout(timer);
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [key, apiBaseUrl, accessToken, allowed, valid, path]);

  const current = answer?.key === key ? answer : null;
  const state =
    !allowed || path === null
      ? 'idle'
      : !valid
        ? 'failed'
        : current
          ? current.objectUrl
            ? 'ready'
            : 'failed'
          : 'loading';
  return {
    state,
    objectUrl: state === 'ready' ? (current?.objectUrl ?? null) : null,
    contentType: state === 'ready' ? (current?.contentType ?? null) : null,
    accessDenied: current?.accessDenied ?? false,
    changed: current?.changed ?? false,
    retry,
  };
}
