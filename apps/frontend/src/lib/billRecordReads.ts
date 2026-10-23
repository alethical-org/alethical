import type { Bill, BillAction, BillSponsor, VoteEvent } from '../data/types';
import type { ApiBillDetailPayload } from '../data/api';
import {
  completeDanglingTitle,
  STATUS_LABELS,
  TRAILING_REFERRAL,
  TRAILING_RETURN,
} from './billStatus';
import { normalizeMotion } from './motionNormalize';
import { parseActionDate } from './billDetail';

// Shared record shaping for the first response and the loaded bill page. No UI imports.
// Existing transport limits: API 60s fresh + 300s stale, page 300s + 300s.
// This bounds a newly delivered page, not a tab left open without a successful read.
export const BILL_API_MAX_AGE_SECONDS = 360;
export const BILL_PAGE_MAX_AGE_SECONDS = 600;
export const BILL_FIRST_RESPONSE_MAX_AGE_SECONDS =
  BILL_API_MAX_AGE_SECONDS + BILL_PAGE_MAX_AGE_SECONDS;

export function billReadWithinCacheWindow(ageSeconds: number | null): boolean {
  // Missing Age is not evidence of freshness. The full API allowance applies.
  return ageSeconds === null || (ageSeconds >= 0 && ageSeconds <= BILL_API_MAX_AGE_SECONDS);
}

export const BILL_DETAIL_INCLUDE = 'all_sponsors,actions,versions,topics,ai_analysis,progress';
export const BILL_VOTES_UNAVAILABLE =
  'We couldn’t load this bill’s votes right now. Please try again in a moment.';
export const BILL_VOTE_COVERAGE =
  'Only recorded members are listed. Absent and excused members are not inferred.';

export interface ApiBillActionPayload {
  action_number: number;
  action_text: string;
  action_group?: string | null;
  action_description?: string | null;
  committee_name?: string | null;
  action_at?: string | null;
  first_seen_at?: string | null;
  roll_call_text?: string | null;
  cross_references?:
    { code: string; id: string; title?: string | null; status_key?: string | null }[] | null;
}

export interface ApiBillVoteRecordPayload {
  legislator_id: string;
  slug?: string | null;
  legislator_name?: string | null;
  party?: string | null;
  vote_value: string;
}

export interface ApiBillVotePayload {
  id: string;
  motion_text?: string | null;
  result_text?: string | null;
  /** Definitive chamber of this roll call ("house"/"senate"), from vote_event.chamber_id. */
  chamber?: string | null;
  yes_count?: number | null;
  no_count?: number | null;
  absent_count?: number | null;
  excused_count?: number | null;
  present_count?: number | null;
  occurred_at?: string | null;
  official_url?: string | null;
  records?: ApiBillVoteRecordPayload[] | null;
}

function toOptionalChamber(chamber?: string | null): Bill['chamber'] | undefined {
  if (!chamber) {
    return undefined;
  }
  return chamber.toLowerCase() === 'house' ? 'House' : 'Senate';
}

function formatOptionalDate(date?: string | null) {
  return date ? date.slice(0, 10) : '';
}

export function mapSponsor(payload: ApiBillDetailPayload['chief_sponsors'][number]): BillSponsor {
  return {
    name: payload.name,
    role: payload.role,
    legislatorId: payload.legislator_id ?? undefined,
    slug: payload.slug ?? undefined,
    chamber: toOptionalChamber(payload.chamber ?? payload.source_chamber),
    party: payload.party ?? undefined,
    district: payload.district ?? undefined,
    representedCity: payload.represented_city ?? undefined,
  };
}

const DATE_ONLY = /^\d{1,2}\/\d{1,2}\/\d{2,4}$/;

// A trailing "referred to" / "re-refer to" clause (with an optional leading
// "and" / comma) that dangles mid-phrase when the source carried no committee
// name — e.g. "Introduction and first reading, referred to" or "…and re-refer
// to". The committee is named in action_description when present (appended to
// complete the phrase); when absent, this clause is stripped so no row ends on
// "referred to" with nothing after it. Shared with the web timeline's normalizer
// (lib/billDetail.ts), which applies the same rule to its own titles.

function isoFromSlashDate(value: string): string {
  const m = value.trim().match(/(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
  if (!m) return '';
  const [, mm, dd, yyRaw] = m;
  const yy = yyRaw.length === 2 ? `20${yyRaw}` : yyRaw;
  return `${yy}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}`;
}

// Turn one raw source action into a clean timeline row, or null to drop it. The
// label is action_text (#430/#440 — never the detail payload, which is a name list
// / date / cross-ref). Beyond that: fold author-add name lists into the title,
// extract the embedded date on enacted-milestone rows (null action_at), give the
// signing row a plain "Signed into law · Chapter N" title, and carry the tally.
export function mapBillAction(action: ApiBillActionPayload, billId: string): BillAction | null {
  const text = (action.action_text ?? '').trim();
  const desc = (action.action_description ?? '').trim();
  const committee = (action.committee_name ?? '').trim();
  const low = text.toLowerCase();
  if (!text || low === 'updated unknown') return null;

  let title = text;
  let date = formatOptionalDate(action.action_at);
  if (!date && desc) {
    const iso = isoFromSlashDate(desc);
    if (iso) date = iso;
  }

  if (/authors?\s+added/i.test(low)) {
    title = desc
      ? `Authors added: ${desc
          .split(/[;,]/)
          .map((s) => s.trim())
          .filter(Boolean)
          .join(', ')}`
      : 'Authors added';
  } else if (/chief author added/i.test(low)) {
    title = desc ? `Chief author added: ${desc}` : text;
  } else if (/chief author stricken/i.test(low)) {
    title = desc ? `Chief author changed to co-author: ${desc}` : 'Chief author changed';
  } else if (/secretary of state/i.test(low) && /chapter\s+\d+/i.test(desc)) {
    const ch = desc.match(/chapter\s+(\d+)/i);
    title = ch ? `Signed into law · Chapter ${ch[1]}` : 'Signed into law';
  } else if (/governor.*approval|governor approval/i.test(low)) {
    title = 'Signed by the Governor';
  } else if (/present(ed|ment)/i.test(low) && /governor|date/i.test(low)) {
    title = 'Presented to the Governor';
  } else if (low === 'chapter number') {
    return null; // redundant with the "Signed into law · Chapter N" milestone
  } else if (/^effective date\b/i.test(low)) {
    // The effective date's value lives in action_description. A real date goes
    // in the date column (via the isoFromSlashDate fallback above); non-date
    // text ("various dates", "the day following final enactment") has no date,
    // so fold it into the title — otherwise the row is a bare label with an
    // empty date column (and gets floated to the top by the timeline sort).
    if (desc && !date) title = `Effective date: ${desc}`;
  } else if (TRAILING_REFERRAL.test(text) || TRAILING_RETURN.test(text)) {
    // Complete a dangling "…referred to" / "…returned to" with its committee — the
    // dedicated committee_name field (#599) when present, else the legacy
    // action_description fallback; strip the fragment when the source has neither.
    // A bare "Referred to" with no target left over is dropped as meaningless.
    const target = committee || desc;
    if (target) {
      title = `${text} ${target}`;
    } else {
      title = text.replace(TRAILING_REFERRAL, '').replace(TRAILING_RETURN, '').trim();
      if (!title) return null;
    }
  } else if (detailIsConnectorTarget(text, desc)) {
    title = `${text} ${desc}`; // "See" / "See Also" cross-references (#440)
  }

  // Standing rule, shared with the web timeline: no action row ends on a
  // preposition. The branches above complete the two referral verbs the source
  // uses most; this catches the rest ("Referred to Chief Clerk for comparison
  // with", "Referred by Chair to"), naming the target when the record has one and
  // otherwise dropping the clause that was waiting on it.
  title = completeDanglingTitle(title.trim(), committee || desc);
  if (!title || DATE_ONLY.test(title)) return null;

  return {
    id: `${billId}-action-${action.action_number}`,
    date,
    description: title,
    // Raw source fields for the web timeline's plain-language normalization
    // (buildActionTimeline); the cooked `description` above is unchanged.
    actionText: text,
    actionDescription: desc || undefined,
    committee: committee || undefined,
    tally: action.roll_call_text?.trim() || undefined,
    actionNumber: action.action_number,
    firstSeenAt: action.first_seen_at ?? undefined,
    crossReferences: action.cross_references?.length
      ? action.cross_references.map((ref) => ({
          code: ref.code,
          id: ref.id,
          title: ref.title ?? undefined,
          // The target's status_key becomes a label here, through the same map the
          // bill's own status pill uses, so a pointer row and the target's page can
          // never name the same status two different ways (#757). An unrecognised
          // key stays undefined rather than printing "Status unavailable" — a
          // pointer row is no place to advertise a gap in our own data.
          status: STATUS_LABELS[ref.status_key ?? ''],
        }))
      : undefined,
  };
}

function detailIsConnectorTarget(text: string, detail: string): boolean {
  return !!detail && /^see( also)?$/i.test(text);
}

// Collapse exact duplicate rows (same clean title + date) the feed emits for one
// milestone (e.g. "Presentment date" and "Presented to Governor").
export function dedupeActions(actions: BillAction[]): BillAction[] {
  const seen = new Set<string>();
  return actions.filter((a) => {
    const key = `${a.description.toLowerCase()}|${a.date}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function mapBillVotes(votes: ApiBillVotePayload[]): VoteEvent[] {
  return votes.map((vote) => ({
    id: vote.id,
    motion: vote.motion_text ?? 'Vote',
    date: formatOptionalDate(vote.occurred_at),
    result: vote.result_text ?? 'Result unavailable',
    chamber: toOptionalChamber(vote.chamber),
    officialUrl: vote.official_url ?? undefined,
    breakdown: {
      yes: vote.yes_count ?? 0,
      no: vote.no_count ?? 0,
      // Members who did not vote yes/no. Only ingested when the source records
      // it; today these columns are 0, so nothing "didn't vote" is claimed (#83).
      absent: (vote.absent_count ?? 0) + (vote.excused_count ?? 0) + (vote.present_count ?? 0),
    },
    // Per-member records carry name + party inline (the /legislators list doesn't
    // serve party), so the roster grid groups by party without a second lookup.
    votes: (vote.records ?? []).map((record) => ({
      legislatorId: record.legislator_id,
      slug: record.slug ?? undefined,
      name: record.legislator_name ?? undefined,
      party: record.party ?? undefined,
      vote: record.vote_value === 'yes' ? 'YES' : record.vote_value === 'no' ? 'NO' : 'ABSENT',
    })),
  }));
}

export function outcomeBillVotes(votes: VoteEvent[]) {
  return votes
    .map((vote) => ({
      vote,
      norm: normalizeMotion({
        motionText: vote.motion,
        resultText: vote.result,
        chamber: vote.chamber,
      }),
    }))
    .filter(({ norm }) => norm.outcomeDetermining)
    .sort(
      (a, b) =>
        (parseActionDate(b.vote.date)?.getTime() ?? 0) -
        (parseActionDate(a.vote.date)?.getTime() ?? 0),
    );
}

export function billHistoryFromPayload(
  payload: Pick<
    ApiBillDetailPayload,
    'id' | 'actions' | 'all_sponsors' | 'chief_sponsors' | 'effective_schedule'
  >,
) {
  return {
    actions: dedupeActions(
      (payload.actions ?? [])
        .map((action) => mapBillAction(action, payload.id))
        .filter((action): action is BillAction => action !== null),
    ),
    sponsors: (payload.all_sponsors ?? payload.chief_sponsors ?? []).map(mapSponsor),
    effectiveSchedule: payload.effective_schedule
      ? {
          kind: payload.effective_schedule.kind,
          value: payload.effective_schedule.value,
          rows: payload.effective_schedule.rows.map((row) => ({
            date: row.date,
            sections: row.sections,
            fromEnactment: row.from_enactment,
          })),
          totalSections: payload.effective_schedule.total_sections,
          undatedSections: payload.effective_schedule.undated_sections,
          defaultCandidates: payload.effective_schedule.default_candidates,
        }
      : undefined,
  };
}
