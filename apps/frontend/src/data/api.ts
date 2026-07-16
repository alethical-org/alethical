import { Platform } from 'react-native';
import {
  AskAnswer,
  AskAnswerBill,
  Bill,
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

export type BillSort = 'latest_action' | 'progress' | 'introduced' | 'newest';

export interface BillListFilters {
  chamber?: Chamber;
  status?: string;
  policyArea?: string;
  omnibus?: boolean;
  // Result ordering. Omitted → API default (latest_action). 'progress' orders
  // by legislative stage (signed → … → proposed), tie-broken by recency (#292).
  // 'introduced' orders by real introduction date desc (most recently introduced
  // first) — the date-backed sort the mobile home Bill Activity uses now that
  // action dates are ingested (#328/#329). 'newest' orders by file number desc
  // (MN numbers bills at introduction); it was the recency proxy before dates
  // landed.
  sort?: BillSort;
}

export interface LegislatorListFilters {
  chamber?: Chamber;
}

export interface ListPagination {
  limit?: number;
  offset?: number;
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
  html_url?: string | null;
  pdf_url?: string | null;
  is_current: boolean;
}

interface ApiTopicPayload {
  slug: string;
  name: string;
}

interface ApiBillDetailPayload {
  id: string;
  title: string;
  description?: string | null;
  current_status?: string | null;
  status_key?: string | null;
  latest_action_at?: string | null;
  official_url?: string | null;
  chief_sponsors: ApiSponsorPayload[];
  all_sponsors?: ApiSponsorPayload[] | null;
  progress?: ApiBillProgressStepPayload[] | null;
  actions?: ApiBillActionPayload[] | null;
  versions?: ApiBillVersionPayload[] | null;
  topics?: ApiTopicPayload[] | null;
  ai_analysis?: ApiAiAnalysisPayload | null;
}

interface ApiBillProgressStepPayload {
  key: string;
  label: string;
  reached: boolean;
  current?: boolean;
}

interface ApiAiAnalysisPayload {
  short_title?: string | null;
  summary?: string | null;
  key_points?: string[] | null;
  policy_areas?: string[] | null;
}

interface ApiBillVotePayload {
  id: string;
  motion_text?: string | null;
  result_text?: string | null;
  yes_count?: number | null;
  no_count?: number | null;
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

function usefulActionDescription(action: ApiBillActionPayload) {
  const description = action.action_description?.trim();
  const text = action.action_text?.trim();
  const value = description || text;
  if (!value || value.toLowerCase() === 'updated unknown') {
    return '';
  }
  return value;
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
        !/^click to subscribe/i.test(line),
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
  const committees =
    'committees' in payload
      ? (payload.committees ?? []).map((committee) =>
          committee.role ? `${committee.name} (${committee.role})` : committee.name,
        )
      : [];
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
    committees,
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
    actions: (payload.actions ?? [])
      .map((action) => ({
        id: `${payload.id}-action-${action.action_number}`,
        date: formatOptionalDate(action.action_at),
        description: usefulActionDescription(action),
      }))
      .filter((action) => action.date || action.description.length > 12),
    versions: (payload.versions ?? []).map((version) => ({
      id: `${payload.id}-version-${version.version_code}`,
      label: version.version_name ?? version.version_code,
      date: version.is_current ? 'Current version' : '',
      summary: version.version_code,
      url: version.html_url ?? version.pdf_url ?? payload.official_url ?? '',
    })),
    votes: votes.map((vote) => ({
      id: vote.id,
      motion: vote.motion_text ?? 'Vote',
      date: '',
      result: vote.result_text ?? 'Result unavailable',
      breakdown: {
        yes: vote.yes_count ?? 0,
        no: vote.no_count ?? 0,
        absent: 0,
      },
      votes: [],
    })),
    citations: [],
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
