import { useEffect, useMemo, useState } from 'react';

import { apiGet, apiPath } from '../../api/read';
import { useFinanceSession } from '../../auth/session';
import type { Identity } from './types';

export interface IdentityReads {
  byId: Map<string, Identity>;
  loading: boolean;
  failed: boolean;
  /** Every read for the current ids finished, and none failed. */
  settled: boolean;
  retry: () => void;
}

/** Read the identities needed to explain every linked history event. */
function related(identity: Identity): string[] {
  const ids: string[] = [];
  for (const event of identity.history ?? []) {
    const detail = event.detail ?? {};
    for (const value of [detail.from, detail.into, detail.split_from]) {
      if (typeof value === 'string') ids.push(value);
      else if (Array.isArray(value))
        ids.push(...value.filter((id): id is string => typeof id === 'string'));
    }
  }
  for (const confirmation of identity.confirmations ?? []) ids.push(confirmation.identity_id);
  for (const part of identity.split_into ?? []) ids.push(part.id);
  if (identity.redirect_to) ids.push(identity.redirect_to);
  return ids;
}

// Fail visibly rather than silently truncate an unexpectedly large history graph.
const MAX_HISTORY_IDENTITIES = 1000;

/**
 * Reads the identities that hold records of 1 spelling, then the identities their
 * histories name. Answers for earlier ids stay while a later set loads; a failed
 * read is retried as a whole.
 */
export function useIdentities(ids: ReadonlyArray<string>, version: number): IdentityReads {
  const { apiBaseUrl, accessToken } = useFinanceSession();
  const wanted = useMemo(() => [...new Set(ids)].sort(), [ids.join('|')]);
  const scope = `${apiBaseUrl}|${accessToken}|${wanted.join('|')}`;
  const [held, setHeld] = useState<{ scope: string; byId: Map<string, Identity> }>({
    scope: '',
    byId: new Map(),
  });
  const byId = useMemo(
    () => (held.scope === scope ? held.byId : new Map<string, Identity>()),
    [held, scope],
  );
  const [state, setState] = useState<{ key: string; failed: boolean; done: boolean }>({
    key: '',
    failed: false,
    done: false,
  });
  const [attempt, setAttempt] = useState(0);
  const key = `${scope}|${version}|${attempt}`;

  useEffect(() => {
    if (wanted.length === 0) {
      setState({ key, failed: false, done: true });
      return;
    }
    const controller = new AbortController();
    let live = true;
    setState({ key, failed: false, done: false });
    const read = (id: string) =>
      apiGet<Identity>(
        apiBaseUrl,
        apiPath(['finance', 'identities', id]),
        accessToken,
        fetch,
        controller.signal,
      );
    (async () => {
      const found = new Map<string, Identity>();
      let failed = false;
      const visited = new Set<string>();
      let pending = wanted;
      while (pending.length && live && !failed) {
        if (visited.size + pending.length > MAX_HISTORY_IDENTITIES) {
          failed = true;
          break;
        }
        pending.forEach((id) => visited.add(id));
        const answers = await Promise.all(pending.map(read));
        const next = new Set<string>();
        answers.forEach((answer, index) => {
          if (answer.state !== 'ok') {
            failed = true;
            return;
          }
          found.set(pending[index], answer.data);
          related(answer.data).forEach((id) => {
            if (!visited.has(id)) next.add(id);
          });
        });
        pending = [...next];
      }
      if (!live) return;
      if (!failed) setHeld({ scope, byId: found });
      setState({ key, failed, done: true });
    })();
    return () => {
      live = false;
      controller.abort();
    };
  }, [key]);

  const current = state.key === key;
  return {
    byId,
    loading: wanted.length > 0 && (!current || !state.done) && byId.size === 0,
    failed: current && state.failed,
    settled: wanted.length === 0 || (current && state.done && !state.failed),
    retry: () => setAttempt((value) => value + 1),
  };
}
