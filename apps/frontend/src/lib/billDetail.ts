import { Bill, BillAction, BillVersion, IndividualVote, VoteEvent } from '../data/types';

// Shared logic for the redesign Bill Detail page (screens/redesign/BillDetailScreen).
// Kept framework-free (pure functions) so it is unit-testable and reused by the tab
// components. Design intent: design_handoff_bill_profile_web / NEXT-bill-detail-spec.md.

export type StageTone = 'neutral' | 'green' | 'vetoed';

// 5-stage legislative progress derived from the status text — client-side so the
// rail's WHERE IT STANDS bar always agrees with the status label (same rule as the
// list card's ProgressBar, components/search/BillResultCard.tsx billStage).
// Stages: Introduced 0 · In Committee 1 · Passed House 2 · Passed Senate 3 · Signed 4.
export function billStage(status: string): { index: number; tone: StageTone } {
  const s = (status || '').toLowerCase();
  if (s.includes('veto')) return { index: 4, tone: 'vetoed' };
  if (s.includes('signed') || s.includes('law') || s.includes('enacted'))
    return { index: 4, tone: 'green' };
  if (s.includes('senate')) return { index: 3, tone: 'neutral' };
  if (s.includes('house')) return { index: 2, tone: 'neutral' };
  if (s.includes('committee')) return { index: 1, tone: 'neutral' };
  return { index: 0, tone: 'neutral' };
}

// Spell out the party code for the rail's labeled "Party" field. Independent is
// the fallback so an edge-case member never breaks the label (spec §Chief author).
export function partyFull(code: string | undefined): string {
  const c = (code || '').toUpperCase();
  if (c === 'DFL' || c === 'D') return 'Democratic-Farmer-Labor';
  if (c === 'R' || c === 'REPUBLICAN') return 'Republican';
  return 'Independent';
}

// SF -> Senate, HF -> House. Used for the rail section label ("SENATE BILL" /
// "HOUSE BILL"), which teaches SF=Senate / HF=House (spec §Rail "THIS BILL").
export function chamberBillLabel(identifier: string): string {
  const prefix = (identifier || '').trim().slice(0, 2).toUpperCase();
  if (prefix === 'SF') return 'SENATE BILL';
  if (prefix === 'HF') return 'HOUSE BILL';
  return 'BILL';
}

// Human status label shown first in WHERE IT STANDS. Keeps the product's plain
// vocabulary ("In Committee", "Signed into Law", "Vetoed").
export function stageLabel(status: string): string {
  const s = (status || '').toLowerCase();
  if (s.includes('veto')) return 'Vetoed';
  if (s.includes('signed') || s.includes('enacted')) return 'Signed into Law';
  if (s.includes('law')) return 'Signed into Law';
  if (s.includes('passed senate')) return 'Passed Senate';
  if (s.includes('passed house')) return 'Passed House';
  if (s.includes('committee')) return 'In Committee';
  if (s.includes('introduced') || s.includes('proposed')) return 'Introduced';
  return status || 'Introduced';
}

// --- Actions: dot taxonomy (spec §Dot taxonomy — by what the action DOES) ---
// green = consequential legal state-change (signed / effective / enacted);
// red = failed vote or not-adopted amendment / veto;
// vote = a recorded roll-call vote (has a tally / is a passage/reading vote);
// plain = procedural step (introduced, referral, committee report, presented).
export type DotKind = 'green' | 'red' | 'vote' | 'plain';

export function dotKind(description: string, hasTally: boolean): DotKind {
  const s = (description || '').toLowerCase();
  if (s.includes('veto')) return 'red';
  if (
    s.includes('not adopted') ||
    s.includes('failed') ||
    s.includes('rejected') ||
    s.includes('lost')
  )
    return 'red';
  if (
    s.includes('signed') ||
    s.includes('effective') ||
    s.includes('enacted') ||
    s.includes('chapter') ||
    s.includes('became law')
  )
    return 'green';
  if (hasTally) return 'vote';
  // Floor passage / reading / concurrence / repassage are recorded roll-call votes
  // in MN practice (black dot). Amendment "adopted" is often a voice vote — leave
  // it procedural unless it carries a tally (handled above).
  if (
    s.includes('third reading') ||
    s.includes('read the third') ||
    s.includes('final passage') ||
    s.includes('repass') ||
    s.includes('concur') ||
    /\bpassed\b/.test(s) ||
    s.includes('was passed')
  )
    return 'vote';
  return 'plain';
}

// Human eyebrow "SENATE · 2025–2026 LEGISLATIVE SESSION". The session biennium is
// derived from the bill id's year segment (94-2025-SF334 → 2025 → 2025–2026), since
// the detail payload carries no session label ("legislative" kept — educational).
export function bienniumEyebrow(chamber: string, billId: string): string {
  const m = (billId || '').match(/^\d+-(\d{4})-/);
  const year = m ? Number(m[1]) : NaN;
  const ch = (chamber || '').toUpperCase();
  if (!Number.isNaN(year)) {
    const start = year % 2 === 1 ? year : year - 1;
    return `${ch} · ${start}–${start + 1} LEGISLATIVE SESSION`;
  }
  return `${ch} · LEGISLATIVE SESSION`;
}

// Prefix a bare author surname with the chamber title (Sen./Rep.), matching the
// design's "Sen. Omar Fateh" treatment. Left untouched if a title is already there.
export function authorDisplayName(name: string, chamber: string | undefined): string {
  const n = (name || '').trim();
  if (!n || /^(sen\.|rep\.|senator|representative)\b/i.test(n)) return n;
  const title = chamber === 'Senate' ? 'Sen.' : chamber === 'House' ? 'Rep.' : '';
  return title ? `${title} ${n}` : n;
}

// The bill-author sponsorship rows carry a placeholder district ("S-unknown" /
// "*-unknown", the two-row roster/author topology) — treat those as unknown so the
// rail hides the field instead of showing a broken value.
export function isKnownDistrict(district: string | undefined): boolean {
  return !!district && !/unknown/i.test(district);
}

// Format a sponsor's district for the rail's CHIEF AUTHOR card. The served value is
// the district *label* ("District 51" / "District 15B"); the design shows the
// chamber district code — "SD 51" for a senator, the bare "15B" for a House member
// (House districts already carry the A/B letter, Senate districts are numeric). When
// the member's represented city is ingested (#551) it wraps the code as
// "Bloomington (SD 51)" / "Kenyon (15B)"; absent a city, the code alone is shown, so
// the card never displays a guessed city (grounded-answers). Falls back to the raw
// label when no code can be parsed, so nothing ever breaks.
export function formatAuthorDistrict(
  district: string | undefined,
  chamber: string | undefined,
  city?: string | undefined,
): string {
  const label = (district || '').trim();
  const match = label.match(/(\d+[A-Za-z]?)/);
  if (!match) return label;
  const code = match[1].toUpperCase();
  let formatted: string;
  if (chamber === 'Senate') formatted = `SD ${code}`;
  else if (chamber === 'House') formatted = code;
  else return label;
  const trimmedCity = (city || '').trim();
  return trimmedCity ? `${trimmedCity} (${formatted})` : formatted;
}

// Parse a date string that may be ISO ("2025-05-30"), a display date
// ("MAY 30, 2025" / "May 30, 2025"), or empty. Returns null when unparseable.
export function parseActionDate(value: string | undefined | null): Date | null {
  if (!value) return null;
  const iso = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) {
    const d = new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
    return isNaN(d.getTime()) ? null : d;
  }
  const d = new Date(value);
  return isNaN(d.getTime()) ? null : d;
}

// Order actions newest-first for the Actions timeline, keeping DATELESS rows
// adjacent to their sequence neighbors instead of stranding them at the top or
// bottom. Used by both the web (ActionsTab) and mobile (BillDetailScreen)
// timelines so they stay in sync.
//
// The API delivers actions grouped by chamber, each group ascending by
// action_number (backend Bill.actions order_by). action_number is per-chamber,
// so a DROP in actionNumber marks a new chamber. Dated rows sort by their own
// date. A dateless row inherits the date of the nearest dated row that PRECEDES
// it in its chamber's sequence (or the nearest FOLLOWING one, if it leads the
// chamber) — e.g. a "conference committee discharged" step or the "Effective
// date" milestone lands in the right day-cluster rather than at the epoch floor.
// The inherited date is used ONLY for ordering; the row's date column stays
// blank — we never fabricate a displayed date. A hair (+1ms) lifts a dateless
// row just above its same-day cluster, matching reverse-chron order (it happened
// after the dated row it follows). Rows with equal keys keep source order.
export function orderActionsForTimeline<T extends BillAction>(actions: T[]): T[] {
  const n = actions.length;
  const times = actions.map((a) => parseActionDate(a.date)?.getTime() ?? null);
  const key = new Array<number>(n).fill(NaN);

  // Forward pass: carry the last real date seen within the current chamber.
  let lastDated: number | null = null;
  let prevNum = Number.NEGATIVE_INFINITY;
  for (let i = 0; i < n; i++) {
    const num = actions[i].actionNumber ?? i;
    if (num < prevNum) lastDated = null; // action_number dropped → new chamber
    prevNum = num;
    if (times[i] != null) {
      key[i] = times[i]!;
      lastDated = times[i]!;
    } else if (lastDated != null) {
      key[i] = lastDated + 1; // just above its day-cluster (it happened after)
    }
  }
  // Backward pass: a dateless row leading its chamber (no dated row precedes it)
  // borrows the nearest FOLLOWING date, minus a hair (it happened before it).
  let nextDated: number | null = null;
  let nextNum = Number.POSITIVE_INFINITY;
  for (let i = n - 1; i >= 0; i--) {
    const num = actions[i].actionNumber ?? i;
    if (num > nextNum) nextDated = null; // walking back into an earlier chamber
    nextNum = num;
    if (times[i] != null) nextDated = times[i]!;
    else if (Number.isNaN(key[i])) key[i] = nextDated != null ? nextDated - 1 : 0;
  }

  return actions
    .map((a, i) => ({ a, i, k: key[i] }))
    .sort((x, y) => y.k - x.k || x.i - y.i) // newest first; stable by source order
    .map((e) => e.a);
}

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

// Uppercase mono date for the timeline / meta ("MAY 30, 2025"). Falls back to the
// raw string when it can't be parsed so nothing is ever dropped silently.
export function formatMonoDate(value: string | undefined | null): string {
  const d = parseActionDate(value);
  if (!d) return (value || '').toUpperCase();
  return `${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}

// Mixed-case date for prose ("Aug 1, 2025").
export function formatNiceDate(value: string | undefined | null): string {
  const d = parseActionDate(value);
  if (!d) return value || '';
  const m = MONTHS[d.getMonth()];
  return `${m.charAt(0)}${m.slice(1).toLowerCase()} ${d.getDate()}, ${d.getFullYear()}`;
}

// PASSED / FAILED from the roll's result text. Motion outcome, not bill outcome —
// a passed roll on a later-vetoed bill still reads PASSED (spec §Vetoed bills).
export function rollPassed(result: string): boolean {
  const s = (result || '').toLowerCase();
  if (s.includes('not') || s.includes('fail') || s.includes('lost') || s.includes('reject'))
    return false;
  return s.includes('pass') || s.includes('adopt') || s.includes('prevail') || s.includes('agree');
}

// --- Roll-call party blocks + crossover (spec §Votes) ---
// Production-correct derivation from REAL per-member votes joined to the roster's
// party. Crossover = a member voting against their OWN party's majority on THAT
// vote (majority computed per party from the actual votes, never hardcoded).

export type MemberVote = {
  legislatorId: string;
  name: string;
  party: 'DFL' | 'R' | 'I';
  vote: 'YES' | 'NO' | 'ABSENT';
  crossover: boolean;
};

export type PartyBlock = {
  party: 'DFL' | 'R' | 'I';
  label: string;
  seats: number;
  yes: number;
  no: number;
  absent: number;
  members: MemberVote[];
};

const PARTY_LABEL: Record<'DFL' | 'R' | 'I', string> = {
  DFL: 'Democratic-Farmer-Labor',
  R: 'Republican',
  I: 'Independent',
};

function normalizeParty(p: string | undefined): 'DFL' | 'R' | 'I' {
  const c = (p || '').toUpperCase();
  if (c === 'R' || c === 'REPUBLICAN') return 'R';
  if (c === 'DFL' || c === 'D' || c === 'DEMOCRAT' || c.includes('DEMOCRAT')) return 'DFL';
  return 'I';
}

// Group per-member votes into party blocks and mark crossovers against each
// party's own majority. Party + name are carried inline on each roll-call record
// (the /legislators list doesn't serve party), so no roster join is needed.
// Returns blocks ordered DFL, Republican, then any Independents (only when non-empty).
export function buildPartyBlocks(votes: IndividualVote[]): PartyBlock[] {
  const members: MemberVote[] = votes.map((v) => ({
    legislatorId: v.legislatorId,
    name: v.name || 'Unknown',
    party: normalizeParty(v.party),
    vote: v.vote,
    crossover: false,
  }));

  const parties: Array<'DFL' | 'R' | 'I'> = ['DFL', 'R', 'I'];
  const blocks: PartyBlock[] = parties.map((party) => {
    const mem = members.filter((m) => m.party === party);
    const yes = mem.filter((m) => m.vote === 'YES').length;
    const no = mem.filter((m) => m.vote === 'NO').length;
    const absent = mem.filter((m) => m.vote === 'ABSENT').length;
    // Majority side among this party's *voting* members; ties → no crossover flags.
    const majority: 'YES' | 'NO' | null = yes > no ? 'YES' : no > yes ? 'NO' : null;
    mem.forEach((m) => {
      if (majority && (m.vote === 'YES' || m.vote === 'NO') && m.vote !== majority) {
        m.crossover = true;
      }
    });
    return {
      party,
      label: PARTY_LABEL[party],
      seats: mem.length,
      yes,
      no,
      absent,
      members: mem.sort((a, b) => a.name.localeCompare(b.name)),
    };
  });

  // DFL + Republican always shown when present; Independents only when non-empty.
  return blocks.filter((b) => (b.party === 'I' ? b.seats > 0 : true));
}

// Dev-only sum-check (spec §Validation guard): each block's Yes+No+absent must
// equal its seats, and the party Yes totals must equal the recorded Yea. Surfaces
// impossible combinations instead of silently rendering a bad split.
export function validateRoll(
  blocks: PartyBlock[],
  breakdownYes: number,
  breakdownNo: number,
): void {
  if (!__DEV__) return;
  const yes = blocks.reduce((n, b) => n + b.yes, 0);
  const no = blocks.reduce((n, b) => n + b.no, 0);
  if (yes !== breakdownYes || no !== breakdownNo) {
    // eslint-disable-next-line no-console
    console.warn('[bill-detail] roll split mismatch', {
      blockYes: yes,
      blockNo: no,
      recordedYes: breakdownYes,
      recordedNo: breakdownNo,
    });
  }
}

// Does the bill's status make it enacted law (state-aware official-link wording)?
export function isLaw(status: string): boolean {
  const s = (status || '').toLowerCase();
  return s.includes('signed') || s.includes('enacted') || s.includes('law');
}

// State-aware document-link label (spec §Official-link naming rules). Verb is
// always "Read"; "Bill overview" is the only status-page link (owned elsewhere).
export function readLabel(status: string): string {
  return isLaw(status) ? 'Read the full law' : 'Read the bill text';
}

// First sentence of a block of prose (used for card teasers).
export function firstSentence(text: string | null | undefined): string {
  const s = (text ?? '').trim();
  if (!s) return '';
  const m = s.match(/^.*?[.!?](?=\s|$)/);
  return (m ? m[0] : s).trim();
}

// Present an AI bill summary as a clean, plain-language line: drop the leading
// bill-code / "The bill" preamble (the identifier already shows in the amber
// badge) and remove Minnesota Statutes citations, which read as legalese in a
// short summary (grounded-answers: bill summaries are plain-language, with no
// bill-number prefix and no statute citations). Conservative by design — it
// strips only those two things rather than re-authoring the sentence, so it
// can't introduce a claim the source didn't make. Pass `firstSentenceOnly` for
// one-line teasers (e.g. the legislator profile's chief-authored bill cards).
export function plainBillSummary(
  text: string | null | undefined,
  opts: { firstSentenceOnly?: boolean } = {},
): string {
  let s = (text ?? '').trim();
  if (!s) return '';
  if (opts.firstSentenceOnly) s = firstSentence(s);

  // 1. Remove Minnesota Statutes citations, absorbing a leading connective
  //    ("in / to / under / of / by amending / amends …") so a clause like
  //    "amends Minnesota Statutes …, section 297A.67, subdivision 40, to
  //    exempt …" collapses to "to exempt …".
  s = s.replace(
    /(?:\b(?:in|to|under|of|by amending|amending|amends|amend|the)\s+)*Minnesota Statutes\b(?:,?\s*\d{4})?(?:,?\s*(?:sections?|chapters?)\s+[\dA-Za-z.]+(?:\s+to\s+[\dA-Za-z.]+)?(?:,?\s*subdivisions?\s+[\dA-Za-z.]+)?(?:,?\s*paragraphs?\s+\([^)]*\))?)*/gi,
    ' ',
  );
  // Bare "section 297A.67, subdivision 40" without a "Minnesota Statutes" lead.
  s = s.replace(
    /,?\s*\b(?:sections?|chapters?)\s+\d[\dA-Za-z.]*(?:,?\s*subdivisions?\s+[\dA-Za-z.]+)?/gi,
    ' ',
  );

  // 2. Drop a leading bill-code preamble: optional "The/This bill|act", then an
  //    optional "HF/SF [No.] ####" code. Run the code strip twice so a
  //    "The bill HF 577 appropriates …" (code between "bill" and the verb) is
  //    fully removed once the "The bill" lead is gone.
  s = s.replace(/^\s*(?:the|this)\s+(?:bill|act|legislation)\s+/i, '');
  for (let i = 0; i < 2; i++) {
    s = s.replace(
      /^\s*(?:h\.?\s?f\.?|s\.?\s?f\.?|h\.?\s?r\.?|s\.?\s?r\.?)\s*(?:no\.?\s*)?\d+\s*/i,
      '',
    );
  }

  // 3. Clean artifacts the strips can leave, then collapse whitespace.
  s = s
    .replace(/\bamend(?:s|ing)?\s+to\b/gi, 'to') // "amends to exempt" → "to exempt"
    .replace(/^\s*(?:,|;|:|\bto\b)\s+/i, '') // orphaned leading connective
    .replace(/\s+([,.;:])/g, '$1')
    .replace(/,\s*,/g, ',')
    .replace(/\(\s*\)/g, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/^[\s,;:]+/, '')
    .trim();

  // 4. Capitalize the leading word (the verb now heads the sentence).
  if (s) s = s.charAt(0).toUpperCase() + s.slice(1);
  return s;
}

// Clean AI key points for display the same way plainBillSummary cleans a summary:
// strip Minnesota Statutes citations and any bill-number prefix so no key point
// reads as a bare "Amends Minnesota Statutes 2024, section 120B.123 …" line
// (grounded-answers: key points are plain-language statements of what the bill
// does — extends rule 9 beyond the summary). A point that is ONLY a citation has no
// plain-language effect left once the citation is stripped, so it collapses to
// empty and is dropped — we never fabricate the effect the source didn't state.
// The durable fix is at ingestion (the enrichment prompt); this is the interim
// display cleaner, mirroring plainBillSummary's role for summaries.
export function plainKeyPoints(points: string[] | undefined): string[] {
  return (points ?? [])
    .map((point) => plainBillSummary(point))
    .filter((point) => /[a-z]/i.test(point));
}

// The chief author sponsor (role chief_author), else the first sponsor.
export function chiefAuthor(bill: Bill) {
  const sponsors = bill.sponsors ?? [];
  return sponsors.find((s) => s.role === 'chief_author') ?? sponsors[0];
}

// Count of co-authors: prefer the served coAuthorCount, else count co_author roles.
export function coAuthorCount(bill: Bill): number {
  if (typeof bill.coAuthorCount === 'number') return bill.coAuthorCount;
  return (bill.sponsors ?? []).filter((s) => s.role === 'co_author').length;
}

// Link an action row to the recorded roll call it reports, by matching the action's
// tally (roll_call_text, e.g. "62-0") to a VoteEvent's yes–no. Returns the vote
// index or null. Tally-matching is reliable even though VoteEvent.occurred_at is
// often null (date-matching would fail); an action whose tally has no ingested
// VoteEvent (e.g. a roll the corpus didn't capture) correctly returns null, so
// "View votes →" only appears where there is a roll to open.
export function rollIndexForAction(action: BillAction, votes: VoteEvent[]): number | null {
  if (!votes.length) return null;
  const tally = (action.tally || '').replace(/[–—]/g, '-').replace(/\s/g, '');
  if (!tally) return null;
  const i = votes.findIndex((v) => `${v.breakdown.yes}-${v.breakdown.no}` === tally);
  return i >= 0 ? i : null;
}

// --- Versions tab ordering (spec §Versions) ---

// The bill's actual introduction date, taken from the earliest "Introduction and
// first reading" action across chambers. The introduced text version's own
// document_date is unreliable — the source feed sometimes stamps it with a later
// revision date (HF 1141's introduced row arrived dated months after the fact) —
// so "As introduced" binds to this action date instead.
export function introductionDate(actions: BillAction[]): string | null {
  const dates = actions
    .filter((a) => /^introduction and first reading/i.test(a.description))
    .map((a) => a.date)
    .filter((d): d is string => !!d)
    .sort(); // ISO YYYY-MM-DD sorts chronologically
  return dates[0] ?? null;
}

// Order the Versions tab strictly newest-first by each version's date, de-duplicated
// by friendly label (the feed sometimes emits two rows for one stage — e.g. the
// "current" alias pointer and the real engrossment file both read "1st unofficial
// engrossment"). Binds the real introduction date onto "As introduced" first so it
// lands as the oldest row.
//
// Dedup keeps ONE row per label, preferring the real record over the API's
// `version_code="current"` alias pointer: the pointer's document_date is a stale
// "last-touched" stamp, not the real posting date, so keeping it renders the wrong
// date and sorts the row too high (#475). Only when a label has no real row does
// the pointer survive — it's then the sole representation of that text. Among
// equally-preferred rows, the earliest date wins (the real posting date).
export function orderBillVersions(versions: BillVersion[], actions: BillAction[]): BillVersion[] {
  const intro = introductionDate(actions);
  const dated = intro
    ? versions.map((v) => (/^as introduced$/i.test(v.label) ? { ...v, date: intro } : v))
    : versions;

  const best = new Map<string, BillVersion>();
  for (const v of dated) {
    const key = v.label.toLowerCase();
    const incumbent = best.get(key);
    best.set(key, incumbent ? preferredVersion(v, incumbent) : v);
  }

  return [...best.values()].sort((a, b) => {
    const da = parseActionDate(a.date)?.getTime() ?? -Infinity;
    const db = parseActionDate(b.date)?.getTime() ?? -Infinity;
    return db - da; // newest first; undated rows sink to the bottom
  });
}

// Pick the row to keep between two same-label versions: a real record beats the
// "current" alias pointer; otherwise the earliest-dated row wins (its date is the
// real posting date, and undated rows lose so a dated real row is kept).
function preferredVersion(a: BillVersion, b: BillVersion): BillVersion {
  if (!!a.isCurrentPointer !== !!b.isCurrentPointer) {
    return a.isCurrentPointer ? b : a;
  }
  const ta = parseActionDate(a.date)?.getTime() ?? Infinity;
  const tb = parseActionDate(b.date)?.getTime() ?? Infinity;
  return ta <= tb ? a : b;
}

// A neutral track marker for versions that aren't official engrossments, so the
// strict newest-first list doesn't read as one broken ordinal sequence: unofficial
// engrossments and the conference-committee report each carry their own numbering
// (revisor lists them in separate sections), so an unofficial "1st" can legitimately
// sort above an official "2nd". Official engrossments, "As introduced", and the
// Session Law row get no tag (null). Rendered as neutral grey meta, never amber.
export function versionTrackTag(label: string): 'UNOFFICIAL' | 'CONFERENCE' | null {
  if (/unofficial/i.test(label)) return 'UNOFFICIAL';
  if (/conference committee report/i.test(label)) return 'CONFERENCE';
  return null;
}
