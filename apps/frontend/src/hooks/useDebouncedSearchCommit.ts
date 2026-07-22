import { useEffect, useRef } from 'react';

// Live search-as-you-type (#571). The search box keeps a local draft
// (`queryInput`); the URL query param (`query`) is what actually drives the
// results. This hook pushes the trimmed draft into the URL after the user
// pauses typing, so results update on their own — no Enter key or Search-button
// tap needed — while adding/removing characters mid-word re-runs the search too.
//
// - Debounced (default 250ms) so a burst of keystrokes commits once, at rest.
// - No-ops when the draft already equals the applied query, so an external
//   change (Back/Forward, a shared link, Clear) that resyncs the draft can't
//   loop back into a redundant commit.
// - `commit` is read through a ref, so passing a fresh closure each render never
//   re-arms the timer — only an actual draft change does.
export function useDebouncedSearchCommit(
  draft: string,
  applied: string,
  commit: (value: string) => void,
  delayMs = 250,
): void {
  const commitRef = useRef(commit);
  commitRef.current = commit;

  useEffect(() => {
    const trimmed = draft.trim();
    if (trimmed === applied) return;
    const timer = setTimeout(() => commitRef.current(trimmed), delayMs);
    return () => clearTimeout(timer);
  }, [draft, applied, delayMs]);
}
