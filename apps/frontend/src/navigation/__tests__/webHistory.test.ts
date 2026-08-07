import { describe, expect, it } from 'vitest';

import {
  historyEntryFromState,
  initialHistoryState,
  nextHistoryState,
  scrollPositionStorageKey,
} from '../webHistory';

describe('in-app browser history', () => {
  it('marks a fresh or externally opened page as having no earlier app page', () => {
    const state = initialHistoryState({ outside: 'kept' }, 'tab-1', 'entry-1');
    expect(state).toEqual({
      outside: 'kept',
      __alethical: { sessionId: 'tab-1', depth: 0, entryId: 'entry-1' },
    });
    expect(historyEntryFromState(state, 'tab-1')?.depth).toBe(0);
  });

  it('adds an app entry without throwing away other history state', () => {
    const current = initialHistoryState({ outside: 'kept' }, 'tab-1', 'entry-1');
    const next = nextHistoryState(current, 'tab-1', 'entry-2');
    expect(next).toEqual({
      outside: 'kept',
      __alethical: { sessionId: 'tab-1', depth: 1, entryId: 'entry-2' },
    });
  });

  it('does not treat another tab or an unmarked page as in-app history', () => {
    const state = initialHistoryState({}, 'tab-1', 'entry-1');
    expect(historyEntryFromState(state, 'tab-2')).toBeNull();
    expect(historyEntryFromState({}, 'tab-1')).toBeNull();
  });

  it('keeps each saved scroll position tied to one exact history entry', () => {
    expect(scrollPositionStorageKey('tab-1', 'entry-1')).toBe('alethical:scroll:tab-1:entry-1');
    expect(scrollPositionStorageKey('tab-1', 'entry-2')).not.toBe(
      scrollPositionStorageKey('tab-1', 'entry-1'),
    );
  });
});
