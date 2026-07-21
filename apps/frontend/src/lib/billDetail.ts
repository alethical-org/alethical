import { Bill, BillAction, IndividualVote, Legislator, VoteEvent } from '../data/types';

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

// Join per-member votes to legislator party/name, group into party blocks, and
// mark crossovers against each party's own majority. Returns blocks ordered
// DFL, Republican, then any Independents (only when non-empty).
export function buildPartyBlocks(
  votes: IndividualVote[],
  legislatorsById: Map<string, Legislator>,
): PartyBlock[] {
  const members: MemberVote[] = votes.map((v) => {
    const leg = legislatorsById.get(v.legislatorId);
    return {
      legislatorId: v.legislatorId,
      name: leg?.shortName || leg?.name || 'Unknown',
      party: normalizeParty(leg?.party),
      vote: v.vote,
      crossover: false,
    };
  });

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

// Try to link an action row to a recorded roll call by matching date + motion
// wording, so "View votes →" can deep-open the right roll. Returns the vote index
// or null. Best-effort (frontend BillAction has no roll_call_text — #future).
export function rollIndexForAction(action: BillAction, votes: VoteEvent[]): number | null {
  if (!votes.length) return null;
  const aDate = parseActionDate(action.date);
  const desc = (action.description || '').toLowerCase();
  // Only passage-type actions carry a recorded roll call.
  const passageAction =
    /third reading|read the third|final passage|repass|concur|\bpassed\b|was passed/.test(desc);
  if (!passageAction) return null;
  const share = (a: string, b: string, kws: string[]) =>
    kws.some((k) => a.includes(k) && b.includes(k));
  let best: number | null = null;
  votes.forEach((v, i) => {
    const vDate = parseActionDate(v.date);
    const sameDay =
      aDate &&
      vDate &&
      aDate.getFullYear() === vDate.getFullYear() &&
      aDate.getMonth() === vDate.getMonth() &&
      aDate.getDate() === vDate.getDate();
    if (!sameDay) return;
    const motion = (v.motion || '').toLowerCase();
    const overlaps =
      share(desc, motion, ['third', 'concur', 'passage', 'repass', 'final']) ||
      (/\bpassed\b/.test(desc) && /pass/.test(motion)) ||
      best === null; // same-day passage action → link even if wording differs
    if (overlaps) best = i;
  });
  return best;
}
