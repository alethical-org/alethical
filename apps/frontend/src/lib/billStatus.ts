/**
 * A bill's status label and the completion of a status or action title that the
 * source leaves hanging on a preposition.
 *
 * `data/api.ts` is in the program every page downloads before anything draws, and
 * it needs only these 6 names from the bill page. Importing them from
 * `lib/billDetail.ts` put the whole bill page's logic, and the bill-text anchors
 * behind it, into that first download. This module imports nothing.
 * `lib/billDetail.ts` re-exports every name here, so the bill page, its tests and
 * `api/page.ts` import them from where they always did.
 */

// Human status label shown first in WHERE IT STANDS. Keeps the product's plain
// vocabulary ("In Committee", "Signed into Law", "Vetoed").
// status_key → the product's display label. One map, so a bill's own status pill
// and a "See also" row naming that bill as a target read identically (#757). Lives
// here rather than in `data/api.ts` so the first server response can print the same
// label without loading the whole data layer (#1325).
export const STATUS_LABELS: Record<string, string> = {
  proposed: 'Introduced',
  in_committee: 'In Committee',
  passed_house: 'Passed House',
  passed_senate: 'Passed Senate',
  passed_both_chambers: 'Passed Both Chambers',
  signed_into_law: 'Signed into Law',
  vetoed: 'Vetoed',
};

export function statusLabel(statusKey?: string | null, fallback?: string | null): string {
  return (statusKey && STATUS_LABELS[statusKey]) || fallback || 'Status unavailable';
}

// The source writes a referral as a phrase plus a separate value: the text ends on
// "referred to" / "re-referred to" and the committee arrives in committee_name.
// Shared with the API mapping (data/api.ts), which applies the same completion to
// the mobile timeline's labels — one regex so the two can't drift apart.
export const TRAILING_REFERRAL = /[,\s]*(?:and\s+)?(?:re-?)?refer(?:red)?\s+to\s*$/i;

// Same shape, different verb: a deadline or interim-disposition return hands the
// bill back to a committee named in committee_name ("Rule 47, returned to").
export const TRAILING_RETURN = /[,\s]*(?:bill\s+)?return(?:ed)?\s+to\s*$/i;

// STANDING RULE: no action row ends on a preposition. Every rule above that builds
// a title from a phrase plus a value spells out its own fallback, and this is the
// net under all of them (including the raw-label fallback): a dangling title takes
// the source's value when there is one, and otherwise loses the clause that was
// waiting on that value — never the preposition on its own. Both normalizers run
// it: this file's timeline titles, and the API mapping's labels (data/api.ts).
const TRAILING_PREPOSITION = /[,\s]+(?:to|for|with|from|by|of|in|on|and)\s*$/i;

export function completeDanglingTitle(title: string, target: string): string {
  if (!TRAILING_PREPOSITION.test(title)) return title;
  if (target) return `${title} ${target}`;
  const withoutPreposition = title.replace(TRAILING_PREPOSITION, '');
  const lastClause = withoutPreposition.lastIndexOf(',');
  const kept =
    lastClause > 0
      ? withoutPreposition.slice(0, lastClause)
      : withoutPreposition.replace(/\s+\S+$/, '');
  const dropped = kept.trim() || withoutPreposition.trim();
  // Dropping one clause can uncover another dangling word: "Withdrawn and
  // re-referred to" loses "re-referred" and lands on "Withdrawn and", which breaks
  // the same rule this function exists to enforce. So repeat until the tail is a
  // real word. Only reachable when the record has no target to name, which is why
  // it went unnoticed — every production referral carries its committee (#812).
  return dropped === title ? dropped : completeDanglingTitle(dropped, '');
}

// The clerk's two referral phrasings, rewritten the way a person says them. The
// home page's Bill Activity card has read them this way all along; keeping the map
// here lets the same rewrite carry the committee's real name (below) instead of
// stopping at the generic word.
const STATUS_PLAIN_STEM: Record<string, string> = {
  'introduction and first reading, referred to': 'Introduced and referred to',
  'referred to': 'Referred to',
};

// The same standing rule, applied to the bill's CURRENT STATUS rather than to a
// timeline row (#812). `bill.current_status` is the source's action text verbatim,
// so it inherits the same dangling preposition — 6,078 of 10,517 production bills
// end on one — even though the matching action row carries the committee in
// committee_name.
//
// This is a narrower fix than the raw count suggests, because every surface that
// builds its latest-action line from the ACTIONS already completes the phrase
// (`latestActionEntry`, since #599): over 100 real bills, 74 had a dangling status
// and 0 produced a dangling line. What this changes is the surfaces that read the
// STATUS instead — the home page's Bill Activity card, and the latest-action rail's
// fallback for a bill whose actions are absent. There, "Referred to committee"
// becomes "Referred to Judiciary and Public Safety": complete either way, but the
// second names the committee we already hold rather than a generic word.
//
// Nothing is inferred. The committee is looked up by matching the status against
// the action rows the same payload already carries. A status with no matching
// action keeps today's generic "committee" for the two known referral wordings, and
// any other wording falls through to completeDanglingTitle's own fallback, which
// drops the unfinished clause rather than name a target the record does not have.
export function completeStatusText(
  status: string | null | undefined,
  actions?: readonly { action_text?: string | null; committee_name?: string | null }[] | null,
): string | undefined {
  const text = (status || '').trim();
  if (!text) return undefined;
  if (!TRAILING_PREPOSITION.test(text)) return text;
  const key = text.toLowerCase();
  const match = (actions || []).find(
    (action) => (action.action_text || '').trim().toLowerCase() === key,
  );
  const committee = (match?.committee_name || '').trim();
  const stem = STATUS_PLAIN_STEM[key];
  if (stem) return completeDanglingTitle(stem, committee || 'committee');
  return completeDanglingTitle(text, committee);
}
