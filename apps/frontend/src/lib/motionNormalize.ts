import { Chamber } from '../data/types';

// Shared plain-language normalization for Minnesota roll-call motions, used by the
// Bill Detail Votes tab (and consumed by the Actions timeline for any row that maps
// to a recorded vote, so a given motion reads identically in both places).
//
// WHY a normalizer at all: the source (revisor) roll-call records are raw clerk
// text in wildly mixed formats — sentence-case ("S.F. No. 334 was read the third
// time, as amended, and placed on its final passage") next to ALL-CAPS order-of-
// business headers ("CALENDAR FOR THE DAY - Passage", "MOTIONS AND RESOLUTIONS -
// Passage, as amended"). The Votes tab must (1) hide purely administrative /
// scheduling motions, (2) show ONE plain title per card + a "what it decided"
// subline, and (3) read consistently with Actions.
//
// CLASSIFICATION SIGNAL (validated against all 567 production vote_event rows):
// there is NO motion type/code column — motion_text is free text and is CORRUPTED
// in ~18 rows (page numbers like "4127", fragments like "Committee."). The RELIABLE
// signal is result_text, which is clean and standardized ("Bill was passed",
// "Third reading Passed as amended", "Bill was repassed as amended by Conference",
// "Motion did not prevail", "Laid on table"). So classification and titles derive
// from result_text FIRST, motion_text only as a refinement. This keys off what the
// motion IS, never the ALL-CAPS section header — critical because "CALENDAR FOR THE
// DAY - Passage" (229 rows, the largest group) is the HOUSE final-passage vote, not
// an administrative "Calendar for the Day" scheduling motion.

export type MotionCategory =
  | 'passage'
  | 'repassage'
  | 'concurrence'
  | 'override'
  | 'cc_report'
  | 'kill'
  | 'administrative';

export interface NormalizedMotion {
  /** Plain, consistent card/row title, e.g. "Final passage", "Repassage, as
   *  amended by the Senate", "Concurrence". Never the raw clerk text. */
  title: string;
  /** One-line "what this vote decided", chamber- and outcome-aware, e.g.
   *  "Passed the Senate in its final form." Empty for administrative motions. */
  subline: string;
  category: MotionCategory;
  /** True when this roll call decided the bill's fate or content. False ONLY for
   *  administrative/procedural/scheduling motions — those are hidden from Votes
   *  (they remain in the Actions timeline). */
  outcomeDetermining: boolean;
  /** Did this motion prevail / succeed? Single source of truth for the PASSED/
   *  FAILED badge, so a tabled bill reads consistently with its subline. */
  passed: boolean;
}

// Did the motion prevail? Negations win over the positive verbs so "Bill was not
// passed" and "Motion did not prevail" are correctly false. "Laid on table" counts
// as prevailed (the table motion succeeded → the bill was set aside).
export function motionPrevailed(resultText: string | undefined | null): boolean {
  const r = (resultText || '').toLowerCase();
  if (/\bnot\b|n['’]t|\bfail|\blost\b|reject|withdraw/.test(r)) return false;
  return /pass|repass|adopt|prevail|agree|concur|laid on table/.test(r);
}

function isAmended(motion: string, result: string): boolean {
  return /as amended/.test(motion) || /as amended|passed as amended/.test(result);
}

// Which chamber's changes were folded in on a repassage/concurrence ("by the
// Senate", "by the House", "by Conference/the Conference Committee").
function amendedBy(text: string): string | null {
  if (/conference/.test(text)) return 'the conference committee';
  if (/by the house/.test(text)) return 'the House';
  if (/by the senate/.test(text)) return 'the Senate';
  return null;
}

function chamberName(chamber: Chamber | undefined): string {
  return chamber === 'House' ? 'House' : chamber === 'Senate' ? 'Senate' : 'chamber';
}

function classify(motion: string, result: string): MotionCategory {
  const m = motion.toLowerCase();
  const r = result.toLowerCase();
  // result_text PRIMARY — reliable even when motion_text is corrupt.
  if (/override/.test(m + ' ' + r)) return 'override';
  if (/concur|adopted cc report/.test(r)) return 'concurrence';
  if (/repass/.test(r)) return 'repassage';
  if (/laid on table/.test(r)) return 'kill';
  if (/passed/.test(r)) return 'passage'; // incl. "bill was NOT passed" (a failed passage)
  // motion-driven substantive cases when result is a bare "Motion (did not) prevail":
  if (/lay on the table|laid on the table|indefinitely postpone/.test(m)) return 'kill';
  if (
    (/adoption|adopt/.test(m) && /conference committee report/.test(m)) ||
    /reject cc report/.test(r) ||
    (/reject/.test(m) && /conference/.test(m))
  ) {
    return 'cc_report';
  }
  // Everything else — suspension of rules, motion to reconsider, take from the
  // table, recall & re-refer, calendar/scheduling headers, and unparseable noise
  // — is administrative and hidden from Votes.
  return 'administrative';
}

export function normalizeMotion(input: {
  motionText: string | undefined | null;
  resultText: string | undefined | null;
  chamber: Chamber | undefined;
}): NormalizedMotion {
  const motion = (input.motionText || '').trim();
  const result = (input.resultText || '').trim();
  const category = classify(motion, result);
  const prevailed = motionPrevailed(result);
  const ch = chamberName(input.chamber);
  const amended = isAmended(motion, result);
  const by = amendedBy(`${motion} ${result}`.toLowerCase());

  switch (category) {
    case 'passage':
      return {
        category,
        outcomeDetermining: true,
        passed: prevailed,
        title: amended ? 'Final passage, as amended' : 'Final passage',
        subline: prevailed ? `Passed the ${ch} in its final form.` : `Failed to pass the ${ch}.`,
      };
    case 'repassage':
      return {
        category,
        outcomeDetermining: true,
        passed: prevailed,
        title: by
          ? `Repassage, as amended by ${by}`
          : amended
            ? 'Repassage, as amended'
            : 'Repassage',
        subline: prevailed
          ? `The ${ch} repassed the bill after amendments were reconciled.`
          : `The ${ch} declined to repass the bill.`,
      };
    case 'concurrence':
      return {
        category,
        outcomeDetermining: true,
        passed: prevailed,
        title: 'Concurrence',
        subline: prevailed
          ? `The ${ch} agreed to the other chamber's changes and repassed the bill.`
          : `The ${ch} did not agree to the other chamber's changes.`,
      };
    case 'override':
      return {
        category,
        outcomeDetermining: true,
        passed: prevailed,
        title: 'Veto override',
        subline: prevailed
          ? `Overrode the Governor's veto.`
          : `Failed to override the Governor's veto.`,
      };
    case 'cc_report':
      return {
        category,
        outcomeDetermining: true,
        passed: prevailed,
        title: 'Conference committee report',
        subline: prevailed
          ? `Adopted the conference committee's compromise version.`
          : `Rejected the conference committee's compromise version.`,
      };
    case 'kill':
      return {
        category,
        outcomeDetermining: true,
        passed: prevailed,
        title: 'Motion to table',
        subline: prevailed
          ? `Set the bill aside, effectively killing it.`
          : `Rejected a motion to set the bill aside.`,
      };
    case 'administrative':
    default:
      return {
        category: 'administrative',
        outcomeDetermining: false,
        passed: prevailed,
        // A cleaned fallback title (only surfaces if a consumer chooses to show
        // administrative rows — the Votes tab does not).
        title: cleanAdministrativeTitle(motion) || 'Procedural motion',
        subline: '',
      };
  }
}

// Strip the ALL-CAPS order-of-business header and clerk cruft from an
// administrative motion so a fallback title reads as plain language.
function cleanAdministrativeTitle(motion: string): string {
  const afterDash = motion.includes(' - ') ? motion.slice(motion.lastIndexOf(' - ') + 3) : motion;
  return afterDash.replace(/\s+/g, ' ').trim();
}

// Consistent per-member honorific for roll-call chips. Source names are stored
// inconsistently — some carry a "Senator " / "Representative " prefix, most are
// bare — which, under an alphabetical sort, floats bare names to the top of a
// block and makes the first chip look like it dropped its title. Strip any
// existing prefix, then re-apply the chamber's short honorific so every chip is
// uniform (and the sort no longer depends on the prefix). Backend name-data
// cleanup is tracked in #540; this is the robust display-time normalization.
export function normalizeMemberName(
  name: string | undefined | null,
  chamber: Chamber | undefined,
): string {
  const clean = (name || '')
    .replace(/^\s*(senator|representative|sen\.|rep\.|the honorable|hon\.)\s+/i, '')
    .trim();
  const title = chamber === 'House' ? 'Rep.' : chamber === 'Senate' ? 'Sen.' : '';
  if (!clean) return 'Unknown';
  return title ? `${title} ${clean}` : clean;
}
