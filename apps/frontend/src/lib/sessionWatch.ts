// The signed-in homepage's "Session watch" hero: which of a reader's saved bills
// moved since they last opened their tracked list (#1034).
//
// One function decides BOTH halves — the hero's headline and the card's rows — so
// the sentence and the list beneath it cannot disagree. That is the same failure
// this feature has already had to design around twice: a count honest about what is
// on screen and wrong about what exists.
//
// Kept free of React and component imports so it is testable on its own.

import type { BillAction } from '../data/types';
import type { BillChanges } from './billDetail';
import {
  groupTrackedBillsByChange,
  mostRecentChangeLabel,
  type LastVisit,
} from './trackedBillsChanges';

/** How many bill rows the card shows. Deliberately fixed: a card that grows to
 *  eleven rows overruns the hero and re-creates a second tracked list. What is not
 *  shown is carried by the cap caption, not by more rows. */
export const SESSION_WATCH_ROWS = 2;

export interface SessionWatchRow<T> {
  bill: T;
  /** The green change block's content, or null for a bill that did not move (the
   *  row then shows a plain "Latest action" line). */
  change: BillChanges | null;
}

export interface SessionWatch<T> {
  /** Which of the five designed frames the hero and card render.
   *
   *  `pending` is the one that exists to prevent a specific lie: on a fresh load we
   *  have not asked when the reader last looked, and "no answer" means NOT ASKED,
   *  never "nothing moved". Built the obvious way, this page would tell someone
   *  whose bills all moved that nothing had.
   *
   *  `failed` is the end of that road rather than a variant of it. The tracked
   *  list does not retry, so one failure used to leave the hero saying "Checking
   *  your tracked bills…" with a spinner permanently — indistinguishable from a
   *  slow load, and resolving never. It is a separate state because the reader
   *  needs a different thing from it: not reassurance that we are working, but
   *  the fact that we stopped and a way to ask again. */
  state: 'pending' | 'failed' | 'tracking-nothing' | 'first-visit' | 'moved' | 'quiet';
  /** Up to SESSION_WATCH_ROWS rows, moved first. Empty while pending and when
   *  nothing is tracked, where the card renders its own frame instead. */
  rows: Array<SessionWatchRow<T>>;
  /** Every bill that moved, not only the ones shown. */
  movedCount: number;
  /** "Showing the 2 most recent of 11 that moved", or '' when the rows already show
   *  everything that moved. Beside two rows, "2 of the 4 moved" is honest because
   *  the reader sees everything the sentence counts; "11 of the 14 moved" is not,
   *  because the two rows read as the whole set. */
  capCaption: string;
  /** The hero's headline. The state line IS the headline — the news is why someone
   *  returns — with the greeting a small eyebrow above it. */
  heroLine: string;
  /** Beside the headline. Never an error colour: pending is calm, not a failure. */
  glyph: 'trend' | 'clock' | 'spinner';
}

type WithActions = { actions?: BillAction[] };

/** The quiet state's headline, in its two subject forms.
 *
 *  Split out because the singular is not a plural with one word swapped: at one
 *  tracked bill the sentence drops the count and changes verb ("has not moved"
 *  rather than "moved"), so a template with a conditional noun cannot express it.
 *  Both forms carry the most-recent-change clause only when a date exists —
 *  `bill_action.action_at` is nullable and the Legislature files undated entries,
 *  so a tracked set with no dated action anywhere is ordinary, not a fault.
 */
export function quietHeadline(trackedCount: number, visitedOn: string, mostRecent: string): string {
  const opening =
    trackedCount === 1
      ? `Your tracked bill has not moved since you last opened the list on ${visitedOn}`
      : `None of your ${trackedCount} tracked bills moved since you last opened the list on ${visitedOn}`;
  return mostRecent ? `${opening} — the most recent change was ${mostRecent}` : opening;
}

/** Build the whole hero + card view model.
 *
 *  `visitedOn` is the reader's previous visit already humanized ("Mar 12"), because
 *  formatting a date is the caller's business and this stays free of the date
 *  helpers. Empty when there is no previous visit.
 */
export function sessionWatch<T extends WithActions>(
  bills: T[],
  lastVisit: LastVisit,
  now: Date,
  visitedOn: string,
  loadFailed = false,
): SessionWatch<T> {
  // Asked, and it came back empty-handed. Checked FIRST: a failed load also has
  // no bills and no last-visit answer, so every state below would otherwise
  // claim one of those absences means something about the reader's bills.
  if (loadFailed) {
    return {
      state: 'failed',
      rows: [],
      movedCount: 0,
      capCaption: '',
      // "just now" is doing real work: it says the failure is this attempt, not a
      // standing fact about their account, which is what makes trying again read
      // as worth doing.
      heroLine: 'We couldn’t check your tracked bills just now',
      glyph: 'clock',
    };
  }

  // Not asked yet. No count, no date, no reassurance — the date is exactly the
  // unknown being fetched, so a hero line naming one would be inventing it.
  if (lastVisit.state === 'not-checked') {
    return {
      state: 'pending',
      rows: [],
      movedCount: 0,
      capCaption: '',
      heroLine: 'Checking your tracked bills for anything that’s moved since you last looked',
      glyph: 'spinner',
    };
  }

  // Tracking nothing is the most common FIRST case and a designed frame, not a
  // stripped one. The copy never says we will tell, notify or email anyone: coming
  // back is the mechanism, and the sentence says so without apologising for it.
  if (bills.length === 0) {
    return {
      state: 'tracking-nothing',
      rows: [],
      movedCount: 0,
      capCaption: '',
      heroLine: 'You’re not tracking any bills yet — track one and its movement shows up here',
      glyph: 'clock',
    };
  }

  const groups = groupTrackedBillsByChange(bills, lastVisit, now);
  // Unreachable: `not-checked` returned above, and it is the only state that
  // produces this. Narrowed rather than asserted, because the union exists to make
  // the caller notice (#1026).
  if (groups.state !== 'grouped') {
    return {
      state: 'pending',
      rows: [],
      movedCount: 0,
      capCaption: '',
      heroLine: 'Checking your tracked bills for anything that’s moved since you last looked',
      glyph: 'spinner',
    };
  }

  // Moved bills lead, then the quiet ones fill the remaining slot, so the card is
  // never emptier than it needs to be.
  const rows: Array<SessionWatchRow<T>> = [
    ...groups.moved.map((entry) => ({ bill: entry.bill, change: entry.change })),
    ...groups.unchanged.map((bill) => ({ bill, change: null })),
  ].slice(0, SESSION_WATCH_ROWS);

  const movedCount = groups.moved.length;
  const shownMoved = rows.filter((row) => row.change !== null).length;
  const capCaption =
    movedCount > shownMoved
      ? `Showing the ${shownMoved} most recent of ${movedCount} that moved`
      : '';

  if (lastVisit.state === 'first-visit') {
    return {
      state: 'first-visit',
      rows,
      movedCount: 0,
      capCaption: '',
      heroLine:
        'This is your first look at your tracked bills, so there is no “since” yet — from now on, anything that moves shows up here',
      glyph: 'clock',
    };
  }

  if (movedCount === 0) {
    const mostRecent = mostRecentChangeLabel(bills);
    return {
      state: 'quiet',
      rows,
      movedCount: 0,
      capCaption: '',
      // Dates the last change rather than reading as empty. The card still lists
      // tracked bills with their latest action, so the page is never blank.
      // Names "your tracked bills" (like the moved/first-visit lines) rather than
      // just "nothing has moved" — this headline has no section above it to supply
      // a subject, and a bare quiet state gives no proof the check actually ran.
      //
      // One tracked bill drops the numeral entirely rather than printing "your 1
      // tracked bill": the digit says with a number what the singular noun beside
      // it already says, and it is the only state where the count adds nothing —
      // "none of 1" is the whole set, so there is no proportion to report.
      heroLine: quietHeadline(bills.length, visitedOn, mostRecent),
      glyph: 'clock',
    };
  }

  return {
    state: 'moved',
    rows,
    movedCount,
    capCaption,
    heroLine: `${movedCount} of your ${bills.length} tracked ${bills.length === 1 ? 'bill' : 'bills'} moved since you last opened the list on ${visitedOn}`,
    glyph: 'trend',
  };
}
