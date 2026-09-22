// @vitest-environment jsdom

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { historyEntryFromState, initializeWebHistory } from '../webHistory';

// The page writes this entry itself, before Cloudflare's speed beacon can see the
// call (apps/frontend/public/index.html, the `alethical-history-entry` program, and
// issue 2336 for what the beacon does when it sees one). Two copies of one rule is
// how a rule rots, so these run the page's actual program and check that the app
// agrees with what it wrote.
const pageShell = readFileSync(resolve(__dirname, '../../../public/index.html'), 'utf8');

function pageHistoryProgram(): string {
  const match = pageShell.match(/<script id=["']alethical-history-entry["']>([\s\S]*?)<\/script>/);
  if (!match) {
    throw new Error(
      'apps/frontend/public/index.html no longer writes the history entry before the ' +
        'Cloudflare beacon loads, so every page load reopens a phantom click record.',
    );
  }
  return match[1];
}

function runPageHistoryProgram() {
  new Function(pageHistoryProgram())();
}

beforeEach(() => {
  window.sessionStorage.clear();
  window.history.replaceState(null, '');
});

describe('the history entry the page writes for itself', () => {
  it('runs before the beacon does, which is the whole point of it being here', () => {
    const beaconTag = pageShell.indexOf(
      'src="https://static.cloudflareinsights.com/beacon.min.js"',
    );
    const program = pageShell.indexOf('<script id="alethical-history-entry">');
    expect(program).toBeGreaterThan(-1);
    expect(beaconTag).toBeGreaterThan(program);
  });

  it('writes the same entry the app would have written', () => {
    runPageHistoryProgram();

    const sessionId = window.sessionStorage.getItem('alethical:history-session');
    expect(sessionId).toBeTruthy();
    expect(historyEntryFromState(window.history.state, sessionId!)).toEqual({
      sessionId,
      depth: 0,
      entryId: expect.any(String),
    });
  });

  it('leaves the app with nothing to write, so no second call reaches the beacon', () => {
    runPageHistoryProgram();
    const written = window.history.state;

    const replaceState = vi.spyOn(window.history, 'replaceState');
    initializeWebHistory();

    expect(replaceState).not.toHaveBeenCalled();
    expect(window.history.state).toEqual(written);
    replaceState.mockRestore();
  });

  it('keeps the depth a reload would otherwise reset, and any state that is not ours', () => {
    runPageHistoryProgram();
    const sessionId = window.sessionStorage.getItem('alethical:history-session')!;
    const deeper = {
      outside: 'kept',
      __alethical: { sessionId, depth: 3, entryId: 'entry-3' },
    };
    window.history.replaceState(deeper, '');

    runPageHistoryProgram();

    expect(window.history.state).toEqual(deeper);
  });

  it('replaces an entry left by another tab rather than trusting its depth', () => {
    window.sessionStorage.setItem('alethical:history-session', 'this-tab');
    window.history.replaceState(
      { __alethical: { sessionId: 'another-tab', depth: 7, entryId: 'entry-7' } },
      '',
    );

    runPageHistoryProgram();

    expect(historyEntryFromState(window.history.state, 'this-tab')).toEqual({
      sessionId: 'this-tab',
      depth: 0,
      entryId: expect.any(String),
    });
  });

  it('leaves the entry to the app when session storage is unavailable', () => {
    const storage = Object.getOwnPropertyDescriptor(window, 'sessionStorage')!;
    Object.defineProperty(window, 'sessionStorage', {
      configurable: true,
      get() {
        throw new Error('session storage is blocked');
      },
    });

    try {
      expect(() => runPageHistoryProgram()).not.toThrow();
      expect(window.history.state).toBeNull();
    } finally {
      Object.defineProperty(window, 'sessionStorage', storage);
    }
  });
});
