import {
  consumeWebHistoryReplaceMark,
  currentWebHistoryEntry,
  pushWebHistory,
  replaceWebHistoryPath,
  type AppHistoryEntry,
} from './webHistory';

type Options = {
  getNavigationPath(): string;
  resetNavigationToPath(path: string): void;
  shouldGuardCurrentRoute(): boolean;
};

type Position = { path: string; entry: AppHistoryEntry | null };
type KnownPosition = Position & { entry: AppHistoryEntry };
type Write = { path: string; replace: boolean };
type Traversal = {
  from: KnownPosition;
  to: KnownPosition;
  phase: 'restoring' | 'waiting' | 'traversing';
  cancelled?: boolean;
  write?: Write;
};

function position(): Position {
  return {
    path: `${window.location.pathname}${window.location.search}` || '/',
    entry: currentWebHistoryEntry(),
  };
}

function sameEntry(a: Position, b: Position) {
  return Boolean(
    a.entry &&
    b.entry &&
    a.entry.sessionId === b.entry.sessionId &&
    a.entry.entryId === b.entry.entryId,
  );
}

/**
 * Let the router's existing removal guard decide Back/Forward while retaining
 * both browser entries. Call after initializeWebHistory, from the root's popstate
 * and state-change handlers. Keep editing/Escape must cancel the pending intent;
 * Discard replays the original router action in the usual way.
 *
 * No draft or account data is stored here. Cross-document departures still use
 * beforeunload; unmarked entries keep the existing reset behavior.
 */
export function createGuardedWebHistory(options: Options) {
  let current = position();
  let pending: Traversal | undefined;
  let disposed = false;

  function write({ path, replace }: Write) {
    if (path !== current.path) {
      if (replace) replaceWebHistoryPath(path);
      else pushWebHistory(path);
    }
    current = position();
  }

  function complete(traversal: Traversal) {
    traversal.phase = 'traversing';
    window.history.go(traversal.to.entry.depth - traversal.from.entry.depth);
  }

  return {
    onPopState() {
      if (disposed) return;
      const arrived = position();
      if (pending?.phase === 'restoring') {
        if (!sameEntry(arrived, pending.from)) {
          // Coalesce another toolbar traversal while the restoration is pending.
          if (arrived.entry?.sessionId === pending.from.entry.sessionId)
            pending.to = arrived as KnownPosition;
          return;
        }
        current = arrived;
        const traversal = pending;
        if (traversal.write || traversal.cancelled) {
          pending = undefined;
          if (traversal.write) write(traversal.write);
        } else {
          traversal.phase = 'waiting';
          // An account/navigation change may have superseded the attempted Back.
          const path = options.getNavigationPath();
          if (path !== traversal.from.path) {
            pending = undefined;
            write({ path, replace: consumeWebHistoryReplaceMark() });
          } else {
            options.resetNavigationToPath(traversal.to.path);
          }
        }
        return;
      }
      if (pending?.phase === 'traversing' && sameEntry(arrived, pending.to)) {
        const nextWrite = pending.write;
        pending = undefined;
        current = arrived;
        if (nextWrite) write(nextWrite);
        return;
      }

      if (
        options.shouldGuardCurrentRoute() &&
        current.entry &&
        arrived.entry &&
        current.entry.sessionId === arrived.entry.sessionId &&
        current.entry.depth !== arrived.entry.depth
      ) {
        pending = {
          from: current as KnownPosition,
          to: arrived as KnownPosition,
          phase: 'restoring',
        };
        window.history.go(current.entry.depth - arrived.entry.depth);
      } else {
        pending = undefined;
        current = arrived;
        options.resetNavigationToPath(arrived.path);
      }
    },
    onStateChange(nextPath: string) {
      if (disposed) return;
      // Different history entries can share a URL. An accepted reset still
      // needs to finish that traversal even when the printed address is equal.
      if (pending?.phase === 'waiting' && nextPath === pending.to.path) {
        complete(pending);
        return;
      }
      if (nextPath === current.path) return;
      const nextWrite = { path: nextPath, replace: consumeWebHistoryReplaceMark() };
      if (pending?.phase === 'restoring' || pending?.phase === 'traversing') {
        // Do not push while a traversal is in flight: it would erase the entry
        // being restored and the browser's remaining Forward history.
        if (pending.phase === 'traversing' && nextPath === pending.to.path) return;
        pending.write = nextWrite;
        return;
      }
      if (pending?.phase === 'waiting') {
        if (nextWrite.replace) {
          pending.write = nextWrite;
          complete(pending);
          return;
        }
        pending = undefined;
      }
      write(nextWrite);
    },
    cancelPendingNavigation() {
      if (pending?.phase === 'restoring') pending.cancelled = true;
      else if (pending?.phase === 'waiting') pending = undefined;
    },
    dispose() {
      disposed = true;
      pending = undefined;
    },
  };
}
