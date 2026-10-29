import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  CODE_LIFETIME_MS,
  forgetCodeRequest,
  readCodeRequest,
  rememberCodeRequest,
} from '../auth/codeRequest';

const KEY = 'alethical-finance-code-request';

class MemoryStorage {
  values = new Map<string, string>();
  getItem(key: string) {
    return this.values.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.values.set(key, String(value));
  }
  removeItem(key: string) {
    this.values.delete(key);
  }
}

let storage: MemoryStorage;

beforeEach(() => {
  storage = new MemoryStorage();
  Object.defineProperty(window, 'sessionStorage', { value: storage, configurable: true });
});

afterEach(() => {
  Object.defineProperty(window, 'sessionStorage', { value: undefined, configurable: true });
});

describe('the tab’s code request', () => {
  it('keeps the newest request until the code’s lifetime ends', () => {
    rememberCodeRequest('a@b.co', 'challenge-1', 1_000);
    rememberCodeRequest('a@b.co', 'challenge-2', 2_000);
    expect(readCodeRequest(2_000 + CODE_LIFETIME_MS - 1)).toEqual({
      email: 'a@b.co',
      challenge: 'challenge-2',
      requestedAt: 2_000,
    });
    expect(readCodeRequest(2_000 + CODE_LIFETIME_MS)).toBeNull();
    forgetCodeRequest();
    expect(readCodeRequest(2_000)).toBeNull();
  });

  it.each([
    ['not JSON', '{'],
    ['no challenge', JSON.stringify({ email: 'a@b.co', requestedAt: 1_000 })],
    ['no address', JSON.stringify({ challenge: 'c', requestedAt: 1_000 })],
    ['a date ahead', JSON.stringify({ email: 'a@b.co', challenge: 'c', requestedAt: 9_000 })],
    ['null', 'null'],
  ])('ignores a kept value that is %s', (_, raw) => {
    storage.setItem(KEY, raw);
    expect(readCodeRequest(2_000)).toBeNull();
  });

  it('still answers when the browser refuses storage', () => {
    Object.defineProperty(window, 'sessionStorage', {
      get() {
        throw new DOMException('blocked', 'SecurityError');
      },
      configurable: true,
    });
    expect(rememberCodeRequest('a@b.co', 'challenge-1', 1_000).challenge).toBe('challenge-1');
    expect(readCodeRequest(1_000)).toBeNull();
    expect(() => forgetCodeRequest()).not.toThrow();
  });
});
