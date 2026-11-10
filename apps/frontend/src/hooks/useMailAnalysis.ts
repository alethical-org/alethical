import { useEffect, useRef, useState } from 'react';
import type { MailAnalysis, SavedMailSubmission } from '../data/mailAnalysis';
import { getMailAnalysis, retryMailAnalysis, MailUploadError } from '../data/mailUpload';

type State = {
  identity: object | null;
  result: MailAnalysis | null;
  error: 'expired' | 'unavailable' | null;
  retrying: boolean;
  refreshing: boolean;
};
const empty: State = {
  identity: null,
  result: null,
  error: null,
  retrying: false,
  refreshing: false,
};
const working = (result: MailAnalysis) =>
  result.status === 'pending' || result.status === 'processing';

/** Poll only this saved submission. Cancellation also fences responses from old sessions. */
export function useMailAnalysis(submission: Pick<SavedMailSubmission, 'id' | 'token'> | null) {
  const id = submission?.id;
  const token = submission?.token;
  const identity = useRef({ id, token, key: {} });
  if (identity.current.id !== id || identity.current.token !== token)
    identity.current = { id, token, key: {} };
  const key = identity.current.key;
  const [state, setState] = useState<State>(empty);
  const actions = useRef({ retry: () => {}, refresh: () => {} });

  useEffect(() => {
    if (!id || !token) {
      setState(empty);
      actions.current = { retry: () => {}, refresh: () => {} };
      return;
    }
    let active = true;
    let busy = false;
    let expired = false;
    let retryCycle = false;
    let latest: MailAnalysis | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const controller = new AbortController();
    const current = () => active && identity.current.key === key;
    const update = (change: Partial<State>) => {
      if (current()) setState((old) => ({ ...old, identity: key, ...change }));
    };
    setState({ ...empty, identity: key });

    const load = async (retry = false, refresh = false) => {
      if (!current() || busy || expired || (retry && !latest?.can_retry)) return;
      busy = true;
      if (retry) retryCycle = true;
      clearTimeout(timer);
      update({ ...(refresh ? {} : { error: null }), retrying: retryCycle, refreshing: refresh });
      try {
        const next = await (retry ? retryMailAnalysis : getMailAnalysis)(token, id, {
          signal: controller.signal,
          timeoutMs: 20_000,
        });
        if (!current()) return;
        // Queue responses can omit the preceding read; keep useful evidence while
        // retrying this same submission. Full progressive snapshots are authoritative
        // even when an array is empty: old evidence must not survive a changed read.
        latest =
          latest && working(next) && next.snapshot_version !== 1
            ? {
                ...latest,
                ...next,
                sides: next.sides?.length ? next.sides : latest.sides,
                payers: next.payers?.length ? next.payers : latest.payers,
              }
            : next;
        update({ result: latest, error: null });
        if (working(next)) timer = setTimeout(() => void load(), 2000);
        else retryCycle = false;
      } catch (error) {
        retryCycle = false;
        expired = error instanceof MailUploadError && error.status === 401;
        if (expired && latest) latest = { ...latest, can_retry: false };
        update({
          error: expired ? 'expired' : 'unavailable',
          result: latest,
        });
      } finally {
        busy = false;
        update({ retrying: retryCycle, refreshing: false });
      }
    };
    actions.current = {
      retry: () => {
        void load(true);
      },
      refresh: () => {
        void load(false, true);
      },
    };
    void load();
    return () => {
      active = false;
      clearTimeout(timer);
      controller.abort();
    };
  }, [id, token, key]);

  const visible = state.identity === key && submission ? state : empty;
  return {
    result: visible.result,
    error: visible.error,
    retrying: visible.retrying,
    refreshing: visible.refreshing,
    retry: () => actions.current.retry(),
    refresh: () => actions.current.refresh(),
  };
}
