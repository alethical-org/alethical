import { useDebouncedSearchCommit } from '@alethical/shared/hooks/useDebouncedSearchCommit';
import { useRef, useState } from 'react';

import { useHistoryNavigationKey } from '../router';

const trim = (value: string) => value.trim();

/** Keep the field's text separate from the query that drives the results. */
export function useLiveSearch(
  appliedQuery: string,
  navigationKey: string,
  commit: (query: string) => void,
  normalize = trim,
): [draft: string, setDraft: (draft: string) => void, apply: (draft?: string) => void] {
  const route = navigationKey.split('?')[0];
  const historyKey = useHistoryNavigationKey();
  const [source, setSource] = useState({ appliedQuery, route, historyKey });
  const [draft, setDraft] = useState(appliedQuery);
  const lastCommit = useRef<{ source: typeof source; query: string } | null>(null);

  // Filter changes within the page keep the draft. Back and Forward restore it
  // even if the applied query (or the entire address) is the same.
  const wentBackOrForward = source.historyKey !== historyKey;
  const changedRoute = source.route !== route;
  if (wentBackOrForward || changedRoute || source.appliedQuery !== appliedQuery) {
    setSource({ appliedQuery, route, historyKey });
    // Some searches put their query in the path itself.
    const ownCommit =
      lastCommit.current?.source === source && lastCommit.current.query === appliedQuery;
    if (wentBackOrForward || (changedRoute && !ownCommit) || normalize(draft) !== appliedQuery) {
      setDraft(appliedQuery);
    }
  }

  function commitOnce(query: string) {
    if (query === appliedQuery) return;
    if (lastCommit.current?.source === source && lastCommit.current.query === query) return;
    lastCommit.current = { source, query };
    commit(query);
  }

  // An untouched linked query may contain meaningful spaces (a printed name).
  const edited = draft !== appliedQuery;
  useDebouncedSearchCommit(edited ? normalize(draft) : '', edited ? appliedQuery : '', commitOnce);

  function apply(value = draft) {
    setDraft(value);
    if (value !== appliedQuery) commitOnce(normalize(value));
  }

  return [draft, setDraft, apply];
}
