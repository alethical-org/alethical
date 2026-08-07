const HISTORY_STATE_KEY = '__alethical';
const SESSION_STORAGE_KEY = 'alethical:history-session';
const SCROLL_STORAGE_PREFIX = 'alethical:scroll';

export type AppHistoryEntry = {
  sessionId: string;
  depth: number;
  entryId: string;
};

type HistoryState = Record<string, unknown>;

function objectState(state: unknown): HistoryState {
  return state && typeof state === 'object' && !Array.isArray(state) ? (state as HistoryState) : {};
}

export function historyEntryFromState(state: unknown, sessionId: string): AppHistoryEntry | null {
  const entry = objectState(state)[HISTORY_STATE_KEY] as Partial<AppHistoryEntry> | undefined;
  if (
    entry?.sessionId !== sessionId ||
    typeof entry.depth !== 'number' ||
    typeof entry.entryId !== 'string'
  ) {
    return null;
  }
  return entry as AppHistoryEntry;
}

export function initialHistoryState(
  state: unknown,
  sessionId: string,
  entryId: string,
): HistoryState {
  return {
    ...objectState(state),
    [HISTORY_STATE_KEY]: { sessionId, depth: 0, entryId },
  };
}

export function nextHistoryState(state: unknown, sessionId: string, entryId: string): HistoryState {
  const current = historyEntryFromState(state, sessionId);
  return {
    ...objectState(state),
    [HISTORY_STATE_KEY]: {
      sessionId,
      depth: (current?.depth ?? 0) + 1,
      entryId,
    },
  };
}

export function scrollPositionStorageKey(sessionId: string, entryId: string) {
  return `${SCROLL_STORAGE_PREFIX}:${sessionId}:${entryId}`;
}

function newId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

let cachedSessionId: string | null = null;

function currentSessionId() {
  if (cachedSessionId) {
    return cachedSessionId;
  }
  const stored = window.sessionStorage.getItem(SESSION_STORAGE_KEY);
  cachedSessionId = stored || newId();
  if (!stored) {
    window.sessionStorage.setItem(SESSION_STORAGE_KEY, cachedSessionId);
  }
  return cachedSessionId;
}

export function initializeWebHistory() {
  const sessionId = currentSessionId();
  if (!historyEntryFromState(window.history.state, sessionId)) {
    window.history.replaceState(initialHistoryState(window.history.state, sessionId, newId()), '');
  }
}

export function pushWebHistory(path: string) {
  const sessionId = currentSessionId();
  window.history.pushState(nextHistoryState(window.history.state, sessionId, newId()), '', path);
}

export function hasInAppBackEntry() {
  const entry = historyEntryFromState(window.history.state, currentSessionId());
  return Boolean(entry && entry.depth > 0);
}

function currentScrollStorageKey() {
  const sessionId = currentSessionId();
  const entry = historyEntryFromState(window.history.state, sessionId);
  return entry ? scrollPositionStorageKey(sessionId, entry.entryId) : null;
}

export function saveCurrentScrollPosition(y: number) {
  const key = currentScrollStorageKey();
  if (key) {
    window.sessionStorage.setItem(key, String(Math.max(0, Math.round(y))));
  }
}

export function readCurrentScrollPosition() {
  const key = currentScrollStorageKey();
  if (!key) {
    return 0;
  }
  const saved = Number(window.sessionStorage.getItem(key));
  return Number.isFinite(saved) && saved > 0 ? saved : 0;
}
