// The tracked-bills page's two page-level answers: which saved bills moved since
// the reader last looked, and the one sentence that says so (#1009).
//
// Kept free of React and component imports so it is testable on its own, and
// separate from lib/billDetail so the per-bill wording stays in the one place both
// this page and the bill page read it from.

import type { BillAction } from '../data/types';
import { changesSince, formatNiceDate, parseActionDate, type BillChanges } from './billDetail';

/** A saved bill and what it did since the reader's previous visit. */
export interface MovedBill<T> {
  bill: T;
  change: BillChanges;
}

/** What a surface knows about when this reader last opened their tracked list.
 *
 *  Three cases, all real, and the whole point of this type is that the third one
 *  cannot be spelled the same way as the second (#1026). It used to be a
 *  `Date | null`, where null meant "first visit" to the page that wrote it and
 *  would have meant "we have not asked yet" to the signed-in homepage — the same
 *  value carrying opposite meanings, which no reviewer could have caught. */
export type LastVisit =
  /** We asked, and they had been here before. Group changes against `at`. */
  | { state: 'previous-visit'; at: Date }
  /** We asked, and this is their first look. Nothing can have moved "since". */
  | { state: 'first-visit' }
  /** We have NOT asked. Say nothing about what moved, in either direction —
   *  "nothing has moved" is as false a claim here as naming a change would be. */
  | { state: 'not-checked' };

export type TrackedBillGroups<T> =
  | {
      state: 'grouped';
      /** Bills that moved, most recent change first. */
      moved: Array<MovedBill<T>>;
      /** Everything else, in the order the list already had. */
      unchanged: T[];
    }
  /** No grouping exists, because nothing was compared. Deliberately carries no
   *  bill lists: a caller has to notice this case rather than reading an empty
   *  `moved` as "nothing moved". */
  | { state: 'not-checked' };

type WithActions = { actions?: BillAction[] };

/** Split the saved list into what moved and what did not.
 *
 *  On a genuine first visit nothing can be "since", so the whole list comes back
 *  unchanged rather than every bill claiming to have moved. That is a real answer.
 *
 *  When the caller has not asked, this returns `{ state: 'not-checked' }` and no
 *  lists at all. That is deliberate and it is the point of the type: an empty
 *  `moved` array would read as "nothing moved", which is a false reassurance on a
 *  session where plenty did — and every line of the code producing it would look
 *  correct. The signed-in homepage's planned Session watch card reads the mark
 *  WITHOUT advancing it, so it hits this case on a cold load. Background:
 *  `docs/architecture/backend-api-system-design.md` § "Before you add a SECOND
 *  surface that shows 'what moved'".
 */
export function groupTrackedBillsByChange<T extends WithActions>(
  bills: T[],
  lastVisit: LastVisit,
  now: Date,
): TrackedBillGroups<T> {
  if (lastVisit.state === 'not-checked') return { state: 'not-checked' };
  if (lastVisit.state === 'first-visit') {
    return { state: 'grouped', moved: [], unchanged: bills };
  }
  const since = lastVisit.at;

  const moved: Array<MovedBill<T> & { at: number; order: number }> = [];
  const unchanged: T[] = [];
  bills.forEach((bill, order) => {
    const change = changesSince(bill.actions ?? [], since, now);
    if (!change) {
      unchanged.push(bill);
      return;
    }
    // A change the record dates nothing sorts last within the moved group: there is
    // no honest place to rank it, and inventing one would be a displayed date by
    // another name. It still appears, and still says what happened.
    const at = parseActionDate(change.date)?.getTime() ?? Number.NEGATIVE_INFINITY;
    moved.push({ bill, change, at, order });
  });

  moved.sort((a, b) => b.at - a.at || a.order - b.order);
  return {
    state: 'grouped',
    moved: moved.map(({ bill, change }) => ({ bill, change })),
    unchanged,
  };
}

/** The newest dated action across every saved bill, humanized ("Mar 3, 2026"), or
 *  '' when not one of them carries a dated action. Used only by the "nothing has
 *  moved" sentence, so it stays useful instead of implying the page is empty. */
export function mostRecentChangeLabel(bills: WithActions[]): string {
  let bestAt = Number.NEGATIVE_INFINITY;
  let bestRaw = '';
  for (const bill of bills) {
    for (const action of bill.actions ?? []) {
      const at = parseActionDate(action.date)?.getTime();
      if (at != null && at > bestAt) {
        bestAt = at;
        bestRaw = action.date;
      }
    }
  }
  return bestRaw ? formatNiceDate(bestRaw) : '';
}

/** The change block's mono eyebrow, in two parts so a surface can tone them
 *  separately: "MOVED MAR 18, 2026" when the record dates the change, and
 *  "MOVED" + " · DATE NOT RECORDED" when it does not.
 *
 *  MOVED leads in both cases and the eyebrow keeps one shape, because dated and
 *  undated blocks sit in the same list and often next to each other — one
 *  composition is what makes them read as the same thing. The absence is NAMED
 *  rather than left silent: a bare "MOVED" reads as our omission, where the
 *  qualifier says the silence is the record's. `bill_action.action_at` is
 *  nullable and the Legislature genuinely files undated entries, so this is a
 *  normal state, not a data defect.
 *
 *  A pure function so both branches are pinned by a test rather than only ever
 *  checked by looking at the screen. */
export function changeEyebrow(date: string): { moved: string; qualifier: string | null } {
  if (!date) return { moved: 'MOVED', qualifier: ' · DATE NOT RECORDED' };
  return { moved: `MOVED ${date.toUpperCase()}`, qualifier: null };
}

/** The dated caption under the count. One sentence, no terminal period.
 *
 *  **`null` when the caller has not asked when the reader last looked** — there is
 *  no honest sentence for that case, so the surface prints none rather than
 *  reaching for "nothing has moved", which would be a false reassurance. This is
 *  the same three-way distinction `groupTrackedBillsByChange` makes, so the
 *  caption and the list beneath it cannot disagree (#1026).
 *
 *  It never says or implies that anything will be sent: the product cannot send
 *  email (#36), and this page is the whole delivery mechanism. */
export function trackedBillsSummaryLine(args: {
  total: number;
  movedCount: number;
  lastVisit: LastVisit;
  /** From mostRecentChangeLabel — only read when nothing moved. */
  mostRecentChange: string;
}): string | null {
  const { total, movedCount, lastVisit, mostRecentChange } = args;
  if (lastVisit.state === 'not-checked') return null;
  if (lastVisit.state === 'first-visit') {
    return 'This is your first look at your tracked list, so there is no “since” yet — from now on, anything that moves shows up here';
  }
  const visited = formatNiceDate(localDay(lastVisit.at));
  if (movedCount === 0) {
    return mostRecentChange
      ? `Nothing has moved since your last visit on ${visited} — the most recent change was ${mostRecentChange}`
      : `Nothing has moved since your last visit on ${visited}`;
  }
  if (total === 1) {
    return `The bill you’re tracking moved since your last visit on ${visited}`;
  }
  return `${movedCount} of the ${total} bills you’re tracking moved since your last visit on ${visited}`;
}

// The reader's LOCAL calendar day, so a visit at 9pm Minnesota time is not dated to
// the next day by its UTC timestamp. Handed to the shared formatter rather than
// formatted here, so this page's dates read like every other date in the product.
function localDay(at: Date): string {
  const month = `${at.getMonth() + 1}`.padStart(2, '0');
  const day = `${at.getDate()}`.padStart(2, '0');
  return `${at.getFullYear()}-${month}-${day}`;
}
