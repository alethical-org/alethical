// The Tracked page's fixed words and the 2 small rules behind its committee list
// (#1943). Kept free of React so every sentence a reader meets here is pinned by
// `__tests__/trackedPage.test.ts`, and so the screen cannot retype one.
//
// The page is two lists. Bills keep their moved / no-change grouping, because a
// bill's record lets the page compute what moved since the reader's last visit.
// Committees get their own list under a heading that promises presence and never
// watching: following a committee is a bookmark, nothing notifies anybody, and a
// committee filed under "no change" would claim a check nobody performs.

import { committeeEyebrow, committeeSlug, registerKindFromEntityType } from './committeeMoney';

/** The h1. One word, because the page now holds 2 kinds of thing. */
export const TRACKED_TITLE = 'Tracked';

/** The line under the h1. No dot: a one-line subtitle is a standalone line
 *  (copy rule C). It says what is here and nothing about what will happen. */
export const TRACKED_SUBHEAD = 'What you are following';

/** The committee list's heading. Mono, uppercase like NO CHANGE above it. */
export const COMMITTEES_HEADING = 'COMMITTEES YOU FOLLOW';

/** Signed in, nothing followed. Two sentences, so both keep their dots. It promises
 *  that a saved thing stays on the list, never that anyone will be told anything. */
export const NOTHING_TRACKED_YET =
  'Nothing tracked yet. Track a bill or a committee and it stays on this list.';

/** The kind label on each card, on for this page only: everywhere else the shared
 *  bill card draws, the list holds one kind and the label would be noise. */
export const KIND_LABEL_BILL = 'BILL';
export const KIND_LABEL_COMMITTEE = 'COMMITTEE';

export const LOADING_TRACKED = 'Loading what you are following';
export const TRACKED_UNAVAILABLE =
  'We couldn’t load your tracked list right now. Please try again in a moment.';

/** What a followed committee needs to draw its card. Mirrors the served row. */
export interface TrackedCommitteeLike {
  registrationNumber: string;
  committeeName: string | null;
  entityType: string | null;
  entitySubType: string | null;
  register: {
    kind: string | null;
    name: string | null;
    office: string | null;
    district: string | null;
  };
}

/** The name on the card: the register's, else the download's, else the number
 *  itself spelled as the committee page spells an unnamed one. Never blank. */
export function trackedCommitteeName(committee: TrackedCommitteeLike): string {
  return (
    committee.register.name ??
    committee.committeeName ??
    `Committee ${committee.registrationNumber}`
  );
}

/** The line under the name: the kind, and for a candidate committee the seat it
 *  registered for, joined by a middle dot. "Candidate committee · Senate District
 *  41". Null when neither the register nor the download names a kind, so the card
 *  prints nothing rather than a guess. */
export function trackedCommitteeSubtitle(committee: TrackedCommitteeLike): string | null {
  const kind = committee.register.kind ?? registerKindFromEntityType(committee.entityType);
  const kindLabel = committeeEyebrow(kind, committee.entitySubType);
  const seat = registeredSeat(kind, committee.register.office, committee.register.district);
  return [kindLabel, seat].filter((part): part is string => Boolean(part)).join(' · ') || null;
}

/** "Senate District 41" for a candidate committee whose register row carries both
 *  the office and the district; the office alone when the district is missing;
 *  nothing for anyone else, because the register states no seat for them. */
function registeredSeat(
  kind: string | null,
  office: string | null,
  district: string | null,
): string | null {
  if (kind !== 'candidate_committee' || !office) return null;
  if (!district) return office;
  if (office === 'House' || office === 'Senate') return `${office} District ${district}`;
  return `${office} · District ${district}`;
}

/** The address part naming this committee, `<name>-<registration number>`, spelled
 *  as the committee page spells it so the link lands on the canonical address. */
export function trackedCommitteeSlug(committee: TrackedCommitteeLike): string {
  return committeeSlug(trackedCommitteeName(committee), committee.registrationNumber);
}

/** The card's destination: the committee's own money page. */
export function trackedCommitteePath(committee: TrackedCommitteeLike): string {
  return `/money/committees/${trackedCommitteeSlug(committee)}`;
}

/** Whether the page has anything at all to list. */
export function hasNothingTracked(billCount: number, committeeCount: number): boolean {
  return billCount === 0 && committeeCount === 0;
}
