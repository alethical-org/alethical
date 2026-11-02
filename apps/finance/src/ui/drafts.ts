/**
 * Unfinished entries (Design rule eug-142; Access lifecycle): a form keeps one
 * draft per exact target ("Unsaved draft", "Discard draft"). Drafts live in
 * this browser under the account that wrote them: the same account finds them
 * again after its sign-in expires and it signs in again, and a different
 * account never sees them, because signing in as another account clears every
 * draft the browser held. Nothing here is sent anywhere.
 */
const PREFIX = 'alethical-finance-draft:';
const ACCOUNT_KEY = 'alethical-finance-draft-account';

function storage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function keys(store: Storage): string[] {
  const all: string[] = [];
  for (let index = 0; index < store.length; index += 1) {
    const key = store.key(index);
    if (key !== null) all.push(key);
  }
  return all;
}

/** Forget every draft this browser holds. */
export function clearDrafts() {
  const store = storage();
  if (!store) return;
  for (const key of keys(store)) {
    if (key.startsWith(PREFIX)) store.removeItem(key);
  }
}

/**
 * The signed-in account changed, or signed out. Drafts belong to 1 account: a
 * different account clears them; the same account returning keeps them; signing
 * out keeps them for that account's return, since only it can read them back.
 */
export function setDraftAccount(userId: string | null) {
  const store = storage();
  if (!store || userId === null) return;
  const owner = store.getItem(ACCOUNT_KEY);
  if (owner !== null && owner !== userId) clearDrafts();
  store.setItem(ACCOUNT_KEY, userId);
}

export function readDraft<T>(key: string): T | null {
  const store = storage();
  const raw = store?.getItem(PREFIX + key);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export function saveDraft<T>(key: string, value: T) {
  try {
    storage()?.setItem(PREFIX + key, JSON.stringify(value));
  } catch {
    // Storage can be full or unavailable; the form keeps its entries meanwhile.
  }
}

export function discardDraft(key: string) {
  storage()?.removeItem(PREFIX + key);
}

/** Whether any draft starts with this key prefix (a queue row's "Unsaved draft" tag). */
export function hasDraft(prefix: string): boolean {
  const store = storage();
  if (!store) return false;
  return keys(store).some((key) => key.startsWith(PREFIX + prefix));
}
