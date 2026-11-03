import { useEffect, useMemo, useState } from 'react';

import { apiGet, apiPath } from '../../api/read';
import { useFinanceSession } from '../../auth/session';
import type { Identity } from './types';

export interface IdentityReads {
  byId: Map<string, Identity>;
  loading: boolean;
  failed: boolean;
  retry: () => void;
}

/** Ids an identity's own history names: the identities merged into it, the identity
 * it was split from and the parts that split made. Read once, 1 level deep, so the
 * history can name them. */
function related(identity: Identity): string[] {
  const ids: string[] = [];
  for (const event of identity.history ?? []) {
    const detail = event.detail ?? {};
    if (event.action === 'merged' && typeof detail.from === 'string') ids.push(detail.from);
    if (event.action === 'created' && typeof detail.split_from === 'string')
      ids.push(detail.split_from);
  }
  for (const part of identity.split_into ?? []) ids.push(part.id);
  return ids;
}

/**
 * Reads the identities that hold records of 1 spelling, then the identities their
 * histories name. Answers for earlier ids stay while a later set loads; a failed
 * read is retried as a whole.
 */
export function useIdentities(ids: ReadonlyArray<string>, version: number): IdentityReads {
  const { apiBaseUrl, accessToken } = useFinanceSession();
  const wanted = useMemo(() => [...new Set(ids)].sort(), [ids.join('|')]);
  const [held, setHeld] = useState<Map<string, Identity>>(new Map());
  const [state, setState] = useState<{ key: string; failed: boolean; done: boolean }>({
    key: '',
    failed: false,
    done: false,
  });
  const [attempt, setAttempt] = useState(0);
  const key = `${apiBaseUrl}|${accessToken}|${wanted.join('|')}|${version}|${attempt}`;

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
      const first = await Promise.all(wanted.map(read));
      first.forEach((answer, index) => {
        if (answer.state === 'ok') found.set(wanted[index], answer.data);
        else if (answer.state === 'failed') failed = true;
      });
      const more = [...new Set([...found.values()].flatMap(related))].filter(
        (id) => !found.has(id),
      );
      const second = await Promise.all(more.map(read));
      second.forEach((answer, index) => {
        if (answer.state === 'ok') found.set(more[index], answer.data);
      });
      if (!live) return;
      setHeld(found);
      setState({ key, failed, done: true });
    })();
    return () => {
      live = false;
      controller.abort();
    };
  }, [key]);

  const current = state.key === key;
  return {
    byId: held,
    loading: wanted.length > 0 && (!current || !state.done) && held.size === 0,
    failed: current && state.failed,
    retry: () => setAttempt((value) => value + 1),
  };
}
