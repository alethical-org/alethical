import { Platform } from 'react-native';
import {
  completeDanglingTitle,
  completeStatusText,
  STATUS_LABELS,
  statusLabel,
  TRAILING_REFERRAL,
  TRAILING_RETURN,
} from '../lib/billDetail';
import type { FilingScheduleState } from '../lib/legislatorCampaignMoney';
import type { PaymentNameRole, PaymentUnderName } from '../lib/paymentsUnderName';
import type { SourceBlock } from '../lib/billText';
import type { SiteMetricEventName, SiteMetricRecordTotals } from '../lib/traffic';
import { contactEmail, senateProfileUrl } from '../lib/findMyLegislator';
import { LEGISLATOR_ROSTER_LIMIT } from '../lib/directoryPagination';
import { publicReadResponse } from '../lib/publicRead';
import { normalizeLegislativeYearRanges } from '../lib/sessionLabel';
import { legislativeServiceFromHistory } from '../lib/legislatorProfile';
import {
  outsideSpendingLoadFailure,
  type OutsideSpendingState,
  type OutsideSpendingYear,
} from '../lib/outsideSpending';
import {
  AskAnswer,
  AskAnswerBill,
  Bill,
  BillAction,
  BillSponsor,
  Chamber,
  ChatSession,
  Citation,
  CommitteeFilingsPage,
  CommitteeIndependentPayment,
  CommitteeOutsideSpendingPage,
  CommitteeOutsideSpendingRow,
  CommitteeMadePayment,
  CommitteeMoney,
  TrackedCommittee,
  CommitteePaymentsPage,
  CommitteeReceivedPayment,
  CommitteeRegisterPage,
  CommitteeRegisterRow,
  LegislativeSession,
  Legislator,
  LegislatorCampaignMoney,
  LegislatorVote,
  MoneyFilingsFeed,
  MoneyLandingSummary,
  NameSearchAnswer,
  NameSearchGroup,
  NameSearchRow,
  RepresentativeAddressChoice,
  RepresentativeLookupInput,
  RepresentativeLookupResult,
  VoteEvent,
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
  sign_in_methods?: { google: boolean; password: boolean } | null;
}

interface ApiSponsorPayload {
  name: string;
  role: string;
  legislator_id?: string | null;
  slug?: string | null;
  source_order?: number | null;
  source_chamber?: string | null;
  chamber?: string | null;
  party?: string | null;
  district?: string | null;
  represented_city?: string | null;
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
  session?: ApiSessionPayload | null;
  current_status?: string | null;
  status_key?: string | null;
  latest_action_at?: string | null;
  official_url?: string | null;
  is_omnibus?: boolean;
  effective_date?: string | null;
  chief_sponsors: ApiSponsorPayload[];
  co_author_count?: number;
  companion?: ApiCompanionPayload | null;
  stats?: ApiBillStatsPayload | null;
  ai_analysis?: ApiAiAnalysisPayload | null;
  actions?: ApiBillActionPayload[] | null;
}

interface ApiPolicyAreaPayload {
  name: string;
  bill_count: number;
}

interface ApiAskTopicBillsAnswerPayload {
  topic?: string | null;
  session: ApiSessionPayload;
  data_as_of?: string | null;
  total_matches: number;
  bills: ApiBillListItemPayload[];
  latest_action_bills?: ApiBillListItemPayload[] | null;
  ambiguous_reference?: string | null;
}

interface ApiAskLegislatorBillPayload {
  id: string;
  file_type: string;
  file_number: number;
  title: string;
}

interface ApiAskLegislatorPayload {
  id: string;
  slug?: string | null;
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
  session: ApiSessionPayload;
  data_as_of?: string | null;
  total_matches: number;
  total_bills: number;
  legislators: ApiAskLegislatorPayload[];
}

interface ApiAskVoteDeflectionAnswerPayload {
  session: ApiSessionPayload;
  data_as_of?: string | null;
  resolved_bill?: ApiBillListItemPayload | null;
  topic_bills?: ApiAskTopicBillsAnswerPayload | null;
}

interface ApiAskCitationPayload {
  label: string;
  bill_id: string;
  excerpt: string;
  url: string;
  section_id?: string | null;
  section_order?: number | null;
  section_topic?: string | null;
  section_available?: boolean | null;
}

interface ApiAskBillTextAnswerPayload {
  answer: string;
  citations: ApiAskCitationPayload[];
  bill: ApiBillListItemPayload;
  session: ApiSessionPayload;
  data_as_of?: string | null;
  question?: string | null;
  bill_last_pulled_at?: string | null;
  coverage?: { used: number; total: number; enumerating?: boolean } | null;
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
  is_current?: boolean;
  session_number?: number;
  year_start?: number;
  year_end?: number;
}

function mapSession(payload: ApiSessionPayload): LegislativeSession {
  const years = payload.name.match(/\b(20\d{2})\b(?:\s*[-–]\s*(20\d{2}))?/);
  const number = payload.name.match(/\b(\d+)(?:st|nd|rd|th)\s+Legislature\b/i);
  return {
    slug: payload.slug,
    name: payload.name,
    isCurrent: payload.is_current ?? false,
    sessionNumber: payload.session_number ?? Number(number?.[1] ?? 0),
    yearStart: payload.year_start ?? Number(years?.[1] ?? 0),
    yearEnd: payload.year_end ?? Number(years?.[2] ?? years?.[1] ?? 0),
  };
}

export type BillSort = 'relevance' | 'latest_action' | 'progress' | 'introduced';

export interface BillListFilters {
  chamber?: Chamber;
  status?: string;
  // Issue filter. Several issues are OR'd server-side (a bill tagged ANY of them
  // matches — Search Bills v2); each is sent as its own repeated `policy_area`
  // query param. Empty/omitted → no issue filter (all issues).
  policyAreas?: string[];
  scope?: 'legislature';
  omnibus?: boolean;
  // Result ordering. Omitted → API default (relevance for a free-text search,
  // latest_action otherwise). 'relevance' is Search Bills' "Best match": closest
  // keyword match first, tie-broken by progress. 'progress' orders by legislative
  // stage (signed → … → proposed), tie-broken by recency (#292). 'introduced'
  // orders by real introduction date desc (most recently introduced first) — the
  // date-backed sort the mobile home Bill Activity uses.
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

interface ApiTrackedCommitteePayload {
  registration_number: string;
  tracked_at: string;
  committee_name?: string | null;
  entity_type?: string | null;
  entity_sub_type?: string | null;
  register: {
    state: 'reported' | 'not_registered' | 'unavailable';
    kind?: string | null;
    name?: string | null;
    office?: string | null;
    district?: string | null;
    termination_date?: string | null;
  };
}

interface ApiBillActionPayload {
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
  represented_city?: string | null;
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
  service_history?: ApiServiceHistoryPayload | null;
  issue_areas?: string[] | null;
}

interface ApiElectionPeriodPayload {
  chamber: string;
  initial_year: number;
  reelection_years: number[];
}

interface ApiServiceHistoryPayload {
  term?: number | null;
  periods: ApiElectionPeriodPayload[];
}

interface ApiLegislatorDetailPayload extends ApiLegislatorListItemPayload {
  biography?: string | null;
  service_history?: ApiServiceHistoryPayload | null;
}

interface ApiRepresentativeLookupPayload {
  status: 'found' | 'address-choice';
  session?: ApiSessionPayload | null;
  source_updated_at?: string | null;
  resolved_place: {
    input_mode?: string | null;
    address_text?: string | null;
    matched_address?: string | null;
    latitude?: number | null;
    longitude?: number | null;
    house_district?: string | null;
    senate_district?: string | null;
    other_house_district?: string | null;
    congressional_district?: string | null;
    house_geometry?: RepresentativeLookupResult['houseGeometry'] | null;
    senate_geometry?: RepresentativeLookupResult['senateGeometry'] | null;
  };
  address_choices?: Array<{
    matched_address: string;
    latitude: number;
    longitude: number;
  }> | null;
  house_legislator?: ApiLegislatorListItemPayload | null;
  senate_legislator?: ApiLegislatorListItemPayload | null;
}

interface ApiAddressSuggestionsPayload {
  suggestions: Array<{
    matched_address: string;
    latitude: number;
    longitude: number;
    state_code?: string | null;
  }>;
}

interface ApiBillVersionPayload {
  version_code: string;
  version_name?: string | null;
  document_date?: string | null;
  html_url?: string | null;
  pdf_url?: string | null;
  is_current: boolean;
}

interface ApiBillVersionTextPayload {
  version_code: string;
  sections: Array<{
    section_id: string;
    // The section's 1-based position in the version. `section_id` repeats across
    // sections on 66 current versions, so the position is what addresses one of
    // them (#854). Optional so a cached response from before it was served still
    // parses — those sections fall back to the id-only anchor.
    source_order?: number | null;
    heading?: string | null;
    article_heading?: string | null;
    text: string;
    // The body as ordered blocks, keeping the subdivision numbers, added-text
    // marks and table shape that flattening to `text` destroys (#741). Null on a
    // section not yet re-read from the Revisor, where `text` is all there is.
    body_blocks?: SourceBlock[] | null;
  }>;
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
  // The bill's own session. A special session is a separate session whose files
  // are numbered from 1 all over again, so the page can't assume the current one
  // (#746). Optional so an older cached response still maps.
  session?: ApiSessionPayload | null;
  description?: string | null;
  current_status?: string | null;
  status_key?: string | null;
  latest_action_at?: string | null;
  // When we last pulled this bill from the Legislature (#861) — the source line's
  // date. Optional so an older cached response still maps.
  last_pulled_at?: string | null;
  // Verbatim statutory effective date (e.g. "July 1, 2027"), present only when
  // the enacted bill text states one unambiguously (#483); absent otherwise.
  effective_date?: string | null;
  // The full EFFECTIVE story for a signed law (#715): one shared date, or one row
  // per date a phased law states about itself. Absent -> LATEST ACTION fallback.
  effective_schedule?: {
    kind: 'single' | 'phased';
    value: string | null;
    rows: Array<{ date: string; sections: number; from_enactment: boolean }>;
    total_sections: number;
    undated_sections: number;
    default_candidates: string[];
  } | null;
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
  section_id: string;
  section_topic?: string | null;
  // Position of the cited section in the version, when the API could pin the
  // citation to one (#854). Absent otherwise.
  section_order?: number | null;
}

interface ApiAiAnalysisPayload {
  short_title?: string | null;
  summary?: string | null;
  key_points?: string[] | null;
  policy_areas?: string[] | null;
  // Per-key-point source anchors (#377); empty until the corpus is re-enriched.
  citations?: ApiAiCitationPayload[] | null;
  // Bill-specific Ask chips (#550); empty until the corpus is re-enriched.
  question_prompts?: string[] | null;
}

interface ApiBillVoteRecordPayload {
  legislator_id: string;
  slug?: string | null;
  legislator_name?: string | null;
  party?: string | null;
  vote_value: string;
}

interface ApiBillVotePayload {
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

interface ApiLegislatorCampaignMoneyPayload {
  legislator_id: string;
  year: number;
  link_state: LegislatorCampaignMoney['linkState'];
  other_office_committees?: number;
  committees_outside_this_year?: {
    registration_number: string;
    committee_name_as_reviewed: string;
    closed_on?: string | null;
  }[];
  release_id: string;
  fetched_at?: string | null;
  committees: {
    registration_number: string;
    committee_name_as_reviewed: string;
    committee_name?: string | null;
    office?: string | null;
    checked?: {
      checked_on: string;
      name_evidence?: string | null;
      register_verdict?: string | null;
      party_agreement?: string | null;
    } | null;
    money_in?: {
      state: NonNullable<LegislatorCampaignMoney['committees'][number]['moneyIn']>['state'];
      itemized_contribution_total?: string | null;
      itemized_contribution_payments?: number | null;
      other_receipts?: { receipt_type: string; total: string; payments: number }[];
      reported_period_start?: string | null;
      source_url?: string | null;
    } | null;
    money_out?: {
      state: NonNullable<LegislatorCampaignMoney['committees'][number]['moneyOut']>['state'];
      itemized_payment_total?: string | null;
      itemized_payments?: number | null;
      in_kind_total?: string | null;
      reported_total?: string | null;
      reported_through?: string | null;
      stated_spending_state?: string | null;
      by_type?: { type: string; total: string; payments: number }[];
      source_url?: string | null;
    } | null;
    split: {
      state: LegislatorCampaignMoney['committees'][number]['split']['state'];
      reported_total?: string | null;
      reported_through?: string | null;
      named_total?: string | null;
      named_payments?: number | null;
      named_cash_total?: string | null;
      named_in_kind_total?: string | null;
      unnamed_total?: string | null;
      stated_split_state?: string;
      first_payment_on?: string | null;
      last_payment_on?: string | null;
    };
    filing_schedule?: {
      state?: string | null;
      next_report_name?: string | null;
      next_report_due_on?: string | null;
      period_start?: string | null;
      period_end?: string | null;
      condition?: string | null;
      terminated_on?: string | null;
    } | null;
  }[];
}

interface ApiLegislatorVotePayload {
  id: string;
  vote_value: string;
  vote_event_id: string;
  bill_id?: string | null;
  bill_code?: string | null;
  occurred_at?: string | null;
  chamber?: string | null;
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

/**
 * A failed API response, carrying the HTTP status that the message alone loses.
 *
 * Callers need to tell a PERMANENT failure from a transient one: a 404 for a bill
 * that does not exist will never succeed, so retrying it and telling the reader to
 * "try again in a moment" wastes their time and reads as our site being broken
 * rather than the link being wrong (#720). Still a plain `Error` carrying the same
 * message, so anything already catching `Error` is unaffected.
 */
export class ApiError extends Error {
  readonly status: number;
  /**
   * The API's machine-readable reason, from the RFC7807 `type` field, reduced to
   * its last path segment (`account-deactivated`). Null when the body was not a
   * problem document, which covers every non-JSON error the fetch can produce.
   *
   * The status code alone is not enough to act on: two different 403s mean two
   * different things to the reader, and until #1092 nothing could tell them
   * apart because the body was only ever kept as an unparsed string.
   */
  readonly problem: string | null;
  readonly retryAfterSeconds: number | null;

  constructor(
    status: number,
    message: string,
    problem: string | null = null,
    retryAfterSeconds: number | null = null,
  ) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.problem = problem;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

/** The `type` slug out of an RFC7807 body, or null if this is not one. */
function problemSlug(body: string): string | null {
  try {
    const parsed: unknown = JSON.parse(body);
    if (!parsed || typeof parsed !== 'object') {
      return null;
    }
    const type = (parsed as { type?: unknown }).type;
    return typeof type === 'string' ? (type.split('/').pop() ?? null) : null;
  } catch {
    return null;
  }
}

/**
 * Build the error from a raw response body, parsing the problem type out of it.
 *
 * Exported because this is the seam that actually decides whether a reader gets
 * signed out: `isAccountDeactivatedError` only compares two fields, so a test
 * that constructs `ApiError` by hand proves nothing about the parsing (#1092).
 */
export function apiErrorFromBody(
  status: number,
  body: string,
  retryAfterHeader: string | null = null,
): ApiError {
  const retryAfterSeconds = /^\d+$/.test(retryAfterHeader ?? '') ? Number(retryAfterHeader) : null;
  return new ApiError(
    status,
    body || `API request failed with ${status}`,
    problemSlug(body),
    Number.isSafeInteger(retryAfterSeconds) ? retryAfterSeconds : null,
  );
}

/** True when the API said the thing does not exist, so there is nothing to retry. */
export function isNotFoundError(error: unknown): boolean {
  return error instanceof ApiError && error.status === 404;
}

/**
 * True when the API refused because this account has been deactivated.
 *
 * Matched on the problem type rather than the 403 alone: signing the reader out
 * is the right answer to *this* refusal and the wrong answer to any other one.
 */
export function isAccountDeactivatedError(error: unknown): boolean {
  return (
    error instanceof ApiError && error.status === 403 && error.problem === 'account-deactivated'
  );
}

type DeactivatedHandler = (requestAccessToken: string) => void;
let deactivatedHandler: DeactivatedHandler | null = null;

/**
 * Register what to do when any request finds the account deactivated. The auth
 * provider owns the answer (drop the dead session and say so); this module only
 * notices, because it is the one place every authenticated request goes through.
 *
 * Returns an unsubscribe so a re-mount cannot leave two handlers behind.
 */
export function onAccountDeactivated(handler: DeactivatedHandler): () => void {
  deactivatedHandler = handler;
  return () => {
    if (deactivatedHandler === handler) {
      deactivatedHandler = null;
    }
  };
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
    const error = apiErrorFromBody(
      response.status,
      await response.text(),
      response.headers.get('Retry-After'),
    );
    if (isAccountDeactivatedError(error)) {
      // Every authenticated request comes through here, so whichever one the
      // reader happened to trigger is enough to notice. Without this the app
      // keeps showing them as signed in while nothing of theirs works (#1092).
      deactivatedHandler?.(accessToken);
    }
    throw error;
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return (await response.json()) as T;
}

async function publicApiRequest<T>(path: string): Promise<T> {
  const response = await publicReadResponse(publicApiUrl(path), {
    method: 'GET',
    headers: {
      Accept: 'application/json',
    },
  });

  if (!response.ok) {
    throw apiErrorFromBody(
      response.status,
      await response.text(),
      response.headers.get('Retry-After'),
    );
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
    throw apiErrorFromBody(
      response.status,
      await response.text(),
      response.headers.get('Retry-After'),
    );
  }

  return (await response.json()) as T;
}

export async function getSiteMetricRecordTotalsFromApi(): Promise<SiteMetricRecordTotals> {
  const response = await publicApiRequest<DetailResponse<SiteMetricRecordTotals>>('/site-metrics');
  return response.data;
}

export async function recordSiteMetricEventFromApi(
  event: SiteMetricEventName,
  accessToken?: string | null,
): Promise<void> {
  const response = await fetch(publicApiUrl('/site-metrics/events'), {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : null),
    },
    body: JSON.stringify({ event }),
  });
  if (!response.ok) {
    throw apiErrorFromBody(
      response.status,
      await response.text(),
      response.headers.get('Retry-After'),
    );
  }
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
    slug: payload.slug ?? undefined,
    chamber: toOptionalChamber(payload.chamber ?? payload.source_chamber),
    party: payload.party ?? undefined,
    district: payload.district ?? undefined,
    representedCity: payload.represented_city ?? undefined,
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

  return normalizeLegislativeYearRanges(raw || trimmedCode || 'Bill version');
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
function mapBillAction(action: ApiBillActionPayload, billId: string): BillAction | null {
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

// Bill-specific Ask chips (#550): short questions the enrichment generated to be
// answerable purely from this bill's text. Empty until the corpus is re-enriched,
// which is when the SummaryTab falls back to its generic chips.
function questionPromptsFromPayload(analysis: ApiAiAnalysisPayload | null | undefined): string[] {
  if (!analysis || !Array.isArray(analysis.question_prompts)) {
    return [];
  }
  return analysis.question_prompts
    .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    .map((item) => item.trim());
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
      sectionId: typeof c.section_id === 'string' ? c.section_id.trim() : '',
      sectionTopic: typeof c.section_topic === 'string' ? c.section_topic.trim() : '',
      sectionOrder: typeof c.section_order === 'number' ? c.section_order : null,
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
        !/^toll free:/i.test(line) &&
        !/(?:newsletter|minority leader|majority leader)$/i.test(line) &&
        !/^[\d\s().+-]{7,}$/.test(line),
    );
  const unique = lines.filter((line, index) => lines.indexOf(line) === index);
  return unique.join('\n') || undefined;
}

export function mapLegislator(
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
    slug: payload.slug ?? undefined,
    name: displayName,
    shortName: shortName(displayName),
    chamber,
    district,
    party,
    role: legislatorRole(payload),
    // No biography → leave it undefined. This mapper handles both the list and the
    // detail payload, and the LIST payload has no `biography` key at all — so the
    // stand-in sentence this used to substitute ("Live legislator profile loaded
    // from the backend.") became the biography of every legislator built from a
    // list item, and LegislatorCard printed it verbatim on the Find My Legislator
    // results. It also forced the two redesigned profile screens to filter that
    // exact string back out, so the sentence had to stay spelled identically in
    // three files to keep working. Undefined instead: every surface checks.
    bio: ('biography' in payload ? payload.biography : null) ?? undefined,
    email: contactEmail(service?.email),
    phone: service?.phone ?? undefined,
    officeAddress: cleanOfficeAddress(service?.office_address),
    representedCity: service?.represented_city ?? undefined,
    profileUrl: senateProfileUrl(service?.profile_url ?? undefined),
    photoUrl: service?.photo_url ?? undefined,
    committees,
    committeeAssignments,
    issueAreas: payload.issue_areas ?? undefined,
    totalAuthoredBills: stats?.total_bill_count,
    chiefAuthoredBills: stats?.chief_bill_count,
    focusAreas,
    // Legislative Service history now comes from the scraped bio (issue #486);
    // the old fabricated single "2025–present" entry is gone.
    serviceHistory: [],
    legislativeService:
      'service_history' in payload ? legislativeServiceFromHistory(payload.service_history) : null,
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
  const houseLegislator = payload.house_legislator
    ? mapLegislator(payload.house_legislator)
    : undefined;
  const senateLegislator = payload.senate_legislator
    ? mapLegislator(payload.senate_legislator)
    : undefined;
  const legislators = [senateLegislator, houseLegislator].filter((item): item is Legislator =>
    Boolean(item),
  );
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
    status: payload.status,
    address:
      payload.resolved_place.matched_address ??
      payload.resolved_place.address_text ??
      coordinateLabel,
    districtSummary: districts.join(', ') || 'No districts returned',
    legislators,
    houseLegislator,
    senateLegislator,
    choices: payload.address_choices?.map((choice) => ({
      matchedAddress: choice.matched_address,
      latitude: choice.latitude,
      longitude: choice.longitude,
    })),
    coordinate:
      payload.resolved_place.latitude != null && payload.resolved_place.longitude != null
        ? {
            latitude: payload.resolved_place.latitude,
            longitude: payload.resolved_place.longitude,
          }
        : undefined,
    houseDistrict: payload.resolved_place.house_district ?? undefined,
    senateDistrict: payload.resolved_place.senate_district ?? undefined,
    otherHouseDistrict: payload.resolved_place.other_house_district ?? undefined,
    congressionalDistrict: payload.resolved_place.congressional_district ?? undefined,
    houseGeometry: payload.resolved_place.house_geometry ?? undefined,
    senateGeometry: payload.resolved_place.senate_geometry ?? undefined,
    session: payload.session ? mapSession(payload.session) : undefined,
    sourceUpdatedAt: payload.source_updated_at ?? undefined,
  };
}

function mapBillSummary(payload: ApiBillListItemPayload): Bill & { sponsorNames: string[] } {
  return {
    id: payload.id,
    identifier: formatBillIdentifier(payload.file_type, payload.file_number),
    title: payload.title,
    chamber: toChamber(payload.file_type),
    status: statusLabel(payload.status_key, payload.current_status),
    latestActionText: completeStatusText(payload.current_status, payload.actions),
    isOmnibus: payload.is_omnibus ?? false,
    effectiveDate: payload.effective_date ?? undefined,
    updatedAt: formatUpdatedAt(payload.latest_action_at),
    sessionLabel: 'Current session',
    session: payload.session ? mapSession(payload.session) : undefined,
    topics: [],
    chiefSponsorIds: payload.chief_sponsors.map((sponsor) => sponsor.legislator_id ?? sponsor.name),
    chiefSponsorSlugs: payload.chief_sponsors.map((sponsor) => sponsor.slug ?? null),
    coAuthorCount: payload.co_author_count ?? 0,
    companion: payload.companion
      ? {
          id: payload.companion.id,
          identifier: payload.companion.code,
          chamber: toChamber(payload.companion.code.split(' ')[0]),
          status: statusLabel(payload.companion.status_key, payload.companion.status),
        }
      : null,
    sponsors: payload.chief_sponsors.map(mapSponsor),
    progress: defaultProgress(),
    actionCount: payload.stats?.action_count ?? 0,
    versionCount: payload.stats?.version_count ?? 0,
    rollCallCount: payload.stats?.vote_event_count ?? 0,
    briefing: emptyBriefing(),
    aiAnalysis: aiAnalysisFromPayload(payload.ai_analysis),
    questionPrompts: questionPromptsFromPayload(payload.ai_analysis),
    // Full action feed (the list endpoint now ships it) so a result card can
    // render the same curated latest-action line as the Bill Detail Actions tab.
    actions: dedupeActions(
      (payload.actions ?? [])
        .map((action) => mapBillAction(action, payload.id))
        .filter((action): action is BillAction => action !== null),
    ),
    versions: [],
    votes: [],
    citations: [],
    officialLinks: payload.official_url
      ? [{ id: `${payload.id}-official`, label: 'Official bill page', url: payload.official_url }]
      : [],
    sponsorNames: payload.chief_sponsors.map((sponsor) => sponsor.name),
  };
}

export function mapBillDetail(
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
    latestActionText: completeStatusText(payload.current_status, payload.actions),
    updatedAt: formatUpdatedAt(payload.latest_action_at),
    lastPulledAt: payload.last_pulled_at ?? undefined,
    effectiveDate: payload.effective_date ?? undefined,
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
    sessionLabel: payload.session?.name ?? 'Current session',
    session: payload.session ? mapSession(payload.session) : undefined,
    topics: (payload.topics ?? []).map((topic) => topic.name),
    chiefSponsorIds: payload.chief_sponsors.map((sponsor) => sponsor.legislator_id ?? sponsor.name),
    chiefSponsorSlugs: payload.chief_sponsors.map((sponsor) => sponsor.slug ?? null),
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
    questionPrompts: questionPromptsFromPayload(payload.ai_analysis),
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
      isCurrentPointer: version.version_code.trim().toLowerCase() === 'current',
      versionCode: version.version_code,
      isCurrent: version.is_current ?? false,
    })),
    votes: mapBillVotes(votes),
    citations: citationsFromAnalysis(payload.ai_analysis),
    officialLinks: payload.official_url
      ? [{ id: `${payload.id}-official`, label: 'Official bill page', url: payload.official_url }]
      : [],
    sponsorNames: payload.chief_sponsors.map((sponsor) => sponsor.name),
  };
}

function mapBillVotes(votes: ApiBillVotePayload[]): VoteEvent[] {
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
    // Chat citations don't carry a statute-section anchor (Bill Text is a
    // bill-detail feature); empty so it never resolves to a Bill Text section.
    sectionId: '',
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

export async function getCurrentUserFromApi(accessToken: string): Promise<{
  id: string;
  name: string;
  email: string;
  signInMethods: { google: boolean; password: boolean } | null;
}> {
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
    signInMethods: response.data.sign_in_methods ?? null,
  };
}

export interface PendingTrackAction {
  reference: string;
  expiresAt: string;
}

export interface CompletedPendingTrackAction {
  action: 'track_bill';
  billId: string;
  returnPath: string;
}

/** Save one signed-out Track press without attaching it to any account yet. */
export async function createPendingTrackActionFromApi(
  billId: string,
  returnPath: string,
): Promise<PendingTrackAction> {
  const response = await publicApiPost<DetailResponse<{ reference: string; expires_at: string }>>(
    '/pending-actions',
    {
      action: 'track_bill',
      bill_id: billId,
      return_path: returnPath,
    },
  );
  return { reference: response.data.reference, expiresAt: response.data.expires_at };
}

/** Perform a saved Track press once, then consume its random reference. */
export async function completePendingTrackActionFromApi(
  accessToken: string,
  reference: string,
  signal?: AbortSignal,
): Promise<CompletedPendingTrackAction> {
  const response = await apiRequest<
    DetailResponse<{ action: 'track_bill'; bill_id: string; return_path: string }>
  >(
    '/me/pending-actions/complete',
    {
      method: 'POST',
      body: JSON.stringify({ action: 'track_bill', reference }),
      signal,
    },
    accessToken,
  );
  return {
    action: response.data.action,
    billId: response.data.bill_id,
    returnPath: response.data.return_path,
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
  return mapAskAnswerPayload(response.data);
}

export type ContactMessageInput = {
  requestId: string;
  name: string;
  email: string;
  phone: string;
  subject: string;
  message: string;
};

export async function sendContactMessageFromApi(
  input: ContactMessageInput,
): Promise<{ status: 'accepted' }> {
  return publicApiPost<{ status: 'accepted' }>('/contact', {
    request_id: input.requestId,
    name: input.name,
    email: input.email,
    phone: input.phone,
    subject: input.subject,
    message: input.message,
  });
}

export async function getSavedSuggestedAnswerFromApi(
  billId: string,
  suggestionIndex: number,
): Promise<AskAnswer | null> {
  try {
    const response = await publicApiRequest<DetailResponse<ApiAskAnswerPayload>>(
      `/ask/suggestions/${encodeURIComponent(billId)}/${suggestionIndex}`,
    );
    return mapAskAnswerPayload(response.data);
  } catch (error) {
    if (isNotFoundError(error)) {
      return null;
    }
    throw error;
  }
}

function mapAskAnswerPayload(payload: ApiAskAnswerPayload): AskAnswer {
  const answer = payload.answer;

  const mapBill = (bill: ApiBillListItemPayload): AskAnswerBill => ({
    session: bill.session ? mapSession(bill.session) : undefined,
    id: bill.id,
    identifier: formatBillIdentifier(bill.file_type, bill.file_number),
    title: bill.title,
    shortTitle: bill.ai_analysis?.short_title ?? undefined,
    status: statusLabel(bill.status_key, bill.current_status),
    statusKey: bill.status_key ?? undefined,
    summary: bill.ai_analysis?.summary ?? undefined,
    officialUrl: bill.official_url ?? undefined,
    policyAreas: bill.ai_analysis?.policy_areas ?? undefined,
  });

  // Topic answers use the same full card as Bill Search. Keep the narrow mapper
  // above for single-bill and ambiguity states, but retain the list payload's
  // author, action, vote, and issue facts for the issue-answer cards.
  const mapCardBill = (bill: ApiBillListItemPayload) => ({
    ...mapBillSummary(bill),
    sessionLabel: bill.session?.name ?? answer?.session.name ?? 'Current session',
    // The answer-wide session names the Legislature the query covered; it is
    // not each card's own session. Only special-session bills carry a per-card
    // value, so regular-session cards do not repeat the scope label.
    session: bill.session ? mapSession(bill.session) : undefined,
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
      sectionId: typeof citation.section_id === 'string' ? citation.section_id.trim() : '',
      sectionOrder: typeof citation.section_order === 'number' ? citation.section_order : null,
      sectionTopic: typeof citation.section_topic === 'string' ? citation.section_topic.trim() : '',
      sectionAvailable:
        typeof citation.section_available === 'boolean' ? citation.section_available : undefined,
    })),
    answeringBill: billTextAnswer ? mapBill(billTextAnswer.bill) : undefined,
    answeringBillCard: billTextAnswer
      ? {
          ...mapCardBill(billTextAnswer.bill),
          lastPulledAt: billTextAnswer.bill_last_pulled_at ?? undefined,
        }
      : undefined,
    question: billTextAnswer?.question ?? undefined,
    // The served shape settled on used/total plus `enumerating` (#868): the answer
    // path serves a FACT and this side words the sentence, so the copy stays
    // layout-owned (§9.5 decision 11). An earlier draft also carried a server-composed
    // `note` and #868's own snake_case counts; neither is served, so they are gone
    // rather than left as keys nothing sets.
    coverage: billTextAnswer?.coverage
      ? {
          used: billTextAnswer.coverage.used,
          total: billTextAnswer.coverage.total,
          enumerating: billTextAnswer.coverage.enumerating,
        }
      : undefined,
    topic:
      billsAnswer?.topic ?? (answer && 'topic' in answer ? (answer.topic ?? undefined) : undefined),
    session: answer?.session ? mapSession(answer.session) : undefined,
    ambiguousReference:
      answer && 'ambiguous_reference' in answer
        ? (answer.ambiguous_reference ?? undefined)
        : undefined,
    dataAsOf: answer?.data_as_of ?? undefined,
    totalMatches:
      billsAnswer?.total_matches ??
      (answer && 'total_matches' in answer ? answer.total_matches : 0),
    totalBills: answer && 'total_bills' in answer ? answer.total_bills : undefined,
    resolvedBill,
    bills: (billsAnswer?.bills ?? []).map(mapBill),
    billCards: (billsAnswer?.bills ?? []).map(mapCardBill),
    latestActionBillCards: (billsAnswer?.latest_action_bills ?? []).map(mapCardBill),
    legislators: legislators.map((leg) => ({
      id: leg.id,
      slug: leg.slug ?? undefined,
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
  for (const issue of filters.policyAreas ?? []) {
    const trimmed = issue.trim();
    if (trimmed) params.append('policy_area', trimmed);
  }
  if (filters.scope) {
    params.set('scope', filters.scope);
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

/** The small editorial set on phone Home, which may span legislative sessions. */
export async function getFeaturedBillsFromApi(
  billIds: readonly string[],
): Promise<(Bill & { sponsorNames: string[] })[]> {
  const requestedIds = [...new Set(billIds.map((billId) => billId.trim()).filter(Boolean))];
  if (requestedIds.length === 0) return [];

  const params = new URLSearchParams();
  for (const billId of requestedIds) {
    params.append('bill_id', billId);
  }
  const response = await publicApiRequest<CollectionResponse<ApiBillListItemPayload>>(
    `/bills/featured?${params.toString()}`,
  );
  const summariesById = new Map(response.data.map((item) => [item.id, mapBillSummary(item)]));
  return requestedIds.flatMap((billId) => {
    const summary = summariesById.get(billId);
    return summary ? [summary] : [];
  });
}

export async function listPolicyAreasFromApi(
  session?: string,
  scope?: 'legislature',
): Promise<PolicyArea[]> {
  const params = new URLSearchParams();
  params.set('limit', '50');
  if (session?.trim()) {
    params.set('session', session.trim());
  }
  if (scope) {
    params.set('scope', scope);
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
  return response.data.map(mapSession);
}

export async function getBillFromApi(
  billId: string,
): Promise<(Bill & { sponsorNames: string[] }) | null> {
  const apiBillId = normalizeBillIdForApi(billId);
  const detailResponse = await publicApiRequest<DetailResponse<ApiBillDetailPayload>>(
    `/bills/${encodeURIComponent(apiBillId)}?include=all_sponsors,actions,versions,topics,ai_analysis,progress`,
  );

  return mapBillDetail(detailResponse.data, []);
}

export async function getBillVotesFromApi(billId: string): Promise<VoteEvent[]> {
  const apiBillId = normalizeBillIdForApi(billId);
  const votesResponse = await publicApiRequest<PageResponse<ApiBillVotePayload>>(
    `/bills/${encodeURIComponent(apiBillId)}/votes`,
  );

  return mapBillVotes(votesResponse.data);
}

export interface BillVersionSectionText {
  sectionId: string;
  /** 1-based position in the version — the half of a section anchor that is
   *  actually unique (#854). Null only on a response served before the API
   *  carried it. */
  sourceOrder: number | null;
  heading: string | null;
  articleHeading: string | null;
  text: string;
  bodyBlocks: SourceBlock[] | null;
}

export async function fetchBillVersionText(
  billId: string,
  versionCode: string,
): Promise<BillVersionSectionText[]> {
  const apiBillId = normalizeBillIdForApi(billId);
  const response = await publicApiRequest<DetailResponse<ApiBillVersionTextPayload>>(
    `/bills/${encodeURIComponent(apiBillId)}/versions/${encodeURIComponent(versionCode)}/text?format=structured`,
  );
  return (response.data.sections ?? []).map((section) => ({
    sectionId: section.section_id,
    sourceOrder: typeof section.source_order === 'number' ? section.source_order : null,
    heading: section.heading ?? null,
    articleHeading: section.article_heading ?? null,
    text: section.text,
    bodyBlocks: section.body_blocks ?? null,
  }));
}

// The directory needs the whole selected-session roster to filter, count, and
// page in the browser. Minnesota's 201 seats fit in this one public response;
// reject a partial response rather than silently dropping a person if that
// ceiling ever becomes too small.

export async function listLegislatorsFromApi(
  query?: string,
  session?: string,
  filters: LegislatorListFilters = {},
): Promise<Legislator[]> {
  const params = new URLSearchParams();
  params.set('limit', String(LEGISLATOR_ROSTER_LIMIT));
  params.set('offset', '0');
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
  if (response.page?.has_more || response.page?.total !== response.data.length) {
    throw new Error('Legislator roster response is incomplete.');
  }

  return response.data.map(mapLegislator);
}

const REPRESENTATIVE_LOOKUP_REUSE_MS = 60_000;
const representativeLookupCache = new Map<
  string,
  { expiresAt: number; result: RepresentativeLookupResult }
>();
const representativeLookupInFlight = new Map<string, Promise<RepresentativeLookupResult>>();

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

  const key = JSON.stringify(body);
  const cached = representativeLookupCache.get(key);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.result;
  }
  if (cached) {
    representativeLookupCache.delete(key);
  }

  const existing = representativeLookupInFlight.get(key);
  if (existing) {
    return existing;
  }

  const request = publicApiPost<DetailResponse<ApiRepresentativeLookupPayload>>(
    '/representative-lookups',
    body,
  ).then((response) => {
    const result = mapRepresentativeLookup(response.data);
    representativeLookupCache.set(key, {
      expiresAt: Date.now() + REPRESENTATIVE_LOOKUP_REUSE_MS,
      result,
    });
    return result;
  });
  representativeLookupInFlight.set(key, request);

  try {
    return await request;
  } finally {
    if (representativeLookupInFlight.get(key) === request) {
      representativeLookupInFlight.delete(key);
    }
  }
}

export async function suggestRepresentativeAddressesFromApi(
  input: string,
): Promise<RepresentativeAddressChoice[]> {
  const addressText = input.trim();
  if (!addressText) return [];

  const response = await publicApiPost<DetailResponse<ApiAddressSuggestionsPayload>>(
    '/address-suggestions',
    { address_text: addressText },
  );
  return response.data.suggestions.map((suggestion) => ({
    matchedAddress: suggestion.matched_address,
    latitude: suggestion.latitude,
    longitude: suggestion.longitude,
  }));
}

export async function getLegislatorFromApi(legislatorId: string): Promise<Legislator | null> {
  const response = await publicApiRequest<DetailResponse<ApiLegislatorDetailPayload>>(
    `/legislators/${encodeURIComponent(legislatorId)}?include=current_service,committees,stats,service_history`,
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

/**
 * One legislator's own campaign money for one year, per confirmed committee.
 *
 * Money others spent about them is a separate record with its own endpoint, and the
 * two are never added: a committee's own receipts and a third party's spending are
 * different things (`docs/architecture/campaign-finance-system-design.md` §3).
 *
 * Amounts are passed through as the strings the API sends. Turning them into
 * JavaScript numbers here would round cents on a figure in the millions, and every
 * number on this page has to survive being checked against Minnesota's own filing.
 */
export async function getLegislatorCampaignMoneyFromApi(
  legislatorId: string,
  year: number,
): Promise<LegislatorCampaignMoney> {
  const params = new URLSearchParams({ year: String(year) });
  const response = await publicApiRequest<DetailResponse<ApiLegislatorCampaignMoneyPayload>>(
    `/legislators/${encodeURIComponent(legislatorId)}/campaign-finance?${params.toString()}`,
  );
  const payload = response.data;
  return {
    legislatorId: payload.legislator_id,
    year: payload.year,
    linkState: payload.link_state,
    fetchedAt: payload.fetched_at ?? null,
    otherOfficeCommittees: payload.other_office_committees ?? 0,
    committeesOutsideThisYear: (payload.committees_outside_this_year ?? []).map((entry) => ({
      registrationNumber: entry.registration_number,
      committeeNameAsReviewed: entry.committee_name_as_reviewed,
      closedOn: entry.closed_on ?? null,
    })),
    committees: payload.committees.map((committee) => ({
      registrationNumber: committee.registration_number,
      committeeNameAsReviewed: committee.committee_name_as_reviewed,
      committeeName: committee.committee_name ?? null,
      office: committee.office ?? null,
      checked: committee.checked
        ? {
            checkedOn: committee.checked.checked_on,
            nameEvidence: committee.checked.name_evidence ?? null,
            registerVerdict: committee.checked.register_verdict ?? null,
            partyAgreement: committee.checked.party_agreement ?? null,
          }
        : null,
      moneyIn: committee.money_in
        ? {
            state: committee.money_in.state,
            itemizedContributionTotal: committee.money_in.itemized_contribution_total ?? null,
            itemizedContributionPayments: committee.money_in.itemized_contribution_payments ?? null,
            otherReceipts: (committee.money_in.other_receipts ?? []).map((receipt) => ({
              receiptType: receipt.receipt_type,
              total: receipt.total,
              payments: receipt.payments,
            })),
            reportedPeriodStart: committee.money_in.reported_period_start ?? null,
            sourceUrl: committee.money_in.source_url ?? null,
          }
        : null,
      moneyOut: committee.money_out
        ? {
            state: committee.money_out.state,
            itemizedPaymentTotal: committee.money_out.itemized_payment_total ?? null,
            itemizedPayments: committee.money_out.itemized_payments ?? null,
            inKindTotal: committee.money_out.in_kind_total ?? null,
            reportedTotal: committee.money_out.reported_total ?? null,
            reportedThrough: committee.money_out.reported_through ?? null,
            // `not_run` and never `not_checked`: an absent field means nobody
            // looked, which is a fact about us, while `not_checked` claims the
            // Board served us no document. Collapsing them would let our own
            // silence borrow Minnesota's excuse.
            statedSpendingState: committee.money_out.stated_spending_state ?? 'not_run',
            byType: (committee.money_out.by_type ?? []).map((entry) => ({
              type: entry.type,
              total: entry.total,
              payments: entry.payments,
            })),
            sourceUrl: committee.money_out.source_url ?? null,
          }
        : null,
      split: {
        state: committee.split.state,
        reportedTotal: committee.split.reported_total ?? null,
        reportedThrough: committee.split.reported_through ?? null,
        namedTotal: committee.split.named_total ?? null,
        namedPayments: committee.split.named_payments ?? null,
        namedCashTotal: committee.split.named_cash_total ?? null,
        namedInKindTotal: committee.split.named_in_kind_total ?? null,
        unnamedTotal: committee.split.unnamed_total ?? null,
        statedSplitState: committee.split.stated_split_state ?? 'not_checked',
        firstPaymentOn: committee.split.first_payment_on ?? null,
        lastPaymentOn: committee.split.last_payment_on ?? null,
      },
      filingSchedule: {
        state: filingScheduleState(committee.filing_schedule?.state),
        nextReportName: committee.filing_schedule?.next_report_name ?? null,
        nextReportDueOn: committee.filing_schedule?.next_report_due_on ?? null,
        periodStart: committee.filing_schedule?.period_start ?? null,
        periodEnd: committee.filing_schedule?.period_end ?? null,
        condition: committee.filing_schedule?.condition ?? null,
        terminatedOn: committee.filing_schedule?.terminated_on ?? null,
      },
    })),
  };
}

/**
 * The server's schedule state, or the one that says we cannot answer.
 *
 * An unrecognised or missing value falls to `filings_cannot_answer` rather than to a
 * committee-side state. Both directions of that choice are a claim, and only this one
 * is safe: it says our copy cannot settle it, which is true whenever we are reading a
 * value we do not understand.
 */
function filingScheduleState(raw: string | null | undefined): FilingScheduleState {
  const known: FilingScheduleState[] = [
    'on_the_ballot',
    'not_on_the_ballot',
    'registration_closed',
    'special_election_filer',
    'calendar_not_transcribed',
    'filings_cannot_answer',
  ];
  return known.find((state) => state === raw) ?? 'filings_cannot_answer';
}

interface ApiCampaignFinanceSummaryPayload {
  register?: {
    state?: string;
    filer_count?: number | null;
  } | null;
  legislator_committee_confirmations?: {
    state?: string;
    confirmed_member_count?: number | null;
    sitting_member_count?: number | null;
    newest_confirmation_at?: string | null;
  } | null;
  freshness?: {
    downloads_fetched_at?: string | null;
  } | null;
}

interface ApiMoneyFilingPayload {
  filer_name: string;
  report_name: string;
  period_start?: string | null;
  period_end?: string | null;
  filed_date?: string | null;
}

interface ApiCampaignFinanceFilingsPayload {
  state?: string;
  ordered_by?: string;
  filings?: ApiMoneyFilingPayload[] | null;
  newest_period?: { period_end?: string | null; filing_count?: number | null } | null;
}

function blockState(state: string | undefined): 'reported' | 'unavailable' {
  return state === 'reported' ? 'reported' : 'unavailable';
}

/**
 * The /money landing's counts and dates. Three independent blocks, each with its
 * own state, so one gap cannot blank the other lanes. A null count is our gap
 * and never renders as 0; a served 0 (today's confirmed_member_count) is a
 * verified zero and renders as the number it is (grounded-answers.md rule 12).
 */
export async function getCampaignFinanceSummaryFromApi(): Promise<MoneyLandingSummary> {
  const response = await publicApiRequest<DetailResponse<ApiCampaignFinanceSummaryPayload>>(
    '/campaign-finance/summary',
  );
  const payload = response.data;
  const register = payload.register ?? undefined;
  const confirmations = payload.legislator_committee_confirmations ?? undefined;
  return {
    register: {
      state: blockState(register?.state),
      filerCount: register?.state === 'reported' ? (register?.filer_count ?? null) : null,
    },
    confirmations: {
      state: blockState(confirmations?.state),
      confirmedMemberCount:
        confirmations?.state === 'reported'
          ? (confirmations?.confirmed_member_count ?? null)
          : null,
      sittingMemberCount:
        confirmations?.state === 'reported' ? (confirmations?.sitting_member_count ?? null) : null,
      newestConfirmationAt: confirmations?.newest_confirmation_at ?? null,
    },
    freshness: {
      downloadsFetchedAt: payload.freshness?.downloads_fetched_at ?? null,
    },
  };
}

/**
 * The newest filed reports for the landing (no amounts of any kind). A row
 * carries the day the Board received it where its own document states one, and
 * `null` where it does not — the ordinary answer, and never a fallback to the
 * period end, which would be a fabricated fact (issue #1670). Rows sort by the
 * filed date where there is one and by the period end where there is not; the
 * printed ordering sentence derives from `ordered_by` through
 * lib/moneyLanding.ts so the words and the order cannot drift apart.
 */
export async function getCampaignFinanceFilingsFromApi(limit = 5): Promise<MoneyFilingsFeed> {
  const params = new URLSearchParams({ limit: String(limit) });
  const response = await publicApiRequest<DetailResponse<ApiCampaignFinanceFilingsPayload>>(
    `/campaign-finance/filings?${params.toString()}`,
  );
  const payload = response.data;
  return {
    state: blockState(payload.state),
    orderedBy: payload.ordered_by ?? '',
    filings:
      payload.state === 'reported'
        ? (payload.filings ?? []).map((filing) => ({
            filerName: filing.filer_name,
            reportName: filing.report_name,
            periodStart: filing.period_start ?? null,
            periodEnd: filing.period_end ?? null,
            filedDate: filing.filed_date ?? null,
          }))
        : [],
    // Only a real number becomes a count. A missing or null figure leaves the
    // block null so the sentence falls back to its no-count wording, rather
    // than rendering 0 reports for a period that plainly has some.
    newestPeriod:
      payload.state === 'reported' && typeof payload.newest_period?.filing_count === 'number'
        ? {
            periodEnd: payload.newest_period.period_end ?? null,
            filingCount: payload.newest_period.filing_count,
          }
        : null,
  };
}

interface ApiCommitteeRegisterRowPayload {
  registration_number?: string | null;
  name?: string | null;
  kind?: string | null;
  sub_type?: string | null;
  office?: string | null;
  district?: string | null;
  is_closed?: boolean | null;
  termination_date?: string | null;
}

interface ApiCommitteeRegisterPayload {
  state?: string;
  ordered_by?: string;
  committees?: ApiCommitteeRegisterRowPayload[] | null;
  page?: { has_more?: boolean; total?: number | null } | null;
  register_total?: number | null;
  by_kind?: Record<string, number> | null;
  as_of?: string | null;
}

function registerRow(row: ApiCommitteeRegisterRowPayload): CommitteeRegisterRow {
  return {
    registrationNumber: row.registration_number ?? '',
    name: row.name ?? '',
    kind: row.kind ?? null,
    subType: row.sub_type ?? null,
    office: row.office ?? null,
    district: row.district ?? null,
    isClosed: row.is_closed === true,
    terminationDate: row.termination_date ?? null,
  };
}

/**
 * One page of the register of filers, A to Z by the filed name, for the
 * committees list at /money/committees.
 *
 * `kind` offers exactly the register's own 3 values and no finer filter: the
 * finer sub-type is null for 33 registered filers, so a finer chip would present
 * "we cannot tell" as "not one of these" (#1661). `q` is plain containment of
 * what was typed with no closest-spelling suggestion of any kind.
 *
 * Two totals on purpose. `total` counts the filter the rows came from; the
 * register's own total and its per-kind counts stay unfiltered, so a count on the
 * page can speak for the register while the "showing" line speaks for the list.
 */
export async function getCampaignFinanceCommitteesFromApi(options: {
  kind?: string;
  q?: string;
  limit?: number;
  offset?: number;
}): Promise<CommitteeRegisterPage> {
  const params = new URLSearchParams();
  if (options.kind) params.set('kind', options.kind);
  if (options.q) params.set('q', options.q);
  if (options.limit !== undefined) params.set('limit', String(options.limit));
  if (options.offset !== undefined) params.set('offset', String(options.offset));
  const query = params.toString();
  const response = await publicApiRequest<DetailResponse<ApiCommitteeRegisterPayload>>(
    `/campaign-finance/committees${query ? `?${query}` : ''}`,
  );
  const payload = response.data;
  const state = blockState(payload.state);
  return {
    state,
    orderedBy: payload.ordered_by ?? '',
    committees: state === 'reported' ? (payload.committees ?? []).map(registerRow) : [],
    hasMore: payload.page?.has_more ?? false,
    total: payload.page?.total ?? null,
    registerTotal: payload.register_total ?? null,
    byKind: payload.by_kind ?? {},
    asOf: payload.as_of ?? null,
  };
}

interface ApiNameSearchRowPayload {
  kind?: string;
  id?: string | null;
  slug?: string | null;
  full_name?: string | null;
  chamber?: string | null;
  district_code?: string | null;
  party?: string | null;
  registration_number?: string | null;
  name?: string | null;
  filer_kind?: string | null;
  sub_type?: string | null;
  office?: string | null;
  district?: string | null;
  is_closed?: boolean | null;
  termination_date?: string | null;
  role?: string | null;
  payment_count?: number | null;
}

interface ApiNameSearchPayload {
  state?: string;
  q?: string;
  min_query_length?: number | null;
  counted_up_to?: number | null;
  groups?:
    | {
        kind?: string;
        state?: string;
        results?: ApiNameSearchRowPayload[] | null;
        total?: number | null;
        at_least?: number | null;
        has_more?: boolean | null;
        reason?: string | null;
      }[]
    | null;
  reason?: string | null;
}

/**
 * A group's own state, keeping all 3 the server serves.
 *
 * `not_reported` must survive the trip: it means we searched this part of the
 * records and nothing carried that spelling, where `unavailable` means we could
 * not read it. Mapping the first onto the second prints "a gap on our side" over
 * a verified nothing, which is the missing-versus-zero failure
 * `.claude/rules/grounded-answers.md` rule 12 forbids — and it did exactly that
 * on the first build of this page, on every zero-match group.
 */
function nameSearchGroupState(state: string | undefined): NameSearchGroup['state'] {
  if (state === 'reported') return 'reported';
  if (state === 'not_reported') return 'not_reported';
  return 'unavailable';
}

/** One served result row, read by its own `kind` rather than by the group it
 *  arrived in — which is what would break the day a group holds 2 shapes. */
function nameSearchRow(row: ApiNameSearchRowPayload): NameSearchRow | null {
  if (row.kind === 'person') {
    return {
      kind: 'person',
      legislatorId: row.id ?? '',
      slug: row.slug ?? '',
      fullName: row.full_name ?? '',
      chamber: row.chamber ?? null,
      districtCode: row.district_code ?? null,
      party: row.party ?? null,
    };
  }
  if (row.kind === 'committee') {
    return {
      kind: 'committee',
      registrationNumber: row.registration_number ?? '',
      name: row.name ?? '',
      filerKind: row.filer_kind ?? null,
      subType: row.sub_type ?? null,
      office: row.office ?? null,
      district: row.district ?? null,
      isClosed: row.is_closed === true,
      terminationDate: row.termination_date ?? null,
    };
  }
  if (row.kind === 'payment_name') {
    return {
      kind: 'payment_name',
      name: row.name ?? '',
      role: row.role ?? '',
      paymentCount: typeof row.payment_count === 'number' ? row.payment_count : null,
    };
  }
  // A shape we do not know how to draw is dropped rather than guessed at, so a
  // new group added on the server cannot render as a blank row.
  return null;
}

/**
 * One typed name, matched across the 5 kinds of record and grouped by what each
 * one is, for /money/search.
 *
 * Every group the server returns is kept, in the order it returns them, including
 * the empty ones: a group dropped for being empty would let a reader read "we did
 * not look" as "nothing is filed". A group's own state is kept too, because the
 * register and the bulk downloads are 2 separate copies of Minnesota's data and
 * one missing copy must not blank the groups that do not depend on it.
 */
export async function getCampaignFinanceNameSearchFromApi(
  query: string,
  limit = 5,
): Promise<NameSearchAnswer> {
  const params = new URLSearchParams({ q: query, limit: String(limit) });
  const response = await publicApiRequest<DetailResponse<ApiNameSearchPayload>>(
    `/campaign-finance/search?${params.toString()}`,
  );
  const payload = response.data;
  const groups: NameSearchGroup[] = (payload.groups ?? []).map((group) => ({
    kind: group.kind ?? '',
    state: nameSearchGroupState(group.state),
    results:
      group.state === 'reported'
        ? (group.results ?? [])
            .map(nameSearchRow)
            .filter((row): row is NameSearchRow => row !== null)
        : [],
    total: typeof group.total === 'number' ? group.total : null,
    atLeast: typeof group.at_least === 'number' ? group.at_least : null,
    hasMore: group.has_more === true,
    reason: group.reason ?? null,
  }));
  return {
    state: blockState(payload.state),
    query: payload.q ?? query,
    minQueryLength: typeof payload.min_query_length === 'number' ? payload.min_query_length : null,
    countedUpTo: typeof payload.counted_up_to === 'number' ? payload.counted_up_to : null,
    groups,
    reason: payload.reason ?? null,
  };
}

export async function getLegislatorVotesFromApi(
  legislatorId: string,
  limit = 1,
): Promise<LegislatorVote[]> {
  const params = new URLSearchParams({ limit: String(limit) });
  const response = await publicApiRequest<PageResponse<ApiLegislatorVotePayload>>(
    `/legislators/${encodeURIComponent(legislatorId)}/votes?${params.toString()}`,
  );
  const supportedVotes = new Set(['yes', 'no', 'absent', 'excused', 'present', 'abstain']);

  return response.data.flatMap((vote) => {
    const normalizedChamber = vote.chamber?.toLowerCase();
    if (normalizedChamber !== 'house' && normalizedChamber !== 'senate') return [];
    const chamber = toOptionalChamber(vote.chamber);
    const value = vote.vote_value.toLowerCase();
    const billId = vote.bill_id?.trim();
    const billCode = vote.bill_code?.trim();
    const date = formatOptionalDate(vote.occurred_at);
    if (!chamber || !supportedVotes.has(value) || !billId || !billCode || !date) return [];
    return [
      {
        id: vote.id,
        vote: value as LegislatorVote['vote'],
        billId,
        billCode,
        date,
        chamber,
      },
    ];
  });
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

/** Tell the API this reader has opened their tracked list, and get back when they
 *  opened it BEFORE — the comparison point the page's "what moved" blocks measure
 *  against (#1009). `null` means no recorded visit yet, i.e. their first look.
 *
 *  Read and advance are one call because they must not interleave: two tabs, or a
 *  retry, could otherwise hand the second caller a mark it had just written, and
 *  the page would say nothing had moved. */
/** When this reader last opened their tracked list, WITHOUT advancing the mark.
 *
 *  For a surface that shows only some of what moved (#1034). Advancing on a glance
 *  that displayed two of six moved bills would consume the other four unseen, so
 *  only the tracked list itself advances; everything else uses this.
 *
 *  `null` means no recorded visit yet — NOT "nothing has moved". */
export async function readTrackedBillsLastViewedFromApi(
  accessToken: string,
): Promise<string | null> {
  const response = await apiRequest<DetailResponse<{ last_viewed_at: string | null }>>(
    '/me/tracked-bills/last-viewed',
    { method: 'GET' },
    accessToken,
  );
  return response.data?.last_viewed_at ?? null;
}

export async function markTrackedBillsViewedFromApi(accessToken: string): Promise<string | null> {
  const response = await apiRequest<DetailResponse<{ previous_viewed_at: string | null }>>(
    '/me/tracked-bills/viewed',
    { method: 'POST' },
    accessToken,
  );
  return response.data?.previous_viewed_at ?? null;
}

export async function setTrackedBillFromApi(
  accessToken: string,
  billId: string,
  tracked: boolean,
): Promise<void> {
  if (!tracked) {
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

/** Every committee this reader follows, newest first (#1943). Whole and
 *  unpaginated, like the bill list, so one query answers every Track control. */
export async function listTrackedCommitteesFromApi(
  accessToken: string,
): Promise<TrackedCommittee[]> {
  const response = await apiRequest<CollectionResponse<ApiTrackedCommitteePayload>>(
    '/me/tracked-committees',
    { method: 'GET' },
    accessToken,
  );
  return response.data.map((row) => ({
    registrationNumber: row.registration_number,
    trackedAt: row.tracked_at,
    committeeName: row.committee_name ?? null,
    entityType: row.entity_type ?? null,
    entitySubType: row.entity_sub_type ?? null,
    register: {
      state: row.register.state,
      kind: row.register.kind ?? null,
      name: row.register.name ?? null,
      office: row.register.office ?? null,
      district: row.register.district ?? null,
      terminationDate: row.register.termination_date ?? null,
    },
  }));
}

/** Follow or unfollow one committee. PUT carries no body: a bookmark has no
 *  settings. A 404 on PUT means no committee page exists for that number. */
export async function setTrackedCommitteeFromApi(
  accessToken: string,
  registrationNumber: string,
  tracked: boolean,
): Promise<void> {
  await apiRequest<unknown>(
    `/me/tracked-committees/${encodeURIComponent(registrationNumber)}`,
    { method: tracked ? 'PUT' : 'DELETE' },
    accessToken,
  );
}

// --- Outside spending about one legislator (#1332) ---------------------------

interface ApiOutsideSpendingPayload {
  year: number;
  state: string;
  snapshot_id?: string | null;
  supporting?: string | null;
  opposing?: string | null;
  direction_not_recorded?: string | null;
  supporting_payments?: number | null;
  opposing_payments?: number | null;
  direction_not_recorded_payments?: number | null;
  source_url?: string | null;
  fetched_at?: string | null;
  committees?: Array<{
    registration_number?: string | null;
    committee_name?: string | null;
    office?: string | null;
    first_payment_on?: string | null;
    last_payment_on?: string | null;
  }> | null;
}

/**
 * Whether a `reported` year arrived with every count a figure needs.
 *
 * Each figure prints its own payment count, so a response missing any of them cannot be
 * drawn. Checked rather than defaulted, because defaulting to 0 turns a missing count
 * into a checked zero -- the exact missing-versus-zero failure rule 12 forbids.
 */
function hasEveryPaymentCount(data: ApiOutsideSpendingPayload): boolean {
  return (
    typeof data.supporting_payments === 'number' &&
    typeof data.opposing_payments === 'number' &&
    typeof data.direction_not_recorded_payments === 'number'
  );
}

// Money is served as a string because the column carries 4 decimal places and a
// JSON number would round them. Parsed here rather than in the display layer so
// only one place ever turns the filing's text into arithmetic.
function spendingAmount(value: string | null | undefined): number | null {
  if (value == null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * One legislator's outside spending for one calendar year.
 *
 * `state` is the field the display reads first: only `reported` carries figures,
 * and there a 0 is a measured 0. Every other state is a gap in our own records and
 * must never be drawn as a zero (`.claude/rules/grounded-answers.md` rule 12).
 */
export async function getLegislatorOutsideSpendingFromApi(
  legislatorId: string,
  year: number,
): Promise<OutsideSpendingYear> {
  const params = new URLSearchParams({ year: String(year) });
  const response = await publicApiRequest<DetailResponse<ApiOutsideSpendingPayload>>(
    `/legislators/${encodeURIComponent(legislatorId)}/independent-spending?${params.toString()}`,
  );
  const data = response.data;
  let state: OutsideSpendingState =
    data.state === 'reported' || data.state === 'link_unconfirmed' ? data.state : 'unavailable';
  // A `reported` year must arrive with all 3 payment counts, or no figure may be drawn
  // from it. The frontend and the API deploy separately, so this page can briefly meet a
  // server that predates the split counts; defaulting those to 0 made every figure look
  // like a checked zero and printed "nobody spent anything" over real money. Treated as a
  // failed load instead, which is what it is.
  if (state === 'reported' && !hasEveryPaymentCount(data)) {
    state = 'load_failed';
  }
  if (state === 'load_failed') return outsideSpendingLoadFailure(data.year ?? year);
  const committees = data.committees ?? [];
  // A member can hold several committees at once, so the block's period is the span
  // across all of them rather than any one committee's.
  const firstDates = committees
    .map((committee) => committee.first_payment_on)
    .filter((value): value is string => Boolean(value))
    .sort();
  const lastDates = committees
    .map((committee) => committee.last_payment_on)
    .filter((value): value is string => Boolean(value))
    .sort();
  return {
    year: data.year,
    state,
    snapshotId: data.snapshot_id ?? null,
    committees: committees.map((committee) => ({
      registrationNumber: committee.registration_number ?? '',
      name: committee.committee_name ?? '',
      office: committee.office ?? null,
    })),
    supporting: spendingAmount(data.supporting),
    opposing: spendingAmount(data.opposing),
    directionNotRecorded: spendingAmount(data.direction_not_recorded),
    supportingPayments: data.supporting_payments ?? null,
    opposingPayments: data.opposing_payments ?? null,
    directionNotRecordedPayments: data.direction_not_recorded_payments ?? null,
    firstPaymentOn: firstDates[0] ?? null,
    lastPaymentOn: lastDates[lastDates.length - 1] ?? null,
    sourceUrl: data.source_url ?? null,
    fetchedAt: data.fetched_at ?? null,
  };
}

interface ApiCommitteeRegisterPayload {
  state?: string;
  kind?: string | null;
  name?: string | null;
  party?: string | null;
  office?: string | null;
  district?: string | null;
  registration_date?: string | null;
  termination_date?: string | null;
  as_of?: string | null;
}

interface ApiCommitteeMoneyPayload {
  registration_number: string;
  committee_name?: string | null;
  entity_type?: string | null;
  entity_sub_type?: string | null;
  year: number;
  fetched_at?: string | null;
  register?: ApiCommitteeRegisterPayload | null;
  confirmed_for?: {
    legislator_id?: string | null;
    slug?: string | null;
    full_name?: string | null;
    checked?: {
      checked_on: string;
      name_evidence?: string | null;
      register_verdict?: string | null;
      party_agreement?: string | null;
    } | null;
  } | null;
  money_in?: {
    state: string;
    itemized_contribution_total?: string | null;
    itemized_contribution_payments?: number | null;
    other_receipts?: { receipt_type: string; total: string; payments: number }[] | null;
    reported_period_start?: string | null;
    source_url?: string | null;
  } | null;
  money_out?: {
    state: string;
    itemized_payment_total?: string | null;
    itemized_payments?: number | null;
    in_kind_total?: string | null;
    by_type?: { type: string; total: string; payments: number }[] | null;
    reported_total?: string | null;
    reported_through?: string | null;
    stated_spending_state?: string | null;
    source_url?: string | null;
  } | null;
  split?: {
    state: string;
    reported_total?: string | null;
    reported_through?: string | null;
    named_total?: string | null;
    named_payments?: number | null;
    named_cash_total?: string | null;
    named_in_kind_total?: string | null;
    unnamed_total?: string | null;
    stated_split_state?: string | null;
    first_payment_on?: string | null;
    last_payment_on?: string | null;
  } | null;
}

function committeeRegisterState(state: string | undefined): CommitteeMoney['register']['state'] {
  if (state === 'reported') return 'reported';
  if (state === 'not_registered') return 'not_registered';
  return 'unavailable';
}

function committeeBlockState(
  state: string | undefined,
): 'reported' | 'not_reported' | 'unavailable' {
  if (state === 'reported') return 'reported';
  if (state === 'not_reported') return 'not_reported';
  return 'unavailable';
}

/**
 * One committee's money for one year, keyed on its registration number. Resolves
 * `null` on 404 — the number is in neither our copy of the Board's register nor
 * the downloads, which the page renders as a fact about our records rather than
 * an error or a claim that no such committee exists.
 */
export async function getCommitteeFinanceFromApi(
  registrationNumber: string,
  year: number,
): Promise<CommitteeMoney | null> {
  let payload: ApiCommitteeMoneyPayload;
  try {
    const response = await publicApiRequest<DetailResponse<ApiCommitteeMoneyPayload>>(
      `/committees/${encodeURIComponent(registrationNumber)}/finance?year=${year}`,
    );
    payload = response.data;
  } catch (error) {
    if (isNotFoundError(error)) return null;
    throw error;
  }
  const register = payload.register ?? undefined;
  return {
    registrationNumber: payload.registration_number,
    // The downloads spell a missing name as an empty string; a page must not
    // render a heading out of it.
    committeeName: payload.committee_name ? payload.committee_name : null,
    entityType: payload.entity_type ?? null,
    entitySubType: payload.entity_sub_type ?? null,
    year: payload.year,
    fetchedAt: payload.fetched_at ?? null,
    register: {
      state: committeeRegisterState(register?.state),
      kind: register?.kind ?? null,
      name: register?.name ?? null,
      party: register?.party ?? null,
      office: register?.office ?? null,
      district: register?.district ?? null,
      registrationDate: register?.registration_date ?? null,
      terminationDate: register?.termination_date ?? null,
      asOf: register?.as_of ?? null,
    },
    // All 3 fields or nothing: a confirmed member with no address to send a reader
    // to is a half-fact, and the sentence that names them is also the link out.
    confirmedFor:
      payload.confirmed_for?.legislator_id &&
      payload.confirmed_for.slug &&
      payload.confirmed_for.full_name
        ? {
            legislatorId: payload.confirmed_for.legislator_id,
            slug: payload.confirmed_for.slug,
            fullName: payload.confirmed_for.full_name,
            // Separately optional from the 3 above: a decision written before the basis
            // columns landed is still a real confirmation, and the page says so without
            // describing evidence it does not hold.
            checked: payload.confirmed_for.checked
              ? {
                  checkedOn: payload.confirmed_for.checked.checked_on,
                  nameEvidence: payload.confirmed_for.checked.name_evidence ?? null,
                  registerVerdict: payload.confirmed_for.checked.register_verdict ?? null,
                  partyAgreement: payload.confirmed_for.checked.party_agreement ?? null,
                }
              : null,
          }
        : null,
    moneyIn: {
      state: committeeBlockState(payload.money_in?.state),
      itemizedContributionTotal: payload.money_in?.itemized_contribution_total ?? null,
      itemizedContributionPayments: payload.money_in?.itemized_contribution_payments ?? null,
      otherReceipts: (payload.money_in?.other_receipts ?? []).map((receipt) => ({
        receiptType: receipt.receipt_type,
        total: receipt.total,
        payments: receipt.payments,
      })),
      reportedPeriodStart: payload.money_in?.reported_period_start ?? null,
      sourceUrl: payload.money_in?.source_url ?? null,
    },
    moneyOut: {
      state: committeeBlockState(payload.money_out?.state),
      itemizedPaymentTotal: payload.money_out?.itemized_payment_total ?? null,
      itemizedPayments: payload.money_out?.itemized_payments ?? null,
      inKindTotal: payload.money_out?.in_kind_total ?? null,
      byType: (payload.money_out?.by_type ?? []).map((entry) => ({
        type: entry.type,
        total: entry.total,
        payments: entry.payments,
      })),
      reportedTotal: payload.money_out?.reported_total ?? null,
      reportedThrough: payload.money_out?.reported_through ?? null,
      statedSpendingState: payload.money_out?.stated_spending_state ?? 'not_run',
      sourceUrl: payload.money_out?.source_url ?? null,
    },
    split: {
      state: (payload.split?.state ?? 'no_reported_total') as CommitteeMoney['split']['state'],
      reportedTotal: payload.split?.reported_total ?? null,
      reportedThrough: payload.split?.reported_through ?? null,
      namedTotal: payload.split?.named_total ?? null,
      namedPayments: payload.split?.named_payments ?? null,
      namedCashTotal: payload.split?.named_cash_total ?? null,
      namedInKindTotal: payload.split?.named_in_kind_total ?? null,
      unnamedTotal: payload.split?.unnamed_total ?? null,
      statedSplitState: payload.split?.stated_split_state ?? 'not_checked',
      firstPaymentOn: payload.split?.first_payment_on ?? null,
      lastPaymentOn: payload.split?.last_payment_on ?? null,
    },
  };
}

interface ApiCommitteePaymentsPayload {
  state?: string;
  payments?: Record<string, unknown>[] | null;
  page?: {
    limit: number;
    offset: number;
    has_more: boolean;
    total_payments?: number | null;
  } | null;
  linkable_registration_numbers?: string[] | null;
  source_url?: string | null;
  fetched_at?: string | null;
}

function committeePaymentsPage<Payment>(
  payload: ApiCommitteePaymentsPayload,
  mapPayment: (row: Record<string, unknown>) => Payment,
): CommitteePaymentsPage<Payment> {
  const state = committeeBlockState(payload.state);
  return {
    state,
    payments: state === 'reported' ? (payload.payments ?? []).map(mapPayment) : [],
    hasMore: payload.page?.has_more ?? false,
    totalPayments: payload.page?.total_payments ?? null,
    linkableRegistrationNumbers: payload.linkable_registration_numbers ?? [],
    sourceUrl: payload.source_url ?? null,
    fetchedAt: payload.fetched_at ?? null,
  };
}

const asText = (value: unknown): string | null => (typeof value === 'string' ? value : null);

/** Who paid this committee — its own filing's rows, one per payment. */
export async function getCommitteePaymentsReceivedFromApi(
  registrationNumber: string,
  options: { year?: number; sort?: 'date' | 'amount'; limit?: number; offset?: number } = {},
): Promise<CommitteePaymentsPage<CommitteeReceivedPayment> | null> {
  const payload = await committeePaymentsRequest(registrationNumber, 'received', options);
  if (payload === null) return null;
  return committeePaymentsPage(payload, (row) => ({
    contributor: asText(row.contributor),
    contributorRegistrationNumber: asText(row.contributor_registration_number),
    contributorType: asText(row.contributor_type),
    employer: asText(row.employer),
    amount: asText(row.amount),
    receivedOn: asText(row.received_on),
    receiptType: asText(row.receipt_type),
    inKind: asText(row.in_kind),
  }));
}

/** Who this committee paid — every expenditure type included, each row labelled. */
export async function getCommitteePaymentsMadeFromApi(
  registrationNumber: string,
  options: { year?: number; sort?: 'date' | 'amount'; limit?: number; offset?: number } = {},
): Promise<CommitteePaymentsPage<CommitteeMadePayment> | null> {
  const payload = await committeePaymentsRequest(registrationNumber, 'made', options);
  if (payload === null) return null;
  return committeePaymentsPage(payload, (row) => ({
    vendorName: asText(row.vendor_name),
    vendorCity: asText(row.vendor_city),
    vendorState: asText(row.vendor_state),
    affectedCommitteeName: asText(row.affected_committee_name),
    affectedCommitteeRegistrationNumber: asText(row.affected_committee_registration_number),
    amount: asText(row.amount),
    paidOn: asText(row.paid_on),
    expenditureType: asText(row.expenditure_type),
    purpose: asText(row.purpose),
    inKind: asText(row.in_kind),
  }));
}

const independentRow = (row: Record<string, unknown>): CommitteeIndependentPayment => ({
  spender: asText(row.spender),
  spenderRegistrationNumber: asText(row.spender_registration_number),
  affectedCommitteeName: asText(row.affected_committee_name),
  affectedCommitteeRegistrationNumber: asText(row.affected_committee_registration_number),
  stance: asText(row.stance),
  vendorName: asText(row.vendor_name),
  amount: asText(row.amount),
  unpaidAmount: asText(row.unpaid_amount),
  paidOn: asText(row.paid_on),
  year: typeof row.year === 'number' ? row.year : null,
  expenditureType: asText(row.expenditure_type),
  purpose: asText(row.purpose),
});

/** What others spent to support or oppose this committee, one row per payment.
 *
 *  The server has served this since #1332's block was built and the app could not ask
 *  for it: this function's `direction` value was unreachable because the request helper
 *  below was typed to 2 of the 4 the route accepts (#1901). */
export async function getCommitteeIndependentSpendingAboutFromApi(
  registrationNumber: string,
  options: { year?: number; sort?: 'date' | 'amount'; limit?: number; offset?: number } = {},
): Promise<CommitteePaymentsPage<CommitteeIndependentPayment> | null> {
  const payload = await committeePaymentsRequest(registrationNumber, 'independent', options);
  if (payload === null) return null;
  return committeePaymentsPage(payload, independentRow);
}

/** What this committee spent to support or oppose others, one row per payment.
 *
 *  The mirror direction, and the one nothing could answer at all until #1901 added the
 *  route. A committee with no rows here reads as absent rather than as a measured zero,
 *  because a filer that spent nothing independently and one we hold no rows for are
 *  indistinguishable (`.claude/rules/grounded-answers.md` rule 12). */
export async function getCommitteeIndependentSpendingByFromApi(
  registrationNumber: string,
  options: { year?: number; sort?: 'date' | 'amount'; limit?: number; offset?: number } = {},
): Promise<CommitteePaymentsPage<CommitteeIndependentPayment> | null> {
  const payload = await committeePaymentsRequest(registrationNumber, 'independent_by', options);
  if (payload === null) return null;
  return committeePaymentsPage(payload, independentRow);
}

async function committeePaymentsRequest(
  registrationNumber: string,
  direction: 'received' | 'made' | 'independent' | 'independent_by',
  options: { year?: number; sort?: 'date' | 'amount'; limit?: number; offset?: number },
): Promise<ApiCommitteePaymentsPayload | null> {
  const params = new URLSearchParams({ direction });
  if (options.year !== undefined) params.set('year', String(options.year));
  if (options.sort) params.set('sort', options.sort);
  if (options.limit !== undefined) params.set('limit', String(options.limit));
  if (options.offset !== undefined) params.set('offset', String(options.offset));
  try {
    const response = await publicApiRequest<DetailResponse<ApiCommitteePaymentsPayload>>(
      `/committees/${encodeURIComponent(registrationNumber)}/payments?${params.toString()}`,
    );
    return response.data;
  } catch (error) {
    if (isNotFoundError(error)) return null;
    throw error;
  }
}

/**
 * Every payment filed under exactly one printed name, for /money/payments
 * (issue #1780). Shares the committee route's envelope, so the same page shaper
 * reads it.
 *
 * The 3 roles come from 3 different downloads with 3 different column sets, and
 * they are flattened here into the one row the page draws — which committee filed
 * it, what the filing calls it, its own amount and its own date. Flattening in
 * one place is what keeps the 3 answers from being added together anywhere later:
 * a caller asks for exactly one role and gets exactly that file's rows.
 *
 * `total_payments` is never served on a name-keyed lookup, so `totalPayments` is
 * always null here and the page may not print "of N" (grounded-answers rule 11).
 */
export async function getPaymentsUnderNameFromApi(
  name: string,
  role: PaymentNameRole,
  options: { limit?: number; offset?: number } = {},
): Promise<CommitteePaymentsPage<PaymentUnderName>> {
  const params = new URLSearchParams({ name, role });
  if (options.limit !== undefined) params.set('limit', String(options.limit));
  if (options.offset !== undefined) params.set('offset', String(options.offset));
  const response = await publicApiRequest<DetailResponse<ApiCommitteePaymentsPayload>>(
    `/campaign-finance/payments-under-name?${params.toString()}`,
  );
  return committeePaymentsPage(response.data, (row) => paymentUnderName(row, role));
}

/** One served row, whichever of the 3 downloads it came from. */
function paymentUnderName(row: Record<string, unknown>, role: PaymentNameRole): PaymentUnderName {
  if (role === 'contributor') {
    return {
      filerName: asText(row.recipient_name),
      filerRegistrationNumber: asText(row.recipient_registration_number),
      filerEntityType: asText(row.recipient_type),
      receiptType: asText(row.receipt_type),
      purpose: null,
      expenditureType: null,
      affectedCommitteeName: null,
      stance: null,
      amount: asText(row.amount),
      paidOn: asText(row.received_on),
      inKind: asText(row.in_kind),
    };
  }
  if (role === 'vendor') {
    return {
      filerName: asText(row.committee_name),
      filerRegistrationNumber: asText(row.committee_registration_number),
      filerEntityType: null,
      receiptType: null,
      purpose: asText(row.purpose),
      expenditureType: asText(row.expenditure_type),
      affectedCommitteeName: null,
      stance: null,
      amount: asText(row.amount),
      paidOn: asText(row.paid_on),
      inKind: asText(row.in_kind),
    };
  }
  return {
    filerName: asText(row.spender),
    filerRegistrationNumber: asText(row.spender_registration_number),
    filerEntityType: null,
    receiptType: null,
    purpose: asText(row.purpose),
    expenditureType: asText(row.expenditure_type),
    affectedCommitteeName: asText(row.affected_committee_name),
    stance: asText(row.stance),
    amount: asText(row.amount),
    paidOn: asText(row.paid_on),
    // The independent-expenditures download carries no in-kind column at all.
    inKind: null,
  };
}

interface ApiCommitteeFilingPayload {
  report_name?: string | null;
  report_type?: string | null;
  filing_year?: number | null;
  period_start?: string | null;
  period_end?: string | null;
  effective_amendment_index?: number | null;
  amendment_count?: number | null;
  filed_date?: string | null;
}

interface ApiCommitteeFilingsPayload {
  state?: string;
  ordered_by?: string;
  filings?: ApiCommitteeFilingPayload[] | null;
  page?: { has_more?: boolean; total?: number | null } | null;
  catalogued_without_record?: number | null;
}

/**
 * Every report a committee is recorded as having filed (the Filings tab). No
 * amounts and still no amendment date — the catalogue's amendment record is
 * version indexes only. A row carries the day the Board received it where its
 * own document states one and `null` where it does not (issue #1670), so the
 * list sorts by the filed date where there is one and by the period end where
 * there is not, and `ordered_by` says which.
 */
export async function getCommitteeFilingsFromApi(
  registrationNumber: string,
  options: { limit?: number; offset?: number } = {},
): Promise<CommitteeFilingsPage> {
  const params = new URLSearchParams();
  if (options.limit !== undefined) params.set('limit', String(options.limit));
  if (options.offset !== undefined) params.set('offset', String(options.offset));
  const query = params.toString();
  const response = await publicApiRequest<DetailResponse<ApiCommitteeFilingsPayload>>(
    `/committees/${encodeURIComponent(registrationNumber)}/filings${query ? `?${query}` : ''}`,
  );
  const payload = response.data;
  const state = blockState(payload.state);
  return {
    state,
    orderedBy: payload.ordered_by ?? '',
    filings:
      state === 'reported'
        ? (payload.filings ?? []).map((filing) => ({
            reportName: filing.report_name ?? '',
            reportType: filing.report_type ?? '',
            filingYear: filing.filing_year ?? 0,
            periodStart: filing.period_start ?? null,
            periodEnd: filing.period_end ?? null,
            filedDate: filing.filed_date ?? null,
            effectiveAmendmentIndex: filing.effective_amendment_index ?? null,
            amendmentCount: filing.amendment_count ?? null,
          }))
        : [],
    hasMore: payload.page?.has_more ?? false,
    total: payload.page?.total ?? null,
    cataloguedWithoutRecord: payload.catalogued_without_record ?? null,
  };
}

type ApiOutsideSpendingRecordPayload = {
  state?: string | null;
  sort?: string | null;
  rows?: Record<string, unknown>[];
  page?: { number?: number; size?: number; has_more?: boolean; total_rows?: number | null };
  figures?: { committee_count?: number | null; spender_count?: number | null } | null;
  source_url?: string | null;
  fetched_at?: string | null;
};

const outsideSpendingRow = (row: Record<string, unknown>): CommitteeOutsideSpendingRow => ({
  spender: (row.spender as string | null) ?? null,
  spenderRegistrationNumber: (row.spender_registration_number as string | null) ?? null,
  spenderInRegister: Boolean(row.spender_in_register),
  spenderLinkable: Boolean(row.spender_linkable),
  aboutCommitteeName: (row.about_committee_name as string | null) ?? null,
  aboutCommitteeRegistrationNumber:
    (row.about_committee_registration_number as string | null) ?? null,
  aboutCommitteeInRegister: Boolean(row.about_committee_in_register),
  aboutCommitteeLinkable: Boolean(row.about_committee_linkable),
  direction: (row.direction as string | null) ?? 'not recorded',
  directionAsFiled: (row.direction_as_filed as string | null) ?? null,
  purpose: (row.purpose as string | null) ?? null,
  vendorName: (row.vendor_name as string | null) ?? null,
  expenditureType: (row.expenditure_type as string | null) ?? null,
  inKind: Boolean(row.in_kind),
  paidOn: (row.paid_on as string | null) ?? null,
  year: (row.year as number | null) ?? null,
  amount: row.amount === null || row.amount === undefined ? null : String(row.amount),
  unpaidAmount:
    row.unpaid_amount === null || row.unpaid_amount === undefined
      ? null
      : String(row.unpaid_amount),
  recordNumber: Number(row.record_number ?? 0),
});

/**
 * One page of the outside-spending record for one subject: what other groups spent
 * about a committee (`about`), or what one filer spent about others (`spender`).
 * Pages of 50, newest first by default (`GET /campaign-finance/outside-spending`,
 * #1945). Null for a number in neither the register we hold nor the file, which is a
 * statement about our records.
 *
 * No `year`: outside spending is filed by election cycle rather than by the filing
 * year the committee page's control selects, so the tabs read the whole subject and
 * each row carries its own date.
 */
export async function getOutsideSpendingFromApi(options: {
  about?: string;
  spender?: string;
  sort?: 'newest' | 'largest';
  page?: number;
}): Promise<CommitteeOutsideSpendingPage | null> {
  const params = new URLSearchParams();
  if (options.about) params.set('about', options.about);
  if (options.spender) params.set('spender', options.spender);
  if (options.sort) params.set('sort', options.sort);
  if (options.page !== undefined) params.set('page', String(options.page));
  let payload: ApiOutsideSpendingRecordPayload;
  try {
    const response = await publicApiRequest<DetailResponse<ApiOutsideSpendingRecordPayload>>(
      `/campaign-finance/outside-spending?${params.toString()}`,
    );
    payload = response.data;
  } catch (error) {
    if (isNotFoundError(error)) return null;
    throw error;
  }
  const state =
    payload.state === 'reported' || payload.state === 'not_reported'
      ? payload.state
      : 'unavailable';
  return {
    state,
    sort: payload.sort === 'largest' ? 'largest' : 'newest',
    rows: state === 'reported' ? (payload.rows ?? []).map(outsideSpendingRow) : [],
    pageNumber: payload.page?.number ?? 1,
    pageSize: payload.page?.size ?? 50,
    hasMore: payload.page?.has_more ?? false,
    totalRows: payload.page?.total_rows ?? null,
    committeeCount: payload.figures?.committee_count ?? null,
    spenderCount: payload.figures?.spender_count ?? null,
    sourceUrl: payload.source_url ?? null,
    fetchedAt: payload.fetched_at ?? null,
  };
}
