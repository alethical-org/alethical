import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  clearDrafts,
  discardDraft,
  hasDraft,
  readDraft,
  saveDraft,
  setDraftAccount,
} from '../ui/drafts';

class MemoryStorage implements Storage {
  private values = new Map<string, string>();
  get length() {
    return this.values.size;
  }
  key(index: number) {
    return [...this.values.keys()][index] ?? null;
  }
  getItem(key: string) {
    return this.values.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.values.set(key, String(value));
  }
  removeItem(key: string) {
    this.values.delete(key);
  }
  clear() {
    this.values.clear();
  }
}

describe('drafts per account (Access lifecycle)', () => {
  beforeEach(() => {
    // Node's own experimental localStorage hides the test page's, so each test
    // gets a fresh one.
    const storage = new MemoryStorage();
    vi.stubGlobal('localStorage', storage);
    Object.defineProperty(window, 'localStorage', { value: storage, configurable: true });
  });

  it('keeps a draft for the account that wrote it, across an expired sign-in', () => {
    setDraftAccount('user-1');
    saveDraft('identity|Example Media LLC|payee|confirm|ORG-1', { note: 'invoice' });
    expect(readDraft('identity|Example Media LLC|payee|confirm|ORG-1')).toEqual({
      note: 'invoice',
    });
    expect(hasDraft('identity|Example Media LLC|')).toBe(true);
    // The same account signs in again after its session expired.
    setDraftAccount('user-1');
    expect(readDraft('identity|Example Media LLC|payee|confirm|ORG-1')).toEqual({
      note: 'invoice',
    });
  });

  it('clears every draft when a different account signs in', () => {
    setDraftAccount('user-1');
    saveDraft('tv|kstp/file-1|v2', { quote: 'q' });
    setDraftAccount('user-2');
    expect(readDraft('tv|kstp/file-1|v2')).toBeNull();
    expect(hasDraft('tv|')).toBe(false);
  });

  it('discards only the named draft', () => {
    setDraftAccount('user-1');
    saveDraft('tv|a|v1', 1);
    saveDraft('tv|b|v1', 2);
    discardDraft('tv|a|v1');
    expect(readDraft('tv|a|v1')).toBeNull();
    expect(readDraft('tv|b|v1')).toBe(2);
    clearDrafts();
    expect(readDraft('tv|b|v1')).toBeNull();
  });
});
