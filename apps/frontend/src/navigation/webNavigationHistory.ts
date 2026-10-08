import type { createGuardedWebHistory } from './guardedWebHistory';
import { consumeWebHistoryReplaceMark, pushWebHistory, replaceWebHistoryPath } from './webHistory';

export type HistoryGuardFactory = typeof createGuardedWebHistory;
type Options = Parameters<HistoryGuardFactory>[0];

/**
 * Ordinary pages need only address/history synchronization. The editor installs
 * its removal-aware implementation synchronously before it can hold a draft.
 * Retain that instance for the root's lifetime: a confirmed departure can still
 * be traversing browser history after the editor itself has unmounted.
 */
export function createWebNavigationHistory(options: Options) {
  let path = `${window.location.pathname}${window.location.search}` || '/';
  let guard: ReturnType<HistoryGuardFactory> | undefined;
  return {
    installHistoryGuard(factory: HistoryGuardFactory) {
      guard ??= factory(options);
    },
    cancelPendingNavigation() {
      guard?.cancelPendingNavigation();
    },
    onPopState() {
      if (guard) {
        guard.onPopState();
        return;
      }
      path = `${window.location.pathname}${window.location.search}` || '/';
      options.resetNavigationToPath(path);
    },
    onStateChange(nextPath: string) {
      if (guard) {
        guard.onStateChange(nextPath);
        return;
      }
      if (nextPath === path) return;
      if (consumeWebHistoryReplaceMark()) replaceWebHistoryPath(nextPath);
      else pushWebHistory(nextPath);
      path = nextPath;
    },
  };
}
