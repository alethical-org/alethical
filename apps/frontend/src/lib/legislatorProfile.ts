import { Bill } from '../data/types';

// Shared logic for the Legislator Profile screens (redesign/LegislatorProfileWebScreen
// + redesign/LegislatorProfileMobileScreen), so the web and mobile layouts stay in
// sync. Pure functions, unit-testable.

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
