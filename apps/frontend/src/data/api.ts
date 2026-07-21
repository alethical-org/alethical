import { Platform } from 'react-native';
import {
  AskAnswer,
  AskAnswerBill,
  Bill,
  BillAction,
  BillSponsor,
  Chamber,
  ChatSession,
  Citation,
  Legislator,
  RepresentativeLookupInput,
  RepresentativeLookupResult,
} from './types';

function androidHostOrigin(origin: string) {
  if (Platform.OS !== 'android') {
    return origin;
  }
  return origin.replace('://localhost:', '://10.0.2.2:').replace('://127.0.0.1:', '://10.0.2.2:');
}

const configuredApiOrigin = process.env.EXPO_PUBLIC_API_URL
  ? androidHostOrigin(process.env.EXPO_PUBLIC_API_URL.replace(/\/$/, ''))
  : null;
const API_BASE_URL = configuredApiOrigin ? `${configuredApiOrigin}/api/v1` : null;

interface DetailResponse<T> {
  data: T;
}

interface CollectionResponse<T> {
  data: T[];
}

interface PageResponse<T> extends CollectionResponse<T> {
  page?: {
    limit: number;
    offset?: number | null;
    next_cursor?: string | null;
    has_more: boolean;
    total?: number | null;
  } | null;
}

export interface PaginatedResult<T> {
  data: T[];
  page: {
    limit: number;
    offset: number;
    nextCursor?: string | null;
    hasMore: boolean;
    total?: number | null;
  };
}

interface ApiChatSessionPayload {
  id: string;
  title?: string | null;
  subject_bill_id?: string | null;
  last_message_at?: string | null;
}

interface ApiCurrentUserPayload {
  id: string;
  display_name?: string | null;
  primary_email?: string | null;
}

interface ApiSponsorPayload {
  name: string;
  role: string;
  legislator_id?: string | null;
  source_order?: number | null;
  source_chamber?: string | null;
  chamber?: string | null;
  party?: string | null;
  district?: string | null;
}

interface ApiBillStatsPayload {
  sponsor_count: number;
  action_count: number;
  version_count: number;
  vote_event_count: number;
}

interface ApiBillListItemPayload {
  id: string;
  file_type: string;
  file_number: number;
  title: string;
  current_status?: string | null;
  status_key?: string | null;
  latest_action_at?: string | null;
  official_url?: string | null;
  is_omnibus?: boolean;
  chief_sponsors: ApiSponsorPayload[];
  co_author_count?: number;
  stats?: ApiBillStatsPayload | null;
  ai_analysis?: ApiAiAnalysisPayload | null;
}

interface ApiPolicyAreaPayload {
  name: string;
  bill_count: number;
}

interface ApiAskTopicBillsAnswerPayload {
  topic?: string | null;
  session: { slug: string; name: string };
  data_as_of?: string | null;
  total_matches: number;
  bills: ApiBillListItemPayload[];
}

interface ApiAskLegislatorBillPayload {
  id: string;
  file_type: string;
  file_number: number;
  title: string;
}

interface ApiAskLegislatorPayload {
  id: string;
  full_name: string;
  party?: string | null;
  district?: string | null;
  chamber?: string | null;
  profile_url?: string | null;
  authored_count: number;
  coauthored_count: number;
  bills: ApiAskLegislatorBillPayload[];
}

interface ApiAskTopicLegislatorsAnswerPayload {
  topic?: string | null;
  session: { slug: string; name: string };
  data_as_of?: string | null;
  total_matches: number;
  total_bills: number;
  legislators: ApiAskLegislatorPayload[];
}

interface ApiAskVoteDeflectionAnswerPayload {
  session: { slug: string; name: string };
  data_as_of?: string | null;
  resolved_bill?: ApiBillListItemPayload | null;
  topic_bills?: ApiAskTopicBillsAnswerPayload | null;
}

interface ApiAskCitationPayload {
  label: string;
  bill_id: string;
  excerpt: string;
  url: string;
}

interface ApiAskBillTextAnswerPayload {
  answer: string;
  citations: ApiAskCitationPayload[];
  bill: ApiBillListItemPayload;
  session: { slug: string; name: string };
  data_as_of?: string | null;
}

interface ApiAskAnswerPayload {
  intent: string;
  source: string;
  confidence?: number | null;
  answer?:
    | ApiAskBillTextAnswerPayload
    | ApiAskTopicBillsAnswerPayload
    | ApiAskTopicLegislatorsAnswerPayload
    | ApiAskVoteDeflectionAnswerPayload
    | null;
}

export interface PolicyArea {
  name: string;
  billCount: number;
}

interface ApiSessionPayload {
  slug: string;
  name: string;
  is_current: boolean;
}

export interface LegislativeSession {
  slug: string;
  name: string;
  isCurrent: boolean;
}

export type BillSort = 'latest_action' | 'progress' | 'introduced';

export interface BillListFilters {
  chamber?: Chamber;
  status?: string;
  policyArea?: string;
  omnibus?: boolean;
  // Result ordering. Omitted → API default (latest_action). 'progress' orders
  // by legislative stage (signed → … → proposed), tie-broken by recency (#292).
  // 'introduced' orders by real introduction date desc (most recently introduced
  // first) — the date-backed sort the mobile home Bill Activity uses.
  sort?: BillSort;
}

export interface LegislatorListFilters {
  chamber?: Chamber;
}

export interface ListPagination {
  limit?: number;
  offset?: number;
  /** Sponsorship role filter for legislator bills (e.g. "chief_author"). */
  role?: string;
  /** Session slug (e.g. "94-2025-regular"); defaults to the current session. */
  session?: string;
}

interface ApiTrackedBillPayload {
  bill_id: string;
  alerts_enabled: boolean;
  note?: string | null;
  bill?: ApiBillListItemPayload | null;
}

interface ApiBillActionPayload {
  action_number: number;
  action_text: string;
  action_group?: string | null;
  action_description?: string | null;
  action_at?: string | null;
  roll_call_text?: string | null;
}

interface ApiDistrictPayload {
  id: string;
  code: string;
  label: string;
}

interface ApiCurrentServicePayload {
  chamber: string;
  party?: string | null;
  district: ApiDistrictPayload;
  email?: string | null;
  phone?: string | null;
  office_address?: string | null;
  profile_url?: string | null;
  photo_url?: string | null;
}

interface ApiLegislatorStatsPayload {
  chief_bill_count: number;
  total_bill_count: number;
  vote_record_count: number;
  committee_count: number;
}

interface ApiCommitteePayload {
  name: string;
  role?: string | null;
}

interface ApiLegislatorListItemPayload {
  id: string;
  slug: string;
  full_name: string;
  current_service?: ApiCurrentServicePayload | null;
  committees?: ApiCommitteePayload[] | null;
  stats?: ApiLegislatorStatsPayload | null;
}

interface ApiLegislatorDetailPayload extends ApiLegislatorListItemPayload {
  biography?: string | null;
}

interface ApiRepresentativeLookupPayload {
  resolved_place: {
    input_mode?: string | null;
    address_text?: string | null;
    matched_address?: string | null;
    latitude?: number | null;
    longitude?: number | null;
    house_district?: string | null;
    senate_district?: string | null;
  };
  house_legislator?: ApiLegislatorListItemPayload | null;
  senate_legislator?: ApiLegislatorListItemPayload | null;
}

interface ApiBillVersionPayload {
  version_code: string;
  version_name?: string | null;
  document_date?: string | null;
  html_url?: string | null;
  pdf_url?: string | null;
  is_current: boolean;
}

interface ApiTopicPayload {
  slug: string;
  name: string;
}

interface ApiCompanionPayload {
  id: string;
  code: string;
  status?: string | null;
  status_key?: string | null;
}

interface ApiBillDetailPayload {
  id: string;
  title: string;
  description?: string | null;
  current_status?: string | null;
  status_key?: string | null;
  latest_action_at?: string | null;
  official_url?: string | null;
  is_omnibus?: boolean | null;
  chief_sponsors: ApiSponsorPayload[];
  all_sponsors?: ApiSponsorPayload[] | null;
  progress?: ApiBillProgressStepPayload[] | null;
  actions?: ApiBillActionPayload[] | null;
  versions?: ApiBillVersionPayload[] | null;
  topics?: ApiTopicPayload[] | null;
  ai_analysis?: ApiAiAnalysisPayload | null;
  companion?: ApiCompanionPayload | null;
}

interface ApiBillProgressStepPayload {
  key: string;
  label: string;
  reached: boolean;
  current?: boolean;
}

interface ApiAiCitationPayload {
  id: string;
  label: string;
  url: string;
  excerpt: string;
}

interface ApiAiAnalysisPayload {
  short_title?: string | null;
  summary?: string | null;
  key_points?: string[] | null;
  policy_areas?: string[] | null;
  // Per-key-point source anchors (#377); empty until the corpus is re-enriched.
  citations?: ApiAiCitationPayload[] | null;
}

interface ApiBillVoteRecordPayload {
  legislator_id: string;
  legislator_name?: string | null;
  party?: string | null;
  vote_value: string;
}

interface ApiBillVotePayload {
  id: string;
  motion_text?: string | null;
  result_text?: string | null;
  yes_count?: number | null;
  no_count?: number | null;
  absent_count?: number | null;
  excused_count?: number | null;
  present_count?: number | null;
  occurred_at?: string | null;
  official_url?: string | null;
  records?: ApiBillVoteRecordPayload[] | null;
}

interface ApiChatMessagePayload {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  citations?: Array<{
    citation_label?: string;
    excerpt?: string;
    full_text?: string;
    highlight_text?: string;
    url?: string | null;
    bill_id?: string;
  }>;
  created_at: string;
}

function apiUrl(path: string) {
  if (!API_BASE_URL) {
    throw new Error('Chat API is not configured for this deployment.');
  }

  return `${API_BASE_URL}${path}`;
}

function publicApiUrl(path: string) {
  if (!API_BASE_URL) {
    throw new Error('Public API is not configured for this deployment.');
  }

  return `${API_BASE_URL}${path}`;
}

async function apiRequest<T>(path: string, init: RequestInit, accessToken: string): Promise<T> {
  const response = await fetch(apiUrl(path), {
    ...init,
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${accessToken}`,
      ...(init.body ? { 'Content-Type': 'application/json' } : null),
      ...(init.headers ?? {}),
    },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `API request failed with ${response.status}`);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return (await response.json()) as T;
}

async function publicApiRequest<T>(path: string): Promise<T> {
  const response = await fetch(publicApiUrl(path), {
    method: 'GET',
    headers: {
      Accept: 'application/json',
    },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `API request failed with ${response.status}`);
  }

  return (await response.json()) as T;
}

async function publicApiPost<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(publicApiUrl(path), {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `API request failed with ${response.status}`);
  }

  return (await response.json()) as T;
}

function toChamber(fileType: string): Bill['chamber'] {
  return fileType.toUpperCase() === 'HF' ? 'House' : 'Senate';
}

function toLegislatorChamber(chamber?: string | null): Legislator['chamber'] {
  return chamber?.toLowerCase() === 'house' ? 'House' : 'Senate';
}

function toOptionalChamber(chamber?: string | null): Bill['chamber'] | undefined {
  if (!chamber) {
    return undefined;
  }
  return chamber.toLowerCase() === 'house' ? 'House' : 'Senate';
}

function toParty(party?: string | null): Legislator['party'] {
  const normalized = party?.trim().toUpperCase();
  if (normalized === 'R' || normalized === 'REPUBLICAN') {
    return 'R';
  }
  if (normalized === 'I' || normalized === 'INDEPENDENT') {
    return 'I';
  }
  // MN Democrats are the DFL (Democratic-Farmer-Labor); keep the real label.
  return 'DFL';
}

function mapSponsor(payload: ApiSponsorPayload): BillSponsor {
  return {
    name: payload.name,
    role: payload.role,
    legislatorId: payload.legislator_id ?? undefined,
    chamber: toOptionalChamber(payload.chamber ?? payload.source_chamber),
    party: payload.party ?? undefined,
    district: payload.district ?? undefined,
  };
}

function defaultProgress(): Bill['progress'] {
  return [
    { key: 'proposed', label: 'Introduced', reached: true, current: true },
    { key: 'in_committee', label: 'In Committee', reached: false, current: false },
    { key: 'passed_house', label: 'Passed House', reached: false, current: false },
    { key: 'passed_senate', label: 'Passed Senate', reached: false, current: false },
    { key: 'signed_into_law', label: 'Signed into Law', reached: false, current: false },
  ];
}

function statusLabel(statusKey?: string | null, fallback?: string | null) {
  const labels: Record<string, string> = {
    proposed: 'Introduced',
    in_committee: 'In Committee',
    passed_house: 'Passed House',
    passed_senate: 'Passed Senate',
    signed_into_law: 'Signed into Law',
    vetoed: 'Vetoed',
  };
  return (statusKey && labels[statusKey]) || fallback || 'Status unavailable';
}

function formatBillIdentifier(fileType: string, fileNumber: number) {
  return `${fileType.toUpperCase()} ${fileNumber}`;
}

function formatUpdatedAt(date?: string | null) {
  return date ? date.slice(0, 10) : 'Unknown';
}

function formatOptionalDate(date?: string | null) {
  return date ? date.slice(0, 10) : '';
}

function ordinal(n: number): string {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) {
    return `${n}th`;
  }
  switch (n % 10) {
    case 1:
      return `${n}st`;
    case 2:
      return `${n}nd`;
    case 3:
      return `${n}rd`;
    default:
      return `${n}th`;
  }
}

function engrossmentLabel(sequence: number, unofficial: boolean): string {
  if (sequence === 0) {
    return 'As introduced';
  }
  return `${ordinal(sequence)} ${unofficial ? 'unofficial engrossment' : 'engrossment'}`;
}

// Turn a Minnesota version code/name into a reader-friendly label (#433).
// Sampled across production, versions arrive in two shapes:
//   - friendly:  "HF 1 4th Engrossment - 94th Legislature (2025 - 2026)"
//                "SF 856 1st Unofficial Engrossment - ...", "HF 31 Introduction - ..."
//   - raw code:  "2026.0-HF4138-5", "2025.0-UES0334-1", "2026.0-UEH4138-1"
//                (YYYY.N-{PREFIX}{file}-{seq}; PREFIX is SF/HF for official
//                engrossments, UES/UEH for unofficial — Senate/House)
//   - CCR code:  "2026.0-CCRHF1141A" (a conference-committee report; the CCR
//                segment has no trailing "-seq", so it never matched below)
// version_code carries the engrossment sequence ("0", "1", ...) or "current".
// MN's text_versions have no separate session-law entry, so the API synthesizes
// one for enacted bills with version_code "session-law" and a name that already
// reads "Session Law — Chapter N" (#438); the branch below just guards it.
function versionDisplayName(code: string, name?: string | null): string {
  const raw = (name ?? '').trim();

  // Synthesized session-law version (#438): the name already carries the
  // "Session Law — Chapter N" label the CHAPTER chip keys off; pass it through.
  if (code.trim().toLowerCase() === 'session-law') {
    return raw || 'Session Law';
  }

  // Conference-committee report: the raw code carries a "CCR" segment
  // (e.g. "2026.0-CCRHF1141A") and MN emits no friendly descriptor for it, so it
  // would otherwise fall through to the raw code. Match CCR as its own token.
  if (/(?:^|[^A-Za-z])CCR/i.test(raw) || /(?:^|[^A-Za-z])CCR/i.test(code)) {
    return 'Conference committee report';
  }

  // Friendly form: the descriptor sits between the file id and the Legislature suffix.
  const friendly = raw.match(/^(?:HF|SF)\s+\d+\s+(.+?)\s+-\s+\d+\w*\s+Legislature/i);
  if (friendly) {
    const descriptor = friendly[1].trim();
    if (/^introduction$/i.test(descriptor)) {
      return 'As introduced';
    }
    return descriptor.replace(/Engrossment/gi, 'engrossment').replace(/Unofficial/gi, 'unofficial');
  }

  // Raw internal code form: YYYY.N-{PREFIX}{number}-{sequence}.
  const codeForm = raw.match(/^\d{4}\.\d+-([A-Za-z]+)\d+-(\d+)$/);
  if (codeForm) {
    // UES (Senate) / UEH (House) are both unofficial engrossments; SF/HF official.
    return engrossmentLabel(Number(codeForm[2]), codeForm[1].toUpperCase().startsWith('UE'));
  }

  // Fall back to the numeric version_code as an engrossment sequence.
  const trimmedCode = code.trim();
  if (/^\d+$/.test(trimmedCode)) {
    return engrossmentLabel(Number(trimmedCode), false);
  }
  if (trimmedCode.toLowerCase() === 'current') {
    return 'Current version';
  }

  return raw || trimmedCode || 'Bill version';
}

// The action's canonical label is action_text (e.g. "Author added", "Third
// reading Passed as amended", "Referred to"). action_description carries a
// supplementary detail — a name list for author/conferee rows, a filing date,
// or a cross-reference target — so it must NOT replace the label. Preferring it
// (the old `description || text`) surfaced bare surname lists as if they were
// legislative steps (#430). Use action_text as the label; only the
// cross-reference connectors ("See", "See Also") need their target appended to
// stay meaningful.
// A bare MM/DD/YY(YY) date (enacted-milestone rows carry their date in
// action_description with a null action_at).
const DATE_ONLY = /^\d{1,2}\/\d{1,2}\/\d{2,4}$/;

// A trailing "referred to" / "re-refer to" clause (with an optional leading
// "and" / comma) that dangles mid-phrase when the source carried no committee
// name — e.g. "Introduction and first reading, referred to" or "…and re-refer
// to". The committee is named in action_description when present (appended to
// complete the phrase); when absent, this clause is stripped so no row ends on
// "referred to" with nothing after it.
const TRAILING_REFERRAL = /[,\s]*(?:and\s+)?(?:re-?)?refer(?:red)?\s+to\s*$/i;

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
function mapBillAction(action: ApiBillActionPayload, billId: string): BillAction | null {
  const text = (action.action_text ?? '').trim();
  const desc = (action.action_description ?? '').trim();
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
  } else if (TRAILING_REFERRAL.test(text)) {
    // Complete a dangling "…referred to" with its committee (action_description)
    // when present; strip the fragment when the source has none. A bare
    // "Referred to" with no target left over is dropped as meaningless.
    if (desc) {
      title = `${text} ${desc}`;
    } else {
      title = text.replace(TRAILING_REFERRAL, '').trim();
      if (!title) return null;
    }
  } else if (detailIsConnectorTarget(text, desc)) {
    title = `${text} ${desc}`; // "See" / "See Also" cross-references (#440)
  }

  title = title.trim();
  if (!title || DATE_ONLY.test(title)) return null;

  return {
    id: `${billId}-action-${action.action_number}`,
    date,
    description: title,
    tally: action.roll_call_text?.trim() || undefined,
    actionNumber: action.action_number,
  };
}

function detailIsConnectorTarget(text: string, detail: string): boolean {
  return !!detail && /^see( also)?$/i.test(text);
}

// Collapse exact duplicate rows (same clean title + date) the feed emits for one
// milestone (e.g. "Presentment date" and "Presented to Governor").
function dedupeActions(actions: BillAction[]): BillAction[] {
  const seen = new Set<string>();
  return actions.filter((a) => {
    const key = `${a.description.toLowerCase()}|${a.date}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function normalizeBillIdForApi(billId: string) {
  const canonical = billId.match(/^\d{2,3}-\d{4}-(SF|HF)\d+$/i);
  if (canonical) {
    return billId.toUpperCase();
  }

  const legacy = billId.match(/^bill-(sf|hf)(\d+)$/i);
  if (legacy) {
    const [, fileType, fileNumber] = legacy;
    return `94-2025-${fileType.toUpperCase()}${fileNumber}`;
  }

  return billId;
}

function emptyBriefing(): Bill['briefing'] {
  return {
    what: 'Live bill details are loading from the backend.',
    why: 'This bill is now coming from the real API instead of the demo dataset.',
    keyChanges: [],
    whoAffected: [],
    supportersMaySay: [],
    concernsMayRaise: [],
  };
}

function aiAnalysisFromPayload(
  analysis: ApiAiAnalysisPayload | null | undefined,
): Bill['aiAnalysis'] | null {
  if (!analysis) {
    return null;
  }
  const shortTitle =
    typeof analysis.short_title === 'string' && analysis.short_title.trim()
      ? analysis.short_title.trim()
      : null;
  const summary =
    typeof analysis.summary === 'string' && analysis.summary.trim()
      ? analysis.summary.trim()
      : null;
  const keyPoints = Array.isArray(analysis.key_points)
    ? analysis.key_points.filter(
        (item): item is string => typeof item === 'string' && item.trim().length > 0,
      )
    : [];
  const policyAreas = Array.isArray(analysis.policy_areas)
    ? analysis.policy_areas.filter(
        (item): item is string => typeof item === 'string' && item.trim().length > 0,
      )
    : [];
  if (!summary) {
    return null;
  }
  return {
    shortTitle,
    summary,
    keyPoints: keyPoints.map((item) => item.trim()),
    policyAreas: policyAreas.map((item) => item.trim()),
  };
}

// Per-key-point source citations (#377): resolved server-side to the section
// they were drawn from, each with a quoted excerpt and a resolvable URL. Powers
// the "Cited Sections" strip (mobile) / "From the bill" cards (web).
function citationsFromAnalysis(analysis: ApiAiAnalysisPayload | null | undefined): Citation[] {
  if (!analysis || !Array.isArray(analysis.citations)) {
    return [];
  }
  return analysis.citations
    .filter(
      (c): c is ApiAiCitationPayload =>
        Boolean(c) &&
        typeof c.id === 'string' &&
        typeof c.label === 'string' &&
        typeof c.url === 'string' &&
        typeof c.excerpt === 'string' &&
        c.label.trim().length > 0 &&
        c.url.trim().length > 0,
    )
    .map((c) => ({
      id: c.id,
      label: c.label.trim(),
      excerpt: c.excerpt.trim(),
      url: c.url,
    }));
}

function shortName(fullName: string) {
  return fullName.replace(/^(Rep\.|Representative|Sen\.|Senator)\s+/i, '').trim();
}

function legislatorRole(payload: ApiLegislatorListItemPayload) {
  const service = payload.current_service;
  if (!service) {
    return 'Current service unavailable';
  }
  const chamber = toLegislatorChamber(service.chamber);
  return `${chamber} District ${service.district.code}`;
}

function cleanOfficeAddress(value?: string | null) {
  if (!value) {
    return undefined;
  }
  const lines = value
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(
      (line) =>
        line &&
        line !== '*' &&
        !/^e-?mail:/i.test(line) &&
        !/^email updates:/i.test(line) &&
        !/^click to subscribe/i.test(line) &&
        // Redundant with the "Capitol Office" label, the separate phone field, and
        // the newsletter CTA the source page appends to the address blob.
        !/^capitol office$/i.test(line) &&
        !/^subscribe to (my )?newsletter/i.test(line) &&
        !/^meeting request:/i.test(line) &&
        !/^[\d\s().+-]{7,}$/.test(line),
    );
  const unique = lines.filter((line, index) => lines.indexOf(line) === index);
  return unique.join('\n') || undefined;
}

function mapLegislator(
  payload: ApiLegislatorListItemPayload | ApiLegislatorDetailPayload,
): Legislator {
  const service = payload.current_service;
  const chamber = toLegislatorChamber(service?.chamber);
  const party = toParty(service?.party);
  const district = service?.district.code ?? 'Unknown';
  const displayName = payload.full_name;
  const committeeAssignments =
    'committees' in payload
      ? (payload.committees ?? []).map((committee) => ({
          name: committee.name,
          role: committee.role ?? null,
        }))
      : [];
  const committees = committeeAssignments.map((committee) =>
    committee.role ? `${committee.name} (${committee.role})` : committee.name,
  );
  const stats = payload.stats;
  const focusAreas = [
    stats ? `${stats.total_bill_count} authored bills` : null,
    stats ? `${stats.committee_count} committees` : null,
  ].filter((item): item is string => Boolean(item));

  return {
    id: payload.id,
    name: displayName,
    shortName: shortName(displayName),
    chamber,
    district,
    party,
    role: legislatorRole(payload),
    bio:
      ('biography' in payload ? payload.biography : null) ??
      'Live legislator profile loaded from the backend.',
    email: service?.email ?? undefined,
    phone: service?.phone ?? undefined,
    officeAddress: cleanOfficeAddress(service?.office_address),
    profileUrl: service?.profile_url ?? undefined,
    photoUrl: service?.photo_url ?? undefined,
    committees,
    committeeAssignments,
    focusAreas,
    serviceHistory: service
      ? [
          {
            id: `${payload.id}-current-service`,
            startYear: 2025,
            endYear: null,
            chamber,
            district,
            party,
            role: legislatorRole(payload),
          },
        ]
      : [],
    questionPrompts: [
      `Summarize ${displayName}'s authored bills this session.`,
      `What committees or policy areas are connected to ${displayName}?`,
    ],
    sponsoredBillIds: [],
    voteEventRefs: [],
  };
}

function mapRepresentativeLookup(
  payload: ApiRepresentativeLookupPayload,
): RepresentativeLookupResult {
  const legislators = [payload.house_legislator, payload.senate_legislator]
    .filter((item): item is ApiLegislatorListItemPayload => Boolean(item))
    .map(mapLegislator);
  const districts = [
    payload.resolved_place.senate_district
      ? `Senate ${payload.resolved_place.senate_district}`
      : null,
    payload.resolved_place.house_district ? `House ${payload.resolved_place.house_district}` : null,
  ].filter((item): item is string => Boolean(item));

  const coordinateLabel =
    payload.resolved_place.latitude != null && payload.resolved_place.longitude != null
      ? `${payload.resolved_place.latitude.toFixed(5)}, ${payload.resolved_place.longitude.toFixed(5)}`
      : 'Selected location';

  return {
    address:
      payload.resolved_place.matched_address ??
      payload.resolved_place.address_text ??
      coordinateLabel,
    districtSummary: districts.join(', ') || 'No districts returned',
    legislators,
  };
}

function mapBillSummary(payload: ApiBillListItemPayload): Bill & { sponsorNames: string[] } {
  return {
    id: payload.id,
    identifier: formatBillIdentifier(payload.file_type, payload.file_number),
    title: payload.title,
    chamber: toChamber(payload.file_type),
    status: statusLabel(payload.status_key, payload.current_status),
    latestActionText: payload.current_status ?? undefined,
    isOmnibus: payload.is_omnibus ?? false,
    updatedAt: formatUpdatedAt(payload.latest_action_at),
    sessionLabel: 'Current session',
    topics: [],
    chiefSponsorIds: payload.chief_sponsors.map((sponsor) => sponsor.legislator_id ?? sponsor.name),
    coAuthorCount: payload.co_author_count ?? 0,
    sponsors: payload.chief_sponsors.map(mapSponsor),
    progress: defaultProgress(),
    actionCount: payload.stats?.action_count ?? 0,
    versionCount: payload.stats?.version_count ?? 0,
    rollCallCount: payload.stats?.vote_event_count ?? 0,
    briefing: emptyBriefing(),
    aiAnalysis: aiAnalysisFromPayload(payload.ai_analysis),
    questionPrompts: [],
    actions: [],
    versions: [],
    votes: [],
    citations: [],
    officialLinks: payload.official_url
      ? [{ id: `${payload.id}-official`, label: 'Official bill page', url: payload.official_url }]
      : [],
    sponsorNames: payload.chief_sponsors.map((sponsor) => sponsor.name),
  };
}

function mapBillDetail(
  payload: ApiBillDetailPayload,
  votes: ApiBillVotePayload[],
): Bill & { sponsorNames: string[] } {
  const fileMatch = payload.id.match(/-(SF|HF)(\d+)$/i);
  const fileType = fileMatch?.[1]?.toUpperCase() ?? 'SF';
  const fileNumber = fileMatch?.[2] ? Number(fileMatch[2]) : 0;
  const allSponsors = payload.all_sponsors ?? payload.chief_sponsors;

  return {
    id: payload.id,
    identifier: fileNumber ? formatBillIdentifier(fileType, fileNumber) : payload.id,
    title: payload.title,
    chamber: toChamber(fileType),
    status: statusLabel(payload.status_key, payload.current_status),
    isOmnibus: payload.is_omnibus ?? false,
    companion: payload.companion
      ? {
          id: payload.companion.id,
          identifier: payload.companion.code,
          chamber: toChamber(payload.companion.code.split(' ')[0]),
          status: statusLabel(payload.companion.status_key, payload.companion.status),
        }
      : null,
    latestActionText: payload.current_status ?? undefined,
    updatedAt: formatUpdatedAt(payload.latest_action_at),
    sessionLabel: 'Current session',
    topics: (payload.topics ?? []).map((topic) => topic.name),
    chiefSponsorIds: payload.chief_sponsors.map((sponsor) => sponsor.legislator_id ?? sponsor.name),
    sponsors: allSponsors.map(mapSponsor),
    progress:
      payload.progress?.map((step) => ({
        key: step.key,
        label: step.label,
        reached: step.reached,
        current: Boolean(step.current),
      })) ?? defaultProgress(),
    actionCount: payload.actions?.length ?? 0,
    versionCount: payload.versions?.length ?? 0,
    rollCallCount: votes.length,
    briefing: emptyBriefing(),
    aiAnalysis: aiAnalysisFromPayload(payload.ai_analysis),
    questionPrompts: [],
    actions: dedupeActions(
      (payload.actions ?? [])
        .map((action) => mapBillAction(action, payload.id))
        .filter((action): action is BillAction => action !== null),
    ),
    versions: (payload.versions ?? []).map((version) => ({
      id: `${payload.id}-version-${version.version_code}`,
      label: versionDisplayName(version.version_code, version.version_name),
      date: formatOptionalDate(version.document_date),
      summary: '',
      url: version.html_url ?? version.pdf_url ?? payload.official_url ?? '',
    })),
    votes: votes.map((vote) => ({
      id: vote.id,
      motion: vote.motion_text ?? 'Vote',
      date: formatOptionalDate(vote.occurred_at),
      result: vote.result_text ?? 'Result unavailable',
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
        name: record.legislator_name ?? undefined,
        party: record.party ?? undefined,
        vote: record.vote_value === 'yes' ? 'YES' : record.vote_value === 'no' ? 'NO' : 'ABSENT',
      })),
    })),
    citations: citationsFromAnalysis(payload.ai_analysis),
    officialLinks: payload.official_url
      ? [{ id: `${payload.id}-official`, label: 'Official bill page', url: payload.official_url }]
      : [],
    sponsorNames: payload.chief_sponsors.map((sponsor) => sponsor.name),
  };
}

function normalizeBillSubjectId(subjectId?: string, subjectLabel?: string) {
  if (subjectId?.match(/^\d{2,3}-\d{4}-(SF|HF)\d+$/i)) {
    return subjectId.toUpperCase();
  }

  const fromLabel = subjectLabel?.match(/^(SF|HF)\s*(\d+)$/i);
  if (fromLabel) {
    const [, fileType, fileNumber] = fromLabel;
    return `94-2025-${fileType.toUpperCase()}${fileNumber}`;
  }

  const fromLocalId = subjectId?.match(/^bill-(sf|hf)(\d+)$/i);
  if (fromLocalId) {
    const [, fileType, fileNumber] = fromLocalId;
    return `94-2025-${fileType.toUpperCase()}${fileNumber}`;
  }

  return undefined;
}

function mapCitation(
  citation: NonNullable<ApiChatMessagePayload['citations']>[number],
  index: number,
  messageId?: string,
): Citation {
  const excerpt =
    citation.excerpt ??
    (citation.bill_id ? `Grounded in ${citation.bill_id}` : 'Grounded legislative text');
  return {
    id: `${messageId ?? citation.bill_id ?? 'citation'}-${index}`,
    label: citation.citation_label ?? 'Grounding citation',
    excerpt,
    fullText: citation.full_text ?? citation.excerpt,
    highlightText: citation.highlight_text ?? citation.excerpt ?? excerpt,
    url: citation.url ?? '',
  };
}

function mapChatSessionPayload(
  session: ApiChatSessionPayload,
  messages: ApiChatMessagePayload[],
): ChatSession {
  return {
    id: session.id,
    title: session.title ?? 'Conversation',
    userId: 'user-demo-1',
    subjectType: session.subject_bill_id ? 'bill' : 'general',
    subjectId: session.subject_bill_id ?? undefined,
    subjectLabel: session.subject_bill_id ?? undefined,
    updatedAt: session.last_message_at ?? messages.at(-1)?.created_at ?? new Date().toISOString(),
    messages: messages.map((message) => ({
      id: message.id,
      role: message.role,
      text: message.content,
      createdAt: message.created_at,
      citations: (message.citations ?? []).map((citation, index) =>
        mapCitation(citation, index, message.id),
      ),
    })),
  };
}

export async function getCurrentUserFromApi(
  accessToken: string,
): Promise<{ id: string; name: string; email: string }> {
  const response = await apiRequest<DetailResponse<ApiCurrentUserPayload>>(
    '/me',
    { method: 'GET' },
    accessToken,
  );

  const email = response.data.primary_email ?? '';
  return {
    id: response.data.id,
    name: (response.data.display_name ?? email.split('@')[0]) || 'Signed-in user',
    email,
  };
}

export async function listChatSessionsFromApi(accessToken: string): Promise<ChatSession[]> {
  const response = await apiRequest<CollectionResponse<ApiChatSessionPayload>>(
    '/me/chat-sessions',
    { method: 'GET' },
    accessToken,
  );

  return response.data.map((session) => ({
    id: session.id,
    title: session.title ?? 'Conversation',
    userId: 'user-demo-1',
    subjectType: session.subject_bill_id ? 'bill' : 'general',
    subjectId: session.subject_bill_id ?? undefined,
    subjectLabel: session.subject_bill_id ?? undefined,
    updatedAt: session.last_message_at ?? new Date().toISOString(),
    messages: [],
  }));
}

export async function getChatSessionFromApi(
  accessToken: string,
  sessionId: string,
): Promise<ChatSession | null> {
  const [sessionResponse, messagesResponse] = await Promise.all([
    apiRequest<DetailResponse<ApiChatSessionPayload>>(
      `/me/chat-sessions/${sessionId}`,
      { method: 'GET' },
      accessToken,
    ),
    apiRequest<CollectionResponse<ApiChatMessagePayload>>(
      `/me/chat-sessions/${sessionId}/messages`,
      { method: 'GET' },
      accessToken,
    ),
  ]);

  return mapChatSessionPayload(sessionResponse.data, messagesResponse.data);
}

export async function createChatSessionFromApi(
  accessToken: string,
  input: {
    title: string;
    subjectType: 'bill';
    subjectId?: string;
    seedPrompt?: string;
    subjectLabel?: string;
  },
): Promise<ChatSession> {
  const subjectBillId = normalizeBillSubjectId(input.subjectId, input.subjectLabel);
  if (!subjectBillId) {
    throw new Error('A bill is required to start chat.');
  }

  const sessionResponse = await apiRequest<DetailResponse<ApiChatSessionPayload>>(
    '/me/chat-sessions',
    {
      method: 'POST',
      body: JSON.stringify({
        title: input.title,
        subject_bill_id: subjectBillId,
      }),
    },
    accessToken,
  );

  if (input.seedPrompt?.trim()) {
    await apiRequest<DetailResponse<{ assistant_message: ApiChatMessagePayload }>>(
      `/me/chat-sessions/${sessionResponse.data.id}/messages`,
      {
        method: 'POST',
        body: JSON.stringify({
          content: input.seedPrompt.trim(),
          stream: false,
        }),
      },
      accessToken,
    );
  }

  const hydrated = await getChatSessionFromApi(accessToken, sessionResponse.data.id);
  if (!hydrated) {
    throw new Error('Chat session was created but could not be loaded');
  }
  return hydrated;
}

export async function sendChatMessageToApi(
  accessToken: string,
  input: { sessionId: string; text: string },
): Promise<ChatSession | null> {
  await apiRequest<DetailResponse<{ assistant_message: ApiChatMessagePayload }>>(
    `/me/chat-sessions/${input.sessionId}/messages`,
    {
      method: 'POST',
      body: JSON.stringify({
        content: input.text,
        stream: false,
      }),
    },
    accessToken,
  );

  return getChatSessionFromApi(accessToken, input.sessionId);
}

export async function askFromApi(question: string): Promise<AskAnswer> {
  const response = await publicApiPost<DetailResponse<ApiAskAnswerPayload>>('/ask', {
    content: question,
  });
  const payload = response.data;
  const answer = payload.answer;

  const mapBill = (bill: ApiBillListItemPayload): AskAnswerBill => ({
    id: bill.id,
    identifier: formatBillIdentifier(bill.file_type, bill.file_number),
    title: bill.title,
    status: statusLabel(bill.status_key, bill.current_status),
    statusKey: bill.status_key ?? undefined,
    summary: bill.ai_analysis?.summary ?? undefined,
    officialUrl: bill.official_url ?? undefined,
    policyAreas: bill.ai_analysis?.policy_areas ?? undefined,
  });

  // legislator_vote (§4.5 vote deflection) carries a resolved bill and/or a
  // topic_bills degrade. Treat its topic_bills as the effective bill list so the
  // deflection reuses the topic_bills rendering; surface the resolved bill on
  // its own field.
  const resolvedBill =
    answer && 'resolved_bill' in answer && answer.resolved_bill
      ? mapBill(answer.resolved_bill)
      : undefined;
  const topicBills =
    answer && 'topic_bills' in answer ? (answer.topic_bills ?? undefined) : undefined;
  const billsAnswer = topicBills ?? (answer && 'bills' in answer ? answer : undefined);
  const legislators = answer && 'legislators' in answer ? answer.legislators : [];

  // bill_text (§4.1 / §9.4): a single-bill RAG answer — prose + citations + the
  // answering bill (its 'citations' field distinguishes it from the others).
  const billTextAnswer = answer && 'citations' in answer ? answer : undefined;

  return {
    intent: payload.intent,
    hasAnswer: Boolean(answer),
    billText: billTextAnswer?.answer,
    citations: billTextAnswer?.citations.map((citation) => ({
      label: citation.label,
      billId: citation.bill_id,
      excerpt: citation.excerpt,
      url: citation.url,
    })),
    answeringBill: billTextAnswer ? mapBill(billTextAnswer.bill) : undefined,
    topic:
      billsAnswer?.topic ?? (answer && 'topic' in answer ? (answer.topic ?? undefined) : undefined),
    sessionName: answer?.session.name,
    dataAsOf: answer?.data_as_of ?? undefined,
    totalMatches:
      billsAnswer?.total_matches ??
      (answer && 'total_matches' in answer ? answer.total_matches : 0),
    totalBills: answer && 'total_bills' in answer ? answer.total_bills : undefined,
    resolvedBill,
    bills: (billsAnswer?.bills ?? []).map(mapBill),
    legislators: legislators.map((leg) => ({
      id: leg.id,
      fullName: leg.full_name,
      party: leg.party ?? undefined,
      district: leg.district ?? undefined,
      chamber: leg.chamber ?? undefined,
      profileUrl: leg.profile_url ?? undefined,
      authoredCount: leg.authored_count,
      coauthoredCount: leg.coauthored_count,
      bills: leg.bills.map((bill) => ({
        id: bill.id,
        identifier: formatBillIdentifier(bill.file_type, bill.file_number),
        title: bill.title,
      })),
    })),
  };
}

export async function listBillsFromApi(
  query?: string,
  session?: string,
  filters: BillListFilters = {},
  pagination: ListPagination = {},
): Promise<PaginatedResult<Bill & { sponsorNames: string[] }>> {
  const limit = pagination.limit ?? 20;
  const offset = pagination.offset ?? 0;
  const params = new URLSearchParams();
  params.set('limit', String(limit));
  params.set('offset', String(offset));
  if (query?.trim()) {
    params.set('q', query.trim());
  }
  if (session?.trim()) {
    params.set('session', session.trim());
  }
  if (filters.chamber) {
    params.set('chamber', filters.chamber.toLowerCase());
  }
  if (filters.status?.trim()) {
    params.set('status', filters.status.trim());
  }
  if (filters.policyArea?.trim()) {
    params.set('policy_area', filters.policyArea.trim());
  }
  if (filters.omnibus !== undefined) {
    params.set('omnibus', String(filters.omnibus));
  }
  if (filters.sort) {
    params.set('sort', filters.sort);
  }

  const response = await publicApiRequest<PageResponse<ApiBillListItemPayload>>(
    `/bills?${params.toString()}`,
  );

  return {
    data: response.data.map(mapBillSummary),
    page: {
      limit: response.page?.limit ?? limit,
      offset: response.page?.offset ?? offset,
      nextCursor: response.page?.next_cursor,
      hasMore: response.page?.has_more ?? false,
      total: response.page?.total ?? null,
    },
  };
}

export async function listPolicyAreasFromApi(session?: string): Promise<PolicyArea[]> {
  const params = new URLSearchParams();
  params.set('limit', '50');
  if (session?.trim()) {
    params.set('session', session.trim());
  }

  const response = await publicApiRequest<PageResponse<ApiPolicyAreaPayload>>(
    `/policy-areas?${params.toString()}`,
  );

  return response.data
    .filter((item) => item.name.trim().length > 0)
    .map((item) => ({ name: item.name.trim(), billCount: item.bill_count }));
}

interface ApiMetaPayload {
  api_version: string;
  data_as_of?: string | null;
}

export interface Meta {
  dataAsOf: string | null;
}

export async function getMetaFromApi(): Promise<Meta> {
  const response = await publicApiRequest<DetailResponse<ApiMetaPayload>>('/meta');
  return { dataAsOf: response.data.data_as_of ?? null };
}

export async function listSessionsFromApi(): Promise<LegislativeSession[]> {
  const response = await publicApiRequest<PageResponse<ApiSessionPayload>>('/sessions');

  return response.data.map((session) => ({
    slug: session.slug,
    name: session.name,
    isCurrent: session.is_current,
  }));
}

export async function getBillFromApi(
  billId: string,
): Promise<(Bill & { sponsorNames: string[] }) | null> {
  const apiBillId = normalizeBillIdForApi(billId);
  const [detailResponse, votesResponse] = await Promise.all([
    publicApiRequest<DetailResponse<ApiBillDetailPayload>>(
      `/bills/${encodeURIComponent(apiBillId)}?include=all_sponsors,actions,versions,topics,ai_analysis,progress`,
    ),
    publicApiRequest<PageResponse<ApiBillVotePayload>>(
      `/bills/${encodeURIComponent(apiBillId)}/votes`,
    ),
  ]);

  return mapBillDetail(detailResponse.data, votesResponse.data);
}

// The API paginates the legislator list (max 100 per page) and has no party
// filter, while the directory screen wants the whole roster to filter, count,
// and page client-side. So page through until has_more is false and return the
// full set. Two requests at ~200 members today; the guard caps a pathological
// loop.
const LEGISLATOR_PAGE_LIMIT = 100;
const LEGISLATOR_MAX_PAGES = 50;

export async function listLegislatorsFromApi(
  query?: string,
  session?: string,
  filters: LegislatorListFilters = {},
): Promise<Legislator[]> {
  const items: ApiLegislatorListItemPayload[] = [];
  for (let pageIndex = 0; pageIndex < LEGISLATOR_MAX_PAGES; pageIndex += 1) {
    const params = new URLSearchParams();
    params.set('limit', String(LEGISLATOR_PAGE_LIMIT));
    params.set('offset', String(pageIndex * LEGISLATOR_PAGE_LIMIT));
    if (query?.trim()) {
      params.set('q', query.trim());
    }
    if (session?.trim()) {
      params.set('session', session.trim());
    }
    if (filters.chamber) {
      params.set('chamber', filters.chamber.toLowerCase());
    }

    const response = await publicApiRequest<PageResponse<ApiLegislatorListItemPayload>>(
      `/legislators?${params.toString()}`,
    );
    items.push(...response.data);
    if (!response.page?.has_more || response.data.length === 0) {
      break;
    }
  }

  return items.map(mapLegislator);
}

export async function lookupRepresentativeFromApi(
  input: RepresentativeLookupInput,
): Promise<RepresentativeLookupResult | null> {
  const body =
    typeof input === 'string'
      ? { address_text: input.trim() }
      : { latitude: input.latitude, longitude: input.longitude };

  if ('address_text' in body && !body.address_text) {
    return null;
  }

  const response = await publicApiPost<DetailResponse<ApiRepresentativeLookupPayload>>(
    '/representative-lookups',
    body,
  );

  return mapRepresentativeLookup(response.data);
}

export async function getLegislatorFromApi(legislatorId: string): Promise<Legislator | null> {
  const response = await publicApiRequest<DetailResponse<ApiLegislatorDetailPayload>>(
    `/legislators/${encodeURIComponent(legislatorId)}?include=current_service,committees,stats`,
  );

  return mapLegislator(response.data);
}

export async function getLegislatorBillsFromApi(
  legislatorId: string,
  pagination: ListPagination = {},
): Promise<PaginatedResult<Bill & { sponsorNames: string[] }>> {
  const limit = pagination.limit ?? 20;
  const offset = pagination.offset ?? 0;
  const params = new URLSearchParams();
  params.set('limit', String(limit));
  params.set('offset', String(offset));
  if (pagination.role) params.set('role', pagination.role);
  if (pagination.session) params.set('session', pagination.session);

  const response = await publicApiRequest<PageResponse<ApiBillListItemPayload>>(
    `/legislators/${encodeURIComponent(legislatorId)}/bills?${params.toString()}`,
  );

  return {
    data: response.data.map(mapBillSummary),
    page: {
      limit: response.page?.limit ?? limit,
      offset: response.page?.offset ?? offset,
      nextCursor: response.page?.next_cursor,
      hasMore: response.page?.has_more ?? false,
      total: response.page?.total ?? null,
    },
  };
}

export async function listTrackedBillsFromApi(
  accessToken: string,
): Promise<Array<Bill & { sponsorNames: string[] }>> {
  const response = await apiRequest<CollectionResponse<ApiTrackedBillPayload>>(
    '/me/tracked-bills',
    { method: 'GET' },
    accessToken,
  );

  return response.data
    .filter((tracked) => tracked.bill)
    .map((tracked) => mapBillSummary(tracked.bill as ApiBillListItemPayload));
}

export async function toggleTrackedBillFromApi(accessToken: string, billId: string): Promise<void> {
  const trackedBills = await apiRequest<CollectionResponse<ApiTrackedBillPayload>>(
    '/me/tracked-bills',
    { method: 'GET' },
    accessToken,
  );
  const isTracked = trackedBills.data.some((tracked) => tracked.bill_id === billId);

  if (isTracked) {
    await apiRequest<void>(
      `/me/tracked-bills/${encodeURIComponent(billId)}`,
      { method: 'DELETE' },
      accessToken,
    );
    return;
  }

  await apiRequest<DetailResponse<ApiTrackedBillPayload>>(
    `/me/tracked-bills/${encodeURIComponent(billId)}`,
    {
      method: 'PUT',
      body: JSON.stringify({
        alerts_enabled: true,
        note: null,
      }),
    },
    accessToken,
  );
}
