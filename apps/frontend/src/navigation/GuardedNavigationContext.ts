import { createContext } from 'react';
import type { HistoryGuardFactory } from './webNavigationHistory';

type GuardedNavigation = {
  cancelPendingNavigation(): void;
  installHistoryGuard(factory: HistoryGuardFactory): void;
};

export const defaultGuardedNavigation: GuardedNavigation = {
  cancelPendingNavigation() {},
  installHistoryGuard() {},
};

/** The editor adds its guard when loaded and cancels travel on Keep editing. */
export const GuardedNavigationContext = createContext(defaultGuardedNavigation);
