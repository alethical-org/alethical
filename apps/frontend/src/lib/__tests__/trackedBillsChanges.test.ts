// "What moved since you last looked" on the tracked-bills page (#1009).
//
// Four things here are the four ways this feature breaks quietly. Each was
// verified against the real data model before the code was written, and each is
// something that would still LOOK right on screen while being wrong:
//
//  1. The action feed does not arrive in date order. `Bill.actions` sorts by
//     (chamber_id, action_number) and `action_number` is PER CHAMBER, so a bill's
//     House block can be served before its earlier Senate block. Read position as
//     time and a months-old step reports as today's news.
//  2. Undated actions are normal, not a data defect. `bill_action.action_at` is
//     nullable and the Legislature genuinely files entries with no date. Dropping
//     them makes "nothing has moved" false; dating them by guess invents a fact.
//  3. A busy day files many rows for one bill. The count beside the change has to
//     be of the things that actually happened, not of raw feed rows.
//  4. The comparison point has to survive a reload, or the reader loses the very
//     thing they came back to see the moment the page refreshes.

import { afterEach, describe, expect, it } from 'vitest';

import { changesSince } from '../billDetail';
import type { BillAction } from '../../data/types';
import {
  groupTrackedBillsByChange,
  mostRecentChangeLabel,
  trackedBillsSummaryLine,
} from '../trackedBillsChanges';
import {
  forgetHeldLastVisits,
  holdLastVisit,
  lastVisitDate,
  readHeldLastVisit,
} from '../trackedBillsLastVisit';

const NOW = new Date('2026-04-01');
const LAST_VISIT = new Date('2026-03-12T14:00:00Z');

function action(fields: Partial<BillAction> & { actionNumber: number }): BillAction {
  return {
    id: `a${fields.actionNumber}`,
    date: '',
    description: 'x',
    ...fields,
  };
}

describe('changesSince reads the record, not the order it arrives in', () => {
  it('ignores feed position: an earlier Senate block served after a newer House block', () => {
    // The real shape. action_number restarts at 1 in the second chamber, so this is
    // what the API serves for a bill that moved in the House after the Senate.
    // Position says the March row came first; the dates say otherwise.
    const actions = [
      action({ actionNumber: 1, date: '2026-03-20', actionText: 'Third reading passed' }),
      action({
        actionNumber: 2,
        date: '2026-03-21',
        actionText: 'Referred to',
        committee: 'Taxes',
      }),
      // Chamber boundary — action_number DROPS, and these are OLDER.
      action({ actionNumber: 1, date: '2026-01-08', actionText: 'Introduction and first reading' }),
      action({ actionNumber: 2, date: '2026-01-09', actionText: 'Author added' }),
    ];

    const change = changesSince(actions, LAST_VISIT, NOW)!;
    expect(change.date).toBe('Mar 21, 2026');
    // The two January rows are older than the visit and must not be counted.
    expect(change.earlierCount).toBe(1);
  });

  it('reports nothing when every dated action predates the visit', () => {
    const actions = [
      action({ actionNumber: 1, date: '2026-01-08', actionText: 'Introduction and first reading' }),
      action({ actionNumber: 2, date: '2026-02-27', actionText: 'Committee report, to pass' }),
    ];
    expect(changesSince(actions, LAST_VISIT, NOW)).toBeNull();
  });

  it('counts a step filed on the day of the visit, rather than silently dropping it', () => {
    // The record dates an action to a DAY and not a time. Measuring from the start
    // of the visit day would hide anything filed later that same day, which is the
    // half of the day the reader definitely did not see.
    const sameDay = [action({ actionNumber: 1, date: '2026-03-12', actionText: 'Second reading' })];
    expect(changesSince(sameDay, LAST_VISIT, NOW)).not.toBeNull();
  });
});

describe('changesSince reports an undated change without inventing a date', () => {
  it('uses when we first saw the action, and prints no date for it', () => {
    // "Laid on table" and conference-committee steps come through with no date at
    // all. first_seen_at is the honest marker — ingestion upserts actions and never
    // deletes them, so it is stable across re-ingests.
    const actions = [
      action({ actionNumber: 1, date: '2026-01-08', actionText: 'Introduction and first reading' }),
      action({
        actionNumber: 2,
        date: '',
        actionText: 'Laid on table',
        firstSeenAt: '2026-03-19T09:00:00Z',
      }),
    ];

    const change = changesSince(actions, LAST_VISIT, NOW)!;
    // "Set aside" is the shared timeline's plain-language wording for "Laid on
    // table" — the same words the bill page uses, because it is the same function.
    expect(change.label).toBe('Set aside');
    expect(change.date).toBe('');
  });

  it('leaves an undated action alone when we first saw it before the visit', () => {
    const actions = [
      action({
        actionNumber: 1,
        date: '',
        actionText: 'Laid on table',
        firstSeenAt: '2026-02-01T09:00:00Z',
      }),
    ];
    expect(changesSince(actions, LAST_VISIT, NOW)).toBeNull();
  });

  it('says nothing at all about an undated action we have no first-seen mark for', () => {
    // No date and no first-seen mark is not evidence of a change. Reporting it
    // would be a claim we cannot ground.
    const actions = [action({ actionNumber: 1, date: '', actionText: 'Laid on table' })];
    expect(changesSince(actions, LAST_VISIT, NOW)).toBeNull();
  });
});

describe('the earlier-steps count is of what happened, not of feed rows', () => {
  it('collapses a busy day, so seven rows are not reported as seven steps', () => {
    // One real day in a chamber. The feed files seven rows, but two of them are one
    // floor passage stated twice and three are a single run of author adds.
    // Counting feed rows would print "6 earlier steps" for a day on which four
    // things happened.
    const actions = [
      action({ actionNumber: 1, date: '2026-03-19', actionText: 'Second reading' }),
      action({ actionNumber: 2, date: '2026-03-19', actionText: 'Third reading' }),
      action({
        actionNumber: 3,
        date: '2026-03-19',
        actionText: 'Third reading passed',
        tally: '78-52',
      }),
      action({
        actionNumber: 4,
        date: '2026-03-19',
        actionText: 'Author added',
        actionDescription: 'Reyes',
      }),
      action({
        actionNumber: 5,
        date: '2026-03-19',
        actionText: 'Author added',
        actionDescription: 'Nguyen',
      }),
      action({
        actionNumber: 6,
        date: '2026-03-19',
        actionText: 'Author added',
        actionDescription: 'Okafor',
      }),
      action({
        actionNumber: 7,
        date: '2026-03-19',
        actionText: 'Referred to',
        committee: 'Judiciary',
      }),
    ];

    const change = changesSince(actions, LAST_VISIT, NOW)!;
    // The passage is the day's headline beat, worded exactly as the card's "Latest
    // action:" line words it — the same shared function produces both.
    expect(change.label).toBe('Passed the House');
    // Four entries in total: the second reading, the passage cluster, the author
    // run, the referral. Six would be the raw-row count.
    expect(change.earlierCount).toBe(3);
  });

  it('leaves a pointer to another bill out — it is not a step this bill took', () => {
    const actions = [
      action({ actionNumber: 1, date: '2026-03-20', actionText: 'Second reading' }),
      action({
        actionNumber: 2,
        date: '2026-03-20',
        actionText: 'See',
        actionDescription: 'HF4252',
      }),
    ];
    const change = changesSince(actions, LAST_VISIT, NOW)!;
    expect(change.earlierCount).toBe(0);
  });

  it('reports one earlier step as one, so the link can read in the singular', () => {
    const actions = [
      action({ actionNumber: 1, date: '2026-03-18', actionText: 'Second reading' }),
      action({
        actionNumber: 2,
        date: '2026-03-20',
        actionText: 'Referred to',
        committee: 'Taxes',
      }),
    ];
    expect(changesSince(actions, LAST_VISIT, NOW)!.earlierCount).toBe(1);
  });
});

describe('grouping puts what moved first, and says so once', () => {
  const movedRecently = {
    id: 'b1',
    actions: [action({ actionNumber: 1, date: '2026-03-25', actionText: 'Second reading' })],
  };
  const movedEarlier = {
    id: 'b2',
    actions: [action({ actionNumber: 1, date: '2026-03-14', actionText: 'Second reading' })],
  };
  const quiet = {
    id: 'b3',
    actions: [action({ actionNumber: 1, date: '2026-01-05', actionText: 'Second reading' })],
  };

  it('orders the moved group most recent first and leaves the rest as they were', () => {
    const groups = groupTrackedBillsByChange([quiet, movedEarlier, movedRecently], LAST_VISIT, NOW);
    expect(groups.moved.map((entry) => entry.bill.id)).toEqual(['b1', 'b2']);
    expect(groups.unchanged.map((bill) => bill.id)).toEqual(['b3']);
  });

  it('treats a first visit as nothing moved, not as everything moving at once', () => {
    const groups = groupTrackedBillsByChange([movedRecently, quiet], null, NOW);
    expect(groups.moved).toEqual([]);
    expect(groups.unchanged.map((bill) => bill.id)).toEqual(['b1', 'b3']);
  });

  it('puts an undated change last in the moved group rather than ranking it by guess', () => {
    const undated = {
      id: 'b4',
      actions: [
        action({
          actionNumber: 1,
          date: '',
          actionText: 'Laid on table',
          firstSeenAt: '2026-03-30T09:00:00Z',
        }),
      ],
    };
    const groups = groupTrackedBillsByChange([undated, movedEarlier], LAST_VISIT, NOW);
    expect(groups.moved.map((entry) => entry.bill.id)).toEqual(['b2', 'b4']);
  });
});

describe('the page caption states the case it is in, and promises nothing', () => {
  const args = { total: 4, movedCount: 2, since: LAST_VISIT, mostRecentChange: 'Mar 3, 2026' };

  it('dates the window when something moved', () => {
    expect(trackedBillsSummaryLine(args)).toBe(
      '2 of the 4 bills you’re tracking moved since your last visit on Mar 12, 2026',
    );
  });

  it('stays useful when nothing moved, instead of reading as an empty page', () => {
    expect(trackedBillsSummaryLine({ ...args, movedCount: 0 })).toBe(
      'Nothing has moved since your last visit on Mar 12, 2026 — the most recent change was Mar 3, 2026',
    );
  });

  it('drops the trailing clause when no saved bill has a dated action at all', () => {
    expect(trackedBillsSummaryLine({ ...args, movedCount: 0, mostRecentChange: '' })).toBe(
      'Nothing has moved since your last visit on Mar 12, 2026',
    );
  });

  it('explains a first visit rather than showing a "since" it does not have', () => {
    expect(trackedBillsSummaryLine({ ...args, since: null })).toBe(
      'This is your first look at your tracked list, so there is no “since” yet — from now on, anything that moves shows up here',
    );
  });

  it('never implies anything will be sent — the product cannot send it (#36)', () => {
    const lines = [
      trackedBillsSummaryLine(args),
      trackedBillsSummaryLine({ ...args, movedCount: 0 }),
      trackedBillsSummaryLine({ ...args, since: null }),
    ];
    for (const line of lines) {
      expect(line).not.toMatch(/email|alert|notif|remind|we[’']ll (let|tell)|send/i);
    }
  });
});

describe('mostRecentChangeLabel reads the newest dated action across the list', () => {
  it('takes the newest date anywhere in the list, not the newest bill', () => {
    const bills = [
      { actions: [action({ actionNumber: 1, date: '2026-01-05' })] },
      {
        actions: [
          action({ actionNumber: 1, date: '2026-03-03' }),
          action({ actionNumber: 2, date: '2026-02-01' }),
        ],
      },
    ];
    expect(mostRecentChangeLabel(bills)).toBe('Mar 3, 2026');
  });

  it('returns nothing when no saved bill carries a dated action', () => {
    expect(mostRecentChangeLabel([{ actions: [action({ actionNumber: 1, date: '' })] }])).toBe('');
  });
});

describe('the comparison point survives a refresh', () => {
  afterEach(() => {
    forgetHeldLastVisits();
    delete (globalThis as { window?: unknown }).window;
  });

  it('hands back the held value instead of asking again', () => {
    expect(readHeldLastVisit('user-1')).toBeNull();
    holdLastVisit('user-1', '2026-03-12T14:00:00Z');
    expect(readHeldLastVisit('user-1')).toBe('2026-03-12T14:00:00Z');
  });

  it('survives a page reload, which is the case the whole feature turns on', () => {
    // A reload throws away every module, so the in-memory hold goes with it. Only
    // sessionStorage carries the mark across — and without it the page would ask
    // the API again, be handed the mark it had just written, and show "nothing has
    // moved" for a list that had moved.
    (globalThis as { window?: unknown }).window = { sessionStorage: fakeStorage() };
    holdLastVisit('user-1', '2026-03-12T14:00:00Z');
    forgetHeldLastVisits(); // the reload
    expect(readHeldLastVisit('user-1')).toBe('2026-03-12T14:00:00Z');
  });

  it('keeps two readers on one browser apart', () => {
    (globalThis as { window?: unknown }).window = { sessionStorage: fakeStorage() };
    holdLastVisit('user-1', '2026-03-12T14:00:00Z');
    expect(readHeldLastVisit('user-2')).toBeNull();
  });

  it('holds a first visit as a first visit, so it is not re-asked all session', () => {
    (globalThis as { window?: unknown }).window = { sessionStorage: fakeStorage() };
    holdLastVisit('user-1', '');
    forgetHeldLastVisits();
    expect(readHeldLastVisit('user-1')).toBe('');
    expect(lastVisitDate(readHeldLastVisit('user-1'))).toBeNull();
  });

  it('survives storage being unavailable, rather than taking the page down with it', () => {
    // Safari private browsing throws on sessionStorage.
    (globalThis as { window?: unknown }).window = {
      get sessionStorage(): Storage {
        throw new Error('blocked');
      },
    };
    expect(() => holdLastVisit('user-1', '2026-03-12T14:00:00Z')).not.toThrow();
    expect(readHeldLastVisit('user-1')).toBe('2026-03-12T14:00:00Z');
  });

  it('reads a first visit from a missing or unusable mark', () => {
    expect(lastVisitDate(null)).toBeNull();
    expect(lastVisitDate('')).toBeNull();
    expect(lastVisitDate('not a date')).toBeNull();
    expect(lastVisitDate('2026-03-12T14:00:00Z')?.toISOString()).toBe('2026-03-12T14:00:00.000Z');
  });
});

// A sessionStorage stand-in: the module only ever calls getItem/setItem, but the
// object has to satisfy the Storage type it is assigned to.
function fakeStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key: string) => values.get(key) ?? null,
    key: (index: number) => [...values.keys()][index] ?? null,
    removeItem: (key: string) => void values.delete(key),
    setItem: (key: string, value: string) => void values.set(key, value),
  };
}
