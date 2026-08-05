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

export interface TrackedBillGroups<T> {
  /** Bills that moved, most recent change first. */
  moved: Array<MovedBill<T>>;
  /** Everything else, in the order the list already had. */
  unchanged: T[];
}

type WithActions = { actions?: BillAction[] };

/** Split the saved list into what moved and what did not.
 *
 *  `since` is null on a reader's first visit, where nothing can be "since" — the
 *  whole list comes back unchanged rather than every bill claiming to have moved.
 *
 *  CALLERS: null here means "there is genuinely no previous visit", NOT "we have
 *  not looked it up yet". Those are different facts and this function cannot tell
 *  them apart. Pass null from a surface that simply has not asked and it will
 *  report every bill as unchanged — which reads on screen as "nothing moved" on a
 *  session where plenty did, a false statement that looks completely correct.
 *  A surface that reads the mark without advancing it (the signed-in homepage's
 *  planned Session watch card) gets null on a cold load and must render its own
 *  third state rather than calling this. Spelled out in
 *  `docs/architecture/backend-api-system-design.md` § "Before you add a SECOND
 *  surface that shows 'what moved'".
 */
export function groupTrackedBillsByChange<T extends WithActions>(
  bills: T[],
  since: Date | null,
  now: Date,
): TrackedBillGroups<T> {
  if (!since) return { moved: [], unchanged: bills };

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
  return { moved: moved.map(({ bill, change }) => ({ bill, change })), unchanged };
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
 *  It never says or implies that anything will be sent: the product cannot send
 *  email (#36), and this page is the whole delivery mechanism. */
export function trackedBillsSummaryLine(args: {
  total: number;
  movedCount: number;
  /** The reader's previous visit, or null on their first. */
  since: Date | null;
  /** From mostRecentChangeLabel — only read when nothing moved. */
  mostRecentChange: string;
}): string {
  const { total, movedCount, since, mostRecentChange } = args;
  if (!since) {
    return 'This is your first look at your tracked list, so there is no “since” yet — from now on, anything that moves shows up here';
  }
  const visited = formatNiceDate(localDay(since));
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
