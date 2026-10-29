/**
 * The bill and roll-call records Legislation, Bill and Roll call read, and the
 * small display rules they share. The served shapes are the public site's own
 * (`alethical/api/routers/public.py`, `/bills…`); the wording rules come from
 * `@alethical/shared` where that package offers them. The version labels and
 * the action ordering below repeat the public site's `data/api.ts`
 * (`versionDisplayName`) and `lib/billDetail.ts` (`orderActionsForTimeline`,
 * `orderBillVersions`, `billOverviewUrl`), which the shared package does not
 * offer because those files import React Native.
 */
import { completeDanglingTitle, statusLabel } from '@alethical/shared/billStatus';
import {
  formatLegislativeYearRange,
  formatSessionLabel,
  normalizeLegislativeYearRanges,
} from '@alethical/shared/sessionLabel';

export interface ServedSession {
  slug: string;
  name: string;
  is_current: boolean;
  session_number?: number | null;
  year_start?: number | null;
  year_end?: number | null;
}

export interface BillListItem {
  id: string;
  file_type?: string | null;
  file_number?: number | null;
  current_status?: string | null;
  status_key?: string | null;
  latest_action_at?: string | null;
  ai_analysis?: { short_title?: string | null } | null;
}

export interface Sponsor {
  name: string;
  role: string;
  legislator_id?: string | null;
  slug?: string | null;
  source_order?: number | null;
  source_chamber?: string | null;
  chamber?: string | null;
  party?: string | null;
  district?: string | null;
}

export interface ServedAction {
  action_number: number;
  action_text?: string | null;
  action_description?: string | null;
  committee_name?: string | null;
  action_at?: string | null;
  roll_call_text?: string | null;
}

export interface ServedVersion {
  version_code: string;
  version_name?: string | null;
  document_date?: string | null;
  html_url?: string | null;
  is_current?: boolean | null;
}

export interface ServedCitation {
  id: string;
  label: string;
  excerpt: string;
  section_id: string;
  section_order?: number | null;
  section_topic?: string | null;
}

export interface BillDetail {
  id: string;
  title?: string | null;
  session?: ServedSession | null;
  description?: string | null;
  current_status?: string | null;
  status_key?: string | null;
  latest_action_at?: string | null;
  last_pulled_at?: string | null;
  official_url?: string | null;
  is_omnibus?: boolean | null;
  companion?: { id: string; code: string } | null;
  chief_sponsors?: Sponsor[] | null;
  all_sponsors?: Sponsor[] | null;
  ai_analysis?: {
    short_title?: string | null;
    summary?: string | null;
    citations?: ServedCitation[] | null;
  } | null;
  actions?: ServedAction[] | null;
  versions?: ServedVersion[] | null;
}

export interface VoteRecord {
  legislator_id: string;
  legislator_name?: string | null;
  slug?: string | null;
  party?: string | null;
  vote_value: string;
}

export interface ServedVote {
  id: string;
  motion_text?: string | null;
  result_text?: string | null;
  chamber?: string | null;
  yes_count?: number | null;
  no_count?: number | null;
  absent_count?: number | null;
  excused_count?: number | null;
  present_count?: number | null;
  occurred_at?: string | null;
  official_url?: string | null;
  records?: VoteRecord[] | null;
}

/** The bill page's one record read; the roll-call page reads the same address,
 * so returning from a roll call shows the bill at once. */
export const BILL_INCLUDE = 'ai_analysis,all_sponsors,actions,versions';

/**
 * An API read path under `/bills`, each part encoded. Built from its parts so
 * no shipped string reads as a hand-written public-site page address
 * (scripts/check-built-links.mjs); these are the data service's paths.
 */
export function billsApi(...parts: string[]): string {
  return ['', 'bills', ...parts.map(encodeURIComponent)].join('/');
}

export function billPath(id: string): string {
  return `${billsApi(id)}?include=${BILL_INCLUDE}`;
}

export function votesPath(id: string): string {
  return billsApi(id, 'votes');
}

export function versionTextPath(id: string, code: string): string {
  return billsApi(id, 'versions', code, 'text');
}

/** "HF 9001" from the served file type and number, or from the bill's id. */
export function billCode(
  fileType: string | null | undefined,
  fileNumber: number | null | undefined,
  id?: string,
): string | null {
  if (fileType && fileNumber != null) return `${fileType.toUpperCase()} ${fileNumber}`;
  const match = id?.match(/-([A-Z]{2})(\d+)$/i);
  return match ? `${match[1].toUpperCase()} ${Number(match[2])}` : null;
}

/** The bill named as the public site names it: its plain-language title, or its
 * number when it has none, never its legal title
 * (docs/architecture/alethical-finance-architecture.md §2). */
export function billHeading(shortTitle: string | null | undefined, code: string | null): string {
  return shortTitle?.trim() || code || '';
}

const FILE_CHAMBER: Record<string, 'House' | 'Senate'> = {
  HF: 'House',
  HR: 'House',
  SF: 'Senate',
  SR: 'Senate',
};

/** The chamber a bill was filed in, from its file type ("HF" is a House file). */
export function fileChamber(code: string | null): 'House' | 'Senate' | null {
  return code ? (FILE_CHAMBER[code.slice(0, 2).toUpperCase()] ?? null) : null;
}

export function chamberName(slug: string | null | undefined): 'House' | 'Senate' | null {
  const value = (slug ?? '').toLowerCase();
  return value === 'house' ? 'House' : value === 'senate' ? 'Senate' : null;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "Apr 22, 2026" from the record's own calendar day, never shifted by time zone;
 * null when the value carries no date. */
export function dayLabel(value: string | null | undefined): string | null {
  const match = value?.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return null;
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return `${MONTHS[month - 1]} ${day}, ${match[1]}`;
}

function dayValue(value: string | null | undefined): number | null {
  const match = value?.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return match ? Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])) : null;
}

/** The status shown beside a bill, in the public site's words. */
export function billStatus(
  statusKey: string | null | undefined,
  current: string | null | undefined,
) {
  return statusLabel(statusKey, current);
}

/** "2025–26" for a regular session, "2025 First Special" for a special one. */
export function sessionShortLabel(session: ServedSession): string {
  const source = {
    name: session.name,
    yearStart: session.year_start ?? undefined,
    yearEnd: session.year_end ?? undefined,
  };
  if (/special session/i.test(session.name)) {
    return formatSessionLabel(source).replace(/\s+Session$/i, '');
  }
  if (session.year_start != null && session.year_end != null) {
    return formatLegislativeYearRange(session.year_start, session.year_end);
  }
  return normalizeLegislativeYearRanges(session.name);
}

/** The source line every bill surface closes with (the public site's SourceLine). */
/** The Legislature's source line for "Sources and updates" (Design copy 22,
 * Round 23): the source and site, then the date the bill records were updated. */
export function legislatureSource(updatedIso: string | null | undefined): string {
  const day = dayLabel(updatedIso);
  return `Minnesota Legislature · revisor.mn.gov${day ? ` · Updated ${day}` : ''}`;
}

/** The bill's status page on revisor.mn.gov: `official_url` names a text version,
 * so its "versions/…" tail is dropped. */
export function billOverviewUrl(officialUrl: string | null | undefined): string | null {
  if (!officialUrl) return null;
  return officialUrl.replace(/\/versions\/.*$/, '/');
}

// ---------- Actions ----------

export interface ActionRow {
  key: string;
  date: string | null;
  text: string;
  tally: string | null;
  at: string | null;
}

/** 1 action as a line: the source's label, completed where it stops on a
 * preposition, with its detail and recorded tally beside it. */
export function actionRow(action: ServedAction): ActionRow | null {
  const label = (action.action_text ?? '').trim();
  if (!label) return null;
  const committee = (action.committee_name ?? '').trim();
  const detail = (action.action_description ?? '').trim();
  const tally = (action.roll_call_text ?? '').trim() || null;
  const parts = [completeDanglingTitle(label, committee), detail, tally].filter(Boolean);
  return {
    key: String(action.action_number) + '|' + (action.action_at ?? '') + '|' + label,
    date: dayLabel(action.action_at),
    text: parts.join(' · '),
    tally,
    at: action.action_at ?? null,
  };
}

/**
 * Newest first. Actions arrive grouped by chamber, each ascending by
 * `action_number`, so a drop in the number starts the next chamber. A dateless
 * row sorts beside the dated row before it in its own chamber, and shows no date.
 */
export function orderActions(actions: ServedAction[]): ServedAction[] {
  const times = actions.map((action) => dayValue(action.action_at));
  const key = new Array<number>(actions.length).fill(Number.NaN);
  let lastDated: number | null = null;
  let previous = Number.NEGATIVE_INFINITY;
  actions.forEach((action, index) => {
    if (action.action_number < previous) lastDated = null;
    previous = action.action_number;
    const time = times[index];
    if (time !== null) {
      key[index] = time;
      lastDated = time;
    } else if (lastDated !== null) {
      key[index] = lastDated + 1;
    }
  });
  let nextDated: number | null = null;
  let next = Number.POSITIVE_INFINITY;
  for (let index = actions.length - 1; index >= 0; index -= 1) {
    if (actions[index].action_number > next) nextDated = null;
    next = actions[index].action_number;
    const time = times[index];
    if (time !== null) nextDated = time;
    else if (Number.isNaN(key[index])) key[index] = nextDated !== null ? nextDated - 1 : 0;
  }
  return actions
    .map((action, index) => ({ action, index, key: key[index] }))
    .sort((a, b) => b.key - a.key || a.index - b.index)
    .map((entry) => entry.action);
}

/** The 1 roll call an action's recorded tally belongs to: same yes–no tally and,
 * where both carry one, the same day. Null when none or more than 1 match. */
export function voteForAction(row: ActionRow, votes: ServedVote[]): ServedVote | null {
  const tally = (row.tally ?? '').replace(/[–—]/g, '-').replace(/\s/g, '');
  if (!/^\d+-\d+$/.test(tally)) return null;
  const day = dayValue(row.at);
  const matches = votes.filter((vote) => {
    if (`${vote.yes_count ?? ''}-${vote.no_count ?? ''}` !== tally) return false;
    const voteDay = dayValue(vote.occurred_at);
    return day === null || voteDay === null || day === voteDay;
  });
  return matches.length === 1 ? matches[0] : null;
}

/** Roll calls newest first. */
export function orderVotes(votes: ServedVote[]): ServedVote[] {
  return votes
    .map((vote, index) => ({ vote, index, time: dayValue(vote.occurred_at) ?? 0 }))
    .sort((a, b) => b.time - a.time || a.index - b.index)
    .map((entry) => entry.vote);
}

// ---------- Versions ----------

function ordinal(n: number): string {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
  return `${n}${['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`;
}

function engrossmentLabel(sequence: number, unofficial: boolean): string {
  if (sequence === 0) return 'As introduced';
  return `${ordinal(sequence)} ${unofficial ? 'unofficial engrossment' : 'engrossment'}`;
}

/** A version's reader-facing name, as the public site's Versions tab prints it. */
export function versionLabel(code: string, name?: string | null): string {
  const raw = (name ?? '').trim();
  if (code.trim().toLowerCase() === 'session-law') return raw || 'Session Law';
  if (/(?:^|[^A-Za-z])CCR/i.test(raw) || /(?:^|[^A-Za-z])CCR/i.test(code)) {
    return 'Conference committee report';
  }
  const friendly = raw.match(/^(?:HF|SF)\s+\d+\s+(.+?)\s+-\s+\d+\w*\s+Legislature/i);
  if (friendly) {
    const descriptor = friendly[1].trim();
    if (/^introduction$/i.test(descriptor)) return 'As introduced';
    return descriptor.replace(/Engrossment/gi, 'engrossment').replace(/Unofficial/gi, 'unofficial');
  }
  const codeForm = raw.match(/^\d{4}\.\d+-([A-Za-z]+)\d+-(\d+)$/);
  if (codeForm) {
    return engrossmentLabel(Number(codeForm[2]), codeForm[1].toUpperCase().startsWith('UE'));
  }
  const trimmed = code.trim();
  if (/^\d+$/.test(trimmed)) return engrossmentLabel(Number(trimmed), false);
  if (trimmed.toLowerCase() === 'current') return 'Current version';
  return normalizeLegislativeYearRanges(raw || trimmed || 'Bill version');
}

export interface VersionRow {
  code: string;
  label: string;
  date: string | null;
  url: string | null;
  isLaw: boolean;
  isCurrent: boolean;
}

/** "the as introduced version" reads wrong, so a phrase uses "introduced". */
export function versionPhrase(label: string): string {
  if (/^as introduced$/i.test(label)) return 'introduced';
  return label.charAt(0).toLowerCase() + label.slice(1);
}

/**
 * Newest first, 1 row per name. The "current" alias row loses to the real
 * record of the same name, and among equals the earliest date (the real
 * posting date) wins. "As introduced" carries the bill's introduction date,
 * because the source sometimes stamps that version with a later revision date.
 */
export function orderVersions(versions: ServedVersion[], actions: ServedAction[]): VersionRow[] {
  const intro = actions
    .filter((action) => /^introduction and first reading/i.test(action.action_text ?? ''))
    .map((action) => action.action_at)
    .filter((value): value is string => !!value && dayValue(value) !== null)
    .sort()[0];
  const best = new Map<string, { row: VersionRow; pointer: boolean; time: number }>();
  for (const version of versions) {
    const label = versionLabel(version.version_code, version.version_name);
    const dateSource =
      intro && /^as introduced$/i.test(label) ? intro : (version.document_date ?? null);
    const row: VersionRow = {
      code: version.version_code,
      label,
      date: dayLabel(dateSource),
      url: version.html_url ?? null,
      isLaw: version.version_code === 'session-law',
      isCurrent: version.is_current === true && version.version_code !== 'current',
    };
    const candidate = {
      row,
      pointer: version.version_code === 'current',
      time: dayValue(dateSource) ?? Number.POSITIVE_INFINITY,
    };
    const key = label.toLowerCase();
    const incumbent = best.get(key);
    if (
      !incumbent ||
      (incumbent.pointer && !candidate.pointer) ||
      (incumbent.pointer === candidate.pointer && candidate.time < incumbent.time)
    ) {
      best.set(key, candidate);
    }
  }
  return [...best.values()]
    .sort((a, b) => {
      const ta = Number.isFinite(a.time) ? a.time : Number.NEGATIVE_INFINITY;
      const tb = Number.isFinite(b.time) ? b.time : Number.NEGATIVE_INFINITY;
      return tb - ta;
    })
    .map((entry) => entry.row);
}

/** The version Bill Text opens by default: the one the record marks current,
 * else the newest that is not the session law. */
export function defaultTextVersion(rows: VersionRow[]): VersionRow | null {
  const readable = rows.filter((row) => !row.isLaw);
  return readable.find((row) => row.isCurrent) ?? readable[0] ?? null;
}

// ---------- Authors ----------

const ROLE_LABELS: Record<string, string> = {
  chief_author: 'Chief author',
  co_author: 'Co-author',
};

export function roleLabel(role: string): string | null {
  return ROLE_LABELS[role] ?? null;
}

/**
 * This bill's own authors: chief authors first, then co-authors, each in the
 * order the Legislature lists them. A companion bill's authors (named in the
 * other chamber's file) and rows of any other role are left out.
 */
export function ownAuthors<T extends Sponsor>(sponsors: T[], chamber: 'House' | 'Senate' | null) {
  const own = chamber ? chamber.toLowerCase() : null;
  return sponsors
    .filter((sponsor) => roleLabel(sponsor.role) !== null)
    .filter((sponsor) => !own || !sponsor.source_chamber || sponsor.source_chamber === own)
    .map((sponsor, index) => ({ sponsor, index }))
    .sort(
      (a, b) =>
        (a.sponsor.role === 'chief_author' ? 0 : 1) - (b.sponsor.role === 'chief_author' ? 0 : 1) ||
        (a.sponsor.source_order ?? Number.MAX_SAFE_INTEGER) -
          (b.sponsor.source_order ?? Number.MAX_SAFE_INTEGER) ||
        a.index - b.index,
    )
    .map((entry) => entry.sponsor);
}

/** "Senate District 51" from the served "District 51" and the member's chamber. */
export function seatLabel(district: string | null | undefined, chamber: string | null | undefined) {
  const value = (district ?? '').trim();
  if (!value) return null;
  const name = chamberName(chamber);
  return name && /^District\b/i.test(value) ? `${name} ${value}` : value;
}
