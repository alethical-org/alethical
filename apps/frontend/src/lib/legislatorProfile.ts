import { Bill, LegislativeService, LegislatorVote } from '../data/types';

// Shared logic for the Legislator Profile screens (redesign/LegislatorProfileWebScreen
// + redesign/LegislatorProfileMobileScreen), so the web and mobile layouts stay in
// sync. Pure functions, unit-testable.

// Official title form: "Sen. Omar Fateh" / "Rep. Patty Acomb". The served name is
// inconsistent ("Senator Omar Fateh", "Patty Acomb"), so strip any title it already
// carries before prefixing the chamber's abbreviation. Shared because four surfaces
// print this exact name — both profile screens, the tags in the first server
// response, and the snapshot inside it — and they must not drift (#1325).
export function legislatorDisplayName(name: string, chamber: string | undefined): string {
  const bare = (name || '').replace(/^(sen\.|senator|rep\.|representative)\s+/i, '').trim();
  const title = chamber === 'Senate' ? 'Sen.' : chamber === 'House' ? 'Rep.' : '';
  return title ? `${title} ${bare}` : bare;
}

/** Chamber and district as the profile prints it, e.g. `House District 62A`. */
export function legislatorDistrictLine(
  chamber: string | undefined,
  district: string | null | undefined,
): string {
  return district ? `${chamber ?? ''} District ${district}`.trim() : (chamber ?? '');
}

export interface LegislatorServiceHistorySource {
  term?: number | null;
  periods: Array<{
    chamber: string;
    initial_year: number;
    reelection_years: number[];
  }>;
}

function serviceTermOrdinal(value: number): string {
  const mod100 = value % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${value}th`;
  if (value % 10 === 1) return `${value}st`;
  if (value % 10 === 2) return `${value}nd`;
  if (value % 10 === 3) return `${value}rd`;
  return `${value}th`;
}

/**
 * Format the official election history once for the API mapper, both profile
 * layouts, and the first-response snapshot (#486, #1405).
 */
export function legislativeServiceFromHistory(
  history?: LegislatorServiceHistorySource | null,
): LegislativeService | null {
  if (!history || history.periods.length === 0) return null;
  return {
    lines: history.periods.map((period) => {
      const chamber = period.chamber.toLowerCase() === 'house' ? 'House' : 'Senate';
      const elected = period.reelection_years.length
        ? `${period.initial_year}, re-elected ${period.reelection_years.join(', ')}`
        : `${period.initial_year}`;
      return { chamber, label: `Elected to the ${chamber}`, elected };
    }),
    term: history.term != null ? serviceTermOrdinal(history.term) : null,
  };
}

// The House member-page office blob (already de-cruffed in the API mapper) can lead
// with a leadership title — "Assistant Republican Leader", "DFL Deputy Floor Leader",
// "Speaker of the House" — instead of an address line. Peel a leading title off so it
// renders in its own labeled row, never as line one of the mailing address. A title
// carries no digits (address lines do: room number, ZIP) and is short, which keeps a
// real address line from matching.
export function splitOfficeAddress(value: string): { leadership: string | null; address: string } {
  const lines = value.split('\n');
  const first = (lines[0] ?? '').trim();
  const looksLikeTitle =
    first.length > 0 &&
    first.length <= 60 &&
    !/\d/.test(first) &&
    (/\b(leader|whip)\b/i.test(first) || /^(speaker|president)\b/i.test(first));
  if (looksLikeTitle) {
    return { leadership: first, address: lines.slice(1).join('\n').trim() };
  }
  return { leadership: null, address: value };
}

// Starter chips for the Ask box, built from the issues THIS member works on (their
// chief bills' policy areas), phrased as topic questions the grounded router actually
// answers (topic_bills). Never person- or vote-scoped — those refuse or deflect today
// (no person-scoped answer path, #484), which grounded-answers rule 2 forbids for
// chips. Padded with known-answerable defaults so a thin record still yields real
// chips.
export function buildAskChips(bills: Bill[]): string[] {
  const areas: string[] = [];
  for (const bill of bills) {
    for (const area of bill.aiAnalysis?.policyAreas ?? []) {
      const clean = area.trim();
      if (clean && !areas.some((a) => a.toLowerCase() === clean.toLowerCase())) areas.push(clean);
    }
  }
  const chips = areas.slice(0, 3).map((a) => `What bills address ${a.toLowerCase()} this session?`);
  const fallbacks = [
    'What bills address education this session?',
    'What bills address taxes this session?',
    'What bills address public safety this session?',
  ];
  for (const f of fallbacks) {
    if (chips.length >= 3) break;
    if (!chips.some((c) => c.toLowerCase() === f.toLowerCase())) chips.push(f);
  }
  return chips.slice(0, 3);
}

export function legislatorVoteLabel(value: LegislatorVote['vote']): string {
  switch (value) {
    case 'yes':
      return 'Voted Yes';
    case 'no':
      return 'Voted No';
    case 'absent':
      return 'Absent';
    case 'excused':
      return 'Excused';
    case 'present':
      return 'Present';
    case 'abstain':
      return 'Abstained';
  }
}
