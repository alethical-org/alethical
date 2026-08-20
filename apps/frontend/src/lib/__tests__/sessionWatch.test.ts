// The signed-in homepage's Session watch hero (#1034).
//
// Two things here are the two ways this feature lies while looking correct, and
// both have already burned this product once:
//
//  1. Reporting "nothing has moved" when we simply have not asked yet. The
//     comparison point is fetched, so on a fresh load there is no answer — and the
//     obvious build reads that absence as "nothing". A reader whose bills all moved
//     would be told they had not.
//  2. A count that is honest about what is on screen and wrong about what exists.
//     "11 of the 14 moved" beside two rows reads as though those two ARE the eleven.

import { describe, expect, it } from 'vitest';

import type { BillAction } from '../../data/types';
import { sessionWatch, SESSION_WATCH_ROWS } from '../sessionWatch';
import type { LastVisit } from '../trackedBillsChanges';

const NOW = new Date('2026-04-01');
const VISITED: LastVisit = { state: 'previous-visit', at: new Date('2026-03-12T14:00:00Z') };
const NOT_CHECKED: LastVisit = { state: 'not-checked' };
const FIRST_VISIT: LastVisit = { state: 'first-visit' };

function action(date: string, text = 'Second reading'): BillAction {
  return { id: `a-${date}-${text}`, date, description: 'x', actionText: text, actionNumber: 1 };
}

/** A bill that moved after the reader's last visit. */
const moved = (id: string, date = '2026-03-20') => ({ id, actions: [action(date)] });
/** A bill whose only action predates it. */
const quiet = (id: string) => ({ id, actions: [action('2026-01-05')] });

describe('the five frames are chosen by what we actually know', () => {
  it('renders PENDING when nobody has asked when the reader last looked', () => {
    // The state that exists to prevent a specific lie. Bills that plainly moved must
    // not come back as rows, and the hero must not name a count or a date — the date
    // is exactly the unknown being fetched.
    const watch = sessionWatch([moved('b1'), moved('b2')], NOT_CHECKED, NOW, '');
    expect(watch.state).toBe('pending');
    expect(watch.rows).toEqual([]);
    expect(watch.movedCount).toBe(0);
    expect(watch.glyph).toBe('spinner');
    expect(watch.heroLine).toBe(
      'Checking your tracked bills for anything that’s moved since you last looked',
    );
    expect(watch.heroLine).not.toMatch(/\d/);
  });

  it('never says "nothing moved" while pending, on a list where everything moved', () => {
    const watch = sessionWatch([moved('b1'), moved('b2')], NOT_CHECKED, NOW, 'Mar 12');
    expect(watch.heroLine).not.toMatch(/nothing has moved/i);
    expect(watch.heroLine).not.toMatch(/first look/i);
  });

  it('renders TRACKING NOTHING for an empty list, without apologising', () => {
    const watch = sessionWatch([], VISITED, NOW, 'Mar 12');
    expect(watch.state).toBe('tracking-nothing');
    expect(watch.heroLine).toBe(
      'You’re not tracking any bills yet — track one and its movement shows up here',
    );
  });

  // The state this exists to prevent: the tracked-list query does not retry, so
  // before this state a single failure left the hero on "Checking your tracked
  // bills…" with a spinner permanently, indistinguishable from a slow load.
  it('renders FAILED as its own terminal state, not as a pending that never ends', () => {
    const watch = sessionWatch([], { state: 'not-checked' }, NOW, '', true);
    expect(watch.state).toBe('failed');
    expect(watch.heroLine).toBe('We couldn’t check your tracked bills just now');
    expect(watch.rows).toHaveLength(0);
    expect(watch.movedCount).toBe(0);
  });

  it('reports FAILED even when bills and a visit did arrive, so a stale set never reads as the answer', () => {
    const watch = sessionWatch([moved('b1')], VISITED, NOW, 'Mar 12', true);
    expect(watch.state).toBe('failed');
    expect(watch.heroLine).not.toMatch(/moved since/);
  });

  it('is unchanged when nothing failed', () => {
    const watch = sessionWatch([moved('b1')], VISITED, NOW, 'Mar 12', false);
    expect(watch.state).toBe('moved');
  });

  it('renders FIRST VISIT plainly, with no "since" it does not have', () => {
    const watch = sessionWatch([moved('b1')], FIRST_VISIT, NOW, '');
    expect(watch.state).toBe('first-visit');
    expect(watch.movedCount).toBe(0);
    expect(watch.heroLine).toMatch(/first look at your tracked bills/);
    expect(watch.glyph).toBe('clock');
  });

  it('renders QUIET with the last change dated, so it never reads as empty', () => {
    const watch = sessionWatch([quiet('b1'), quiet('b2')], VISITED, NOW, 'Mar 20');
    expect(watch.state).toBe('quiet');
    expect(watch.heroLine).toBe(
      'None of your 2 tracked bills moved since you last opened the list on Mar 20 — the most recent change was Jan 5, 2026',
    );
    // The card still lists the bills, so the page is never blank.
    expect(watch.rows).toHaveLength(2);
    expect(watch.rows.every((row) => row.change === null)).toBe(true);
  });

  it('drops the trailing clause when no tracked bill has a dated action at all', () => {
    const watch = sessionWatch([{ id: 'b1', actions: [] }], VISITED, NOW, 'Mar 20');
    expect(watch.heroLine).toBe(
      'Your tracked bill has not moved since you last opened the list on Mar 20',
    );
  });

  // One tracked bill drops the numeral: "your 1 tracked bill" says with a digit
  // what the singular noun already says, and "none of 1" reports a proportion
  // that cannot vary. The verb changes with it, which is why this is a separate
  // sentence rather than a conditional noun.
  it('names ONE tracked bill without a numeral, and still dates the last change', () => {
    const watch = sessionWatch([quiet('b1')], VISITED, NOW, 'Mar 20');
    expect(watch.state).toBe('quiet');
    expect(watch.heroLine).toBe(
      'Your tracked bill has not moved since you last opened the list on Mar 20 — the most recent change was Jan 5, 2026',
    );
    expect(watch.heroLine).not.toMatch(/\b1 tracked\b/);
  });

  it('renders MOVED with the count and the date', () => {
    const bills = [moved('b1'), moved('b2'), quiet('b3'), quiet('b4')];
    const watch = sessionWatch(bills, VISITED, NOW, 'Mar 12');
    expect(watch.state).toBe('moved');
    expect(watch.heroLine).toBe(
      '2 of your 4 tracked bills moved since you last opened the list on Mar 12',
    );
    expect(watch.glyph).toBe('trend');
  });
});

describe('the card never lets two rows pass themselves off as the whole set', () => {
  it('adds no cap caption when the rows already show everything that moved', () => {
    // 2 of 4 moved, both shown. The reader sees everything the sentence counts, so
    // a cap would be noise.
    const watch = sessionWatch(
      [moved('b1'), moved('b2'), quiet('b3'), quiet('b4')],
      VISITED,
      NOW,
      'Mar 12',
    );
    expect(watch.movedCount).toBe(2);
    expect(watch.rows).toHaveLength(2);
    expect(watch.capCaption).toBe('');
  });

  it('states the cap when more moved than it can show', () => {
    // 11 of 14 moved. Without this line the two rows read as the eleven.
    const bills = [
      ...Array.from({ length: 11 }, (_, i) => moved(`m${i}`)),
      ...Array.from({ length: 3 }, (_, i) => quiet(`q${i}`)),
    ];
    const watch = sessionWatch(bills, VISITED, NOW, 'Mar 12');
    expect(watch.movedCount).toBe(11);
    expect(watch.rows).toHaveLength(SESSION_WATCH_ROWS);
    expect(watch.capCaption).toBe('Showing the 2 most recent of 11 that moved');
    expect(watch.heroLine).toBe(
      '11 of your 14 tracked bills moved since you last opened the list on Mar 12',
    );
  });

  it('caps at three moved too, so there is no threshold to get wrong', () => {
    const watch = sessionWatch([moved('m1'), moved('m2'), moved('m3')], VISITED, NOW, 'Mar 12');
    expect(watch.capCaption).toBe('Showing the 2 most recent of 3 that moved');
  });

  it('never shows more rows than the cap, whatever the list size', () => {
    const bills = Array.from({ length: 40 }, (_, i) => moved(`m${i}`));
    expect(sessionWatch(bills, VISITED, NOW, 'Mar 12').rows.length).toBe(SESSION_WATCH_ROWS);
  });

  it('leads with what moved, then fills the spare slot with a quiet bill', () => {
    const watch = sessionWatch([quiet('q1'), moved('m1'), quiet('q2')], VISITED, NOW, 'Mar 12');
    expect(watch.rows.map((row) => row.bill.id)).toEqual(['m1', 'q1']);
    expect(watch.rows[0].change).not.toBeNull();
    expect(watch.rows[1].change).toBeNull();
  });
});

describe('nothing in the hero promises a message', () => {
  it('never implies an email, alert or notification in any state', () => {
    // The product cannot send anything (#36). Returning to the page IS the
    // mechanism, and the copy has to say so without inventing one.
    const cases: Array<[LastVisit, Array<{ id: string; actions: BillAction[] }>]> = [
      [NOT_CHECKED, [moved('b1')]],
      [VISITED, []],
      [FIRST_VISIT, [moved('b1')]],
      [VISITED, [quiet('b1')]],
      [VISITED, [moved('b1'), quiet('b2')]],
    ];
    for (const [lastVisit, bills] of cases) {
      const { heroLine } = sessionWatch(bills, lastVisit, NOW, 'Mar 12');
      expect(heroLine).not.toMatch(/email|alert|notif|remind|we[’']ll (let|tell)|send|subscri/i);
    }
  });

  it('covers all five frames across those cases, so none is silently untested', () => {
    const seen = new Set([
      sessionWatch([moved('b1')], NOT_CHECKED, NOW, '').state,
      sessionWatch([], VISITED, NOW, 'Mar 12').state,
      sessionWatch([moved('b1')], FIRST_VISIT, NOW, '').state,
      sessionWatch([quiet('b1')], VISITED, NOW, 'Mar 20').state,
      sessionWatch([moved('b1')], VISITED, NOW, 'Mar 12').state,
    ]);
    expect([...seen].sort()).toEqual([
      'first-visit',
      'moved',
      'pending',
      'quiet',
      'tracking-nothing',
    ]);
  });
});
