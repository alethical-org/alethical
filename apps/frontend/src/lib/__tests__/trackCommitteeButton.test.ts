/**
 * The committee page's Track control (#1943): its words, and the rule deciding
 * which of its 5 forms shows. The case pinned hardest is signed out, which is
 * `hidden`, because signed-out following of a committee is deliberately not built.
 */
import { describe, expect, it } from 'vitest';

import {
  CHECKING_COMMITTEE_LABEL,
  ON_YOUR_TRACKED_LIST,
  ON_YOUR_TRACKED_LIST_LEAD,
  ON_YOUR_TRACKED_LIST_LINK,
  RECHECK_COMMITTEE_LABEL,
  RETRY_COMMITTEE_WRITE_LABEL,
  TRACK_COMMITTEE_LABEL,
  TRACKED_COMMITTEE_LABEL,
  trackCommitteeState,
  trackCommitteeToggleProps,
} from '../trackCommitteeButton';

describe('the words', () => {
  it('uses the bill control’s 2 labels and names the destination once, with no dot', () => {
    expect(TRACK_COMMITTEE_LABEL).toBe('Track');
    expect(TRACKED_COMMITTEE_LABEL).toBe('Tracked');
    expect(ON_YOUR_TRACKED_LIST).toBe('On your tracked list');
    expect(ON_YOUR_TRACKED_LIST_LEAD + ON_YOUR_TRACKED_LIST_LINK).toBe(ON_YOUR_TRACKED_LIST);
    expect(ON_YOUR_TRACKED_LIST.endsWith('.')).toBe(false);
  });

  it('never promises a notification', () => {
    for (const s of [
      ON_YOUR_TRACKED_LIST,
      CHECKING_COMMITTEE_LABEL,
      RECHECK_COMMITTEE_LABEL,
      RETRY_COMMITTEE_WRITE_LABEL,
    ]) {
      expect(s.toLowerCase()).not.toMatch(/notify|alert|tell you|watch/);
    }
  });

  it('is one aria-pressed toggle whose name says what it is about', () => {
    expect(trackCommitteeToggleProps(false)).toEqual({
      'aria-pressed': false,
      accessibilityLabel: 'Track this committee',
    });
    expect(trackCommitteeToggleProps(true)['aria-pressed']).toBe(true);
  });
});

describe('trackCommitteeState', () => {
  const base = { isSignedIn: true, hasList: true, isError: false, writeFailed: false };

  it('draws nothing at all for a signed-out reader, whatever else is true', () => {
    expect(trackCommitteeState({ ...base, isSignedIn: false, isTracked: false })).toBe('hidden');
    expect(
      trackCommitteeState({
        ...base,
        isSignedIn: false,
        hasList: false,
        isError: true,
        isTracked: true,
      }),
    ).toBe('hidden');
  });

  it('says tracked or untracked once the list is held', () => {
    expect(trackCommitteeState({ ...base, isTracked: true })).toBe('tracked');
    expect(trackCommitteeState({ ...base, isTracked: false })).toBe('untracked');
  });

  it('a list we hold wins over a later refetch failure', () => {
    expect(trackCommitteeState({ ...base, isError: true, isTracked: true })).toBe('tracked');
  });

  it('claims nothing until the list arrives, and offers a recheck when it never does', () => {
    expect(trackCommitteeState({ ...base, hasList: false, isTracked: false })).toBe('checking');
    expect(trackCommitteeState({ ...base, hasList: false, isError: true, isTracked: false })).toBe(
      'unavailable',
    );
  });

  it('a failed write takes the retry form even with a list on screen', () => {
    expect(trackCommitteeState({ ...base, writeFailed: true, isTracked: true })).toBe(
      'unavailable',
    );
  });
});
