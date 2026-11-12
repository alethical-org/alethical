/** Wire contracts for the published election reads under Finance's access boundary.
 * JSON reads use apiGet/useRead. All paths are relative to /api/v1, not page URLs.
 * Raw/PDF paths name attachments requiring the account token; they are not JSON
 * reads or public anchors. This module adds no fetch or authentication transport.
 * Dollar values stay exact source decimal strings until ui/money.formatMoney.
 * Missing records, withheld totals and reported zero remain separate states. */
import { apiPath } from "../../api/read";

export type DecimalUSD = string;
export type ElectionStage = "general" | "primary" | "special";
export type JsonValue =
  string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };
export type Coverage = Record<string, JsonValue>;
export interface Page {
  total: number;
  limit: number;
  offset: number;
  has_more: boolean;
}
export interface LinePage {
  total: number;
  start: number;
  limit: number;
  has_more: boolean;
}
export interface PageQuery {
  limit?: number;
  offset?: number;
}
export interface LineQuery {
  start?: number;
  limit?: number;
}

export interface RetainedSource {
  sha256: string;
  url?: string;
  source_url?: string;
  file?: string;
  bytes?: number;
  fetched_at?: string;
  last_modified?: string | null;
  content_type?: string | null;
  copied_at?: string;
  held_at?: string;
  request_method?: string;
  request_form?: Record<string, JsonValue>;
  archive_line?: number;
  kind?: string;
  collection_id?: string;
  outcome?: string;
  origin?: string;
}
export interface ResultContext {
  election_key: string;
  election_date: string;
  stage: ElectionStage;
  snapshot_id: string;
  copied_at: string;
  first_published_at: string;
}
export interface ElectionSummary extends ResultContext {
  coverage: Coverage;
}
export interface ElectionsAnswer {
  elections: ElectionSummary[];
}
export interface ResultSourceLocator {
  source_sha256: string;
  source_url?: string;
  locator?: string;
  row_numbers?: number[];
  row_number?: number;
}
export interface ResultDiagnostic {
  race_id: string;
  office_id: string;
  office_name?: string;
  county_id: string;
  precinct_id: string;
  office_votes: number;
  total_voted: number;
  excess?: number;
  result_row_numbers?: number[];
  statistics_row_number?: number;
}
export interface ResultCandidate {
  /** Null includes unmatched result choices; never manufacture a candidacy ID. */
  candidate_id: string | null;
  candidate_stable_id?: string | null;
  candidate_order_code?: string;
  name: string;
  party?: string | null;
  is_write_in_aggregate: boolean;
  votes: number | null;
  /** Only checked authority evidence supplies an outcome; vote order never does. */
  outcome: "elected" | "not_elected" | null;
  outcome_status?: "certified" | "pending";
  evidence?: Array<{
    sha256: string;
    authority?: string;
    fetched_at?: string;
    quote?: string;
    locator: { page?: number; line_start?: number; line_end?: number };
  }>;
  source_rows?: number[];
  summary_sources?: ResultSourceLocator[];
  candidate_source_row?: number | null;
}
export interface ExpectedCertificationAuthority {
  status: "expected" | "unknown";
  level: "state" | "county" | null;
  name: string | null;
  county_ids: string[];
  certification_observed: false;
  reason: string;
  evidence: ResultSourceLocator[];
}
export interface Race {
  id: string;
  /** The original source race identifier is distinct from the API's hashed id. */
  race_id: string;
  label: string;
  office_id: string;
  office_name: string;
  jurisdiction: string;
  jurisdiction_id?: string;
  jurisdiction_kind?: string;
  district?: string | null;
  county_name: string | null;
  county_ids?: string[];
  result_status: string;
  outcome_review?: { version: string };
  source_status?: string;
  source_sha256?: string;
  candidate_source_sha256?: string;
  summary_source_sha256?: string | null;
  roster_state?: string;
  candidates: ResultCandidate[];
  total_votes: number | null;
  coverage: Coverage;
  diagnostics: ResultDiagnostic[];
  precinct_voter_bound_status:
    "not_checked" | "discrepancies" | "no_discrepancies_found";
  expected_certification_authority?: ExpectedCertificationAuthority;
  seats_to_elect?: number | null;
  seats_source?: "office_title" | null;
}
export interface RacesAnswer extends ResultContext {
  query: string;
  coverage: Coverage;
  races: Race[];
  page: Page;
}
export interface RaceAnswer extends ResultContext {
  race: Race;
  sources: RetainedSource[];
  coverage: Coverage;
}
export interface PrecinctResultRow {
  row_number: number;
  raw_row?: string;
  state?: string;
  candidate_name: string;
  votes: number | null;
  candidate_order_code?: string;
  party?: string | null;
  county_id?: string;
  precinct_id?: string;
  office_id?: string;
  office_name?: string;
  district?: string;
  vote_percentage?: string | number | null;
  precincts_reporting?: number | null;
  precincts_expected?: number | null;
  total_votes?: number | null;
  suffix?: string;
  incumbent_code?: string;
  is_write_in_aggregate?: boolean;
}
export interface Precinct {
  key: string;
  name: string;
  county: string;
  county_name: string | null;
  source_sha256: string;
  rows: PrecinctResultRow[];
  diagnostics: ResultDiagnostic[];
}
export interface PrecinctsAnswer extends ResultContext {
  race_id: string;
  query: string;
  county: string | null;
  result_status: string;
  precincts: Precinct[];
  page: Page;
}
export interface SourceLinesAnswer {
  election_key: string;
  snapshot_id?: string;
  collection_id?: string;
  source: RetainedSource;
  encoding: "utf-8" | "windows-1252";
  lines: Array<{ number: number; text: string }>;
  page: LinePage;
}

export type SpenderType = "PCF" | "PTU" | "other";
export type SpendingDirection = "For" | "Against" | "unknown";
export interface SpendingMeasure {
  state: "reported" | "amount_unavailable" | "no_records";
  record_count: number;
  amount: DecimalUSD | null;
  /** A known subtotal is not a substitute for a withheld total. */
  known_amount_subtotal: DecimalUSD | null;
  missing_amount_count: number;
  included_unpaid_amount: DecimalUSD | null;
  known_unpaid_subtotal: DecimalUSD | null;
  missing_unpaid_count: number;
  missing_date_count: number;
  missing_year_count: number;
  date_year_conflict_count: number;
  date_coverage: "no_records" | "incomplete" | "dates_present";
  first_known_date: string | null;
  last_known_date: string | null;
}
export interface CategorySpending extends SpendingMeasure {
  category: SpenderType;
  direction: SpendingDirection;
}
export interface FilerSpending extends SpendingMeasure {
  spender_type: string | null;
  spender_sub_type: string | null;
  direction: SpendingDirection;
}
export interface PaymentSource {
  snapshot_id: string;
  content_hash: string;
  record_set_hash: string | null;
  source_url: string;
  copied_at: string | null;
  row_count: number;
  record_number_basis: string;
}
export interface OutsideContext {
  election_key: string;
  election_snapshot_id: string;
  reported_year: number;
  year_basis: "source_reported_calendar_year";
  election_stage_available: false;
  scope_note: string;
  complete_election_spending: false;
  candidate_attribution: "not_attributed";
  currency: "USD";
  version: string;
  release_id: string;
  source: PaymentSource;
}
export interface SpendingFilters {
  spenderType?: SpenderType | null;
  direction?: SpendingDirection | null;
  /** Empty string is an exact filed value; null/undefined means no filter. */
  spenderRegistration?: string | null;
  targetRegistration?: string | null;
}
export interface OutsideSpendingAnswer extends OutsideContext {
  inventory: Record<
    "all_source_records" | "reported_year" | "missing_year" | "other_years",
    SpendingMeasure
  >;
  filters: {
    spender_type: SpenderType | null;
    direction: SpendingDirection | null;
    spender_registration: string | null;
    target_registration: string | null;
  };
  filtered_total: SpendingMeasure;
  category_totals: CategorySpending[];
  groups: FilerSpending[];
  definitions: Record<string, string>;
}
export interface PaymentFields {
  Spender: string | null;
  "Spender Reg Num": string | null;
  "Spender type": string | null;
  "Spender sub-type": string | null;
  "Affected Comte Name": string | null;
  "Affected Cmte Reg Num": string | null;
  "For /Against": string | null;
  Year: number | null;
  Date: string | null;
  Type: string | null;
  Amount: DecimalUSD | null;
  "Unpaid amount": DecimalUSD | null;
  "In kind?": string | null;
  "In kind descr": string | null;
  Purpose: string | null;
  "Vendor name": string | null;
  "Vendor city": string | null;
  "Vendor State": string | null;
  "Vendor zip": string | null;
}
export interface PaymentRecord {
  row_number: number;
  resolution:
    "not_attributed" | "checked_account_and_period" | "outside_checked_period";
  fields: PaymentFields;
}
export interface OutsideRecordsAnswer extends OutsideContext {
  scope: "year" | "missing_year";
  rows: PaymentRecord[];
  page: Page;
}

export type AccountState =
  | "checked"
  | "partial"
  | "unavailable"
  | "no_confirmed_link"
  | "write_in_aggregate";
export interface AccountEvidence {
  kind: string;
  sha256: string;
  url?: string;
  page?: number;
  lines?: number[];
  source_row?: number;
  row_number?: number;
  locator?: string;
  collection_id?: string;
  source_election_key?: string;
  source_state?: "available" | "unavailable";
  retained_source_url?: string;
}
export interface ReportFiling {
  registration_number: string;
  filing_year: number;
  report_type: string;
  report_name: string;
  cut_off_date: string | null;
  special_election: boolean;
  effective_amendment_index: number | null;
  amendment_count: number | null;
  termination_date: string | null;
}
export interface ContributionFigure {
  cash: DecimalUSD;
  in_kind: DecimalUSD;
  total: DecimalUSD;
  source_page: number;
  source_lines: number[];
}
export interface ExpenditureFigure extends ContributionFigure {
  unpaid: DecimalUSD;
}
export interface ReportFigures {
  contributions_received: ContributionFigure;
  campaign_expenditures: ExpenditureFigure;
  all_disbursements: ExpenditureFigure;
}
export interface FinancialReport {
  report_key: string;
  registration_number: string;
  filing: ReportFiling;
  document_hash: string | null;
  document: Partial<RetainedSource>;
  catalogue_source: Partial<RetainedSource>;
  financial_source: Partial<RetainedSource>;
  period_start: string | null;
  period_end: string | null;
  period_basis: "calendar_year_to_date" | "reported_period" | null;
  received_date: string | null;
  attribution: "checked" | "period_not_covered" | "period_unavailable";
  figure_status: "source_verified" | "unavailable";
  source_figure_status: string | null;
  figures: ReportFigures | null;
  unavailable_reason: string | null;
  complete_election_spending: false;
}
export interface LatestReport {
  state:
    "reported" | "unavailable" | "no_held_report" | "ambiguous_latest_report";
  report_key: string | null;
  figures: ReportFigures | null;
  period_start?: string | null;
  period_end?: string | null;
}
export interface CheckedAccount {
  registration_number: string;
  committee_name: string | null;
  authority: "mn_cfb";
  decision_id: number;
  period_start: string;
  period_end: string;
  checked_on: string;
  evidence: AccountEvidence[];
  /** Null: report source unavailable. Empty list: checked account has no held report. */
  reports: FinancialReport[] | null;
  latest_report: LatestReport;
}
export interface AccountGap {
  registration_number: string;
  authority?: string;
  state:
    | "withdrawn"
    | "rejected"
    | "identity_changed"
    | "sources_unavailable"
    | "period_not_covered";
}
export interface CandidateFinanceCoverage {
  state:
    | "matched"
    | "write_in_aggregate"
    | "collection_unavailable"
    | "candidate_source_identity_unavailable"
    | "ambiguous_coverage"
    | "not_in_collection_roster"
    | "roster_source_unavailable"
    | "roster_version_mismatch"
    | "candidate_identity_mismatch";
  collection_id?: string;
  candidate_id?: string;
  stable_id?: string;
  county_id?: string;
  office_id?: string;
  office?: string;
  name?: string;
  party?: string | null;
  source_sha256?: string;
  source_row?: number;
  municipal_fips_code?: string | null;
  school_district_number?: string | null;
  authority?: "board" | "federal" | "county_local";
  authority_scope?: string;
  outside_support_scope?: string;
  link_state?: string;
  gap?: string | null;
}
export interface CandidateOutsideSpending {
  state: AccountState;
  groups: CategorySpending[] | null;
  total: SpendingMeasure | null;
  reason?: string;
  excluded_missing_date?: SpendingMeasure;
  excluded_missing_year?: SpendingMeasure;
  excluded_outside_reviewed_period?: SpendingMeasure;
  scope?: string;
  complete_election_spending?: false;
}
export interface FinanceCandidate extends ResultCandidate {
  account_state: AccountState;
  account_gaps: AccountGap[];
  accounts: CheckedAccount[];
  finance_coverage: CandidateFinanceCoverage;
  report_state: AccountState | "not_collected";
  outside_spending: CandidateOutsideSpending;
}
export interface SectionAvailability {
  state: "available" | "unavailable";
  reason: string | null;
}
export interface FinanceContext {
  election_key: string;
  race_id: string;
  snapshot_id: string;
  collection_id: string | null;
  version: string;
  review_decision_id: number | null;
  report_availability: SectionAvailability;
  outside_spending_availability: SectionAvailability;
  payment_release_id: string | null;
  payment_version: string;
  payment_source: PaymentSource | null;
  copied_at: string | null;
  currency: "USD";
  complete_election_spending: false;
  sources: RetainedSource[];
  coverage: Coverage | null;
}
export interface ElectionFinanceAnswer extends FinanceContext {
  race_label: string;
  result_status: string;
  candidates: FinanceCandidate[];
  measure_note: string;
}
export interface CandidateOutsideRecordsAnswer extends FinanceContext {
  candidate_id: string;
  account_state: AccountState;
  filters: {
    spender_type: SpenderType | null;
    direction: SpendingDirection | null;
  };
  rows: PaymentRecord[];
  page: Page;
}

const root = (electionKey: string) => ["finance", "elections", electionKey];
const race = (electionKey: string, raceId: string) => [
  ...root(electionKey),
  "races",
  raceId,
];
export const electionsPath = () => apiPath(["finance", "elections"]);
export function electionRacesPath(
  electionKey: string,
  options: PageQuery & { snapshotId?: string | null; query?: string } = {},
) {
  return apiPath([...root(electionKey), "races"], {
    snapshot_id: options.snapshotId,
    q: options.query,
    limit: options.limit,
    offset: options.offset,
  });
}
export function electionRacePath(
  electionKey: string,
  raceId: string,
  snapshotId?: string | null,
) {
  return apiPath(race(electionKey, raceId), { snapshot_id: snapshotId });
}
export function electionPrecinctsPath(
  electionKey: string,
  raceId: string,
  options: PageQuery & {
    snapshotId: string;
    query?: string;
    county?: string | null;
  },
) {
  return apiPath([...race(electionKey, raceId), "precincts"], {
    snapshot_id: options.snapshotId,
    q: options.query,
    county: options.county,
    limit: options.limit,
    offset: options.offset,
  });
}
export function electionFinancePath(
  electionKey: string,
  raceId: string,
  options: { snapshotId?: string | null; version?: string | null } = {},
) {
  return apiPath([...race(electionKey, raceId), "finance"], {
    snapshot_id: options.snapshotId,
    version: options.version,
  });
}
function spendingQuery(filters: SpendingFilters) {
  return {
    spender_type: filters.spenderType,
    direction: filters.direction,
    spender_registration: filters.spenderRegistration,
    target_registration: filters.targetRegistration,
  };
}
/** apiPath deliberately omits blank search values; filed blank registrations are
 * an exact filter here, so restore only those 2 explicitly requested blanks. */
function spendingPath(parts: string[], query: Parameters<typeof apiPath>[1]) {
  const built = apiPath(parts, query);
  const [path, search = ""] = built.split("?");
  const params = new URLSearchParams(search);
  for (const key of ["spender_registration", "target_registration"]) {
    if (query?.[key] === "") params.set(key, "");
  }
  return params.size ? `${path}?${params}` : path;
}
export function electionOutsideSpendingPath(
  electionKey: string,
  options: SpendingFilters & {
    snapshotId?: string | null;
    version?: string | null;
    releaseId?: string | null;
  } = {},
) {
  return spendingPath([...root(electionKey), "outside-spending"], {
    election_snapshot_id: options.snapshotId,
    version: options.version,
    release_id: options.releaseId,
    ...spendingQuery(options),
  });
}
export function electionOutsideRecordsPath(
  electionKey: string,
  options: SpendingFilters &
    PageQuery & {
      version: string;
      releaseId: string;
      snapshotId?: string | null;
      scope?: "year" | "missing_year";
    },
) {
  return spendingPath([...root(electionKey), "outside-spending", "records"], {
    election_snapshot_id: options.snapshotId,
    version: options.version,
    release_id: options.releaseId,
    scope: options.scope,
    limit: options.limit,
    offset: options.offset,
    ...spendingQuery(options),
  });
}
export function candidateOutsideRecordsPath(
  electionKey: string,
  raceId: string,
  candidateId: string,
  options: PageQuery & {
    snapshotId: string;
    version: string;
    spenderType?: SpenderType;
    direction?: SpendingDirection;
    scope?: "attributed" | "outside_reviewed_period";
  },
) {
  return apiPath(
    [
      ...race(electionKey, raceId),
      "finance",
      "candidates",
      candidateId,
      "outside-spending",
    ],
    {
      snapshot_id: options.snapshotId,
      version: options.version,
      spender_type: options.spenderType,
      direction: options.direction,
      scope: options.scope,
      limit: options.limit,
      offset: options.offset,
    },
  );
}
export function electionSourcePath(
  electionKey: string,
  sourceHash: string,
  snapshotId: string,
) {
  return apiPath([...root(electionKey), "sources", sourceHash], {
    snapshot_id: snapshotId,
  });
}
export function spendingSourcePath(
  electionKey: string,
  snapshotId: string,
  version: string,
  releaseId: string,
) {
  return apiPath([...root(electionKey), "outside-spending", "source"], {
    election_snapshot_id: snapshotId,
    version,
    release_id: releaseId,
  });
}
export function electionSourceLinesPath(
  electionKey: string,
  sourceHash: string,
  snapshotId: string,
  options: LineQuery = {},
) {
  return apiPath([...root(electionKey), "sources", sourceHash, "lines"], {
    snapshot_id: snapshotId,
    ...options,
  });
}
export function financeReportSourcePath(
  electionKey: string,
  documentHash: string,
  collectionId: string,
) {
  return apiPath([...root(electionKey), "finance", "sources", documentHash], {
    collection_id: collectionId,
  });
}
export function financeSourcePath(
  electionKey: string,
  sourceHash: string,
  collectionId: string,
) {
  return apiPath(
    [...root(electionKey), "finance", "sources", sourceHash, "raw"],
    {
      collection_id: collectionId,
    },
  );
}
export function financeSourceLinesPath(
  electionKey: string,
  sourceHash: string,
  collectionId: string,
  options: LineQuery = {},
) {
  return apiPath(
    [...root(electionKey), "finance", "sources", sourceHash, "lines"],
    {
      collection_id: collectionId,
      ...options,
    },
  );
}
/** Derive the authenticated API path from proved historical membership. Never
 * fetch an arbitrary retained_source_url or guess the selected election instead. */
export function accountEvidencePath(
  evidence: AccountEvidence,
  mode: "raw" | "lines" = "raw",
  options: LineQuery = {},
): string | null {
  const hash = /^[a-f0-9]{64}$/;
  if (
    evidence.source_state !== "available" ||
    !evidence.collection_id ||
    !hash.test(evidence.collection_id) ||
    !hash.test(evidence.sha256) ||
    !evidence.source_election_key ||
    !/^mn-\d{4}-\d{2}-\d{2}-(general|primary|special)$/.test(
      evidence.source_election_key,
    )
  )
    return null;
  return mode === "raw"
    ? financeSourcePath(
        evidence.source_election_key,
        evidence.sha256,
        evidence.collection_id,
      )
    : financeSourceLinesPath(
        evidence.source_election_key,
        evidence.sha256,
        evidence.collection_id,
        options,
      );
}
/** Do not replace an unavailable total with its known subtotal, or parse a dollar
 * string through Number before the existing display formatter receives it. */
export function reportedAmount(
  measure: Pick<SpendingMeasure, "state" | "amount"> | null | undefined,
): DecimalUSD | null {
  return measure?.state === "reported" ? measure.amount : null;
}

/** Export the displayed scope, not just its visible precinct page. */
export function raceCsvPath(
  detail: RaceAnswer,
  options: {
    version?: string;
    query: string;
    reports: string[];
    externalGeneration?: string;
    externalVersions?: Array<[string, string]>;
  },
) {
  const params = new URLSearchParams({ snapshot_id: detail.snapshot_id });
  if (options.version) params.set("version", options.version);
  if (detail.race.outcome_review?.version)
    params.set("outcome_version", detail.race.outcome_review.version);
  if (options.query) params.set("q", options.query);
  for (const report of [...new Set(options.reports)])
    params.append("report_key", report);
  if (options.externalGeneration)
    params.set("external_generation_id", options.externalGeneration);
  for (const [candidate, version] of options.externalVersions ?? [])
    params.append("external_version", `${candidate}:${version}`);
  return (
    apiPath([...race(detail.election_key, detail.race.id), "export.csv"]) +
    "?" +
    params
  );
}
