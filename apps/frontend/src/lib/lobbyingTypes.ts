/** The public lobbying responses keep the Board's fields and separate source dates. */
export type LobbyingState = 'reported' | 'not_reported' | 'unavailable';
export type LobbyingIdentifier = string | number;
export interface LobbyingListOptions {
  q?: string;
  page?: number;
  year?: number;
  sort?: LobbyingDonationSort;
}

export type LobbyingDonationSort = 'name' | 'donations_desc' | 'donations_asc';

/**
 * The order the lobbyist directory opens in, and the one value left out of both the
 * address and the API request. One constant so the address, the first response and
 * the served default cannot drift apart.
 */
export const LOBBYING_DEFAULT_DONATION_SORT: LobbyingDonationSort = 'donations_desc';

export function lobbyingDonationSort(value: unknown): LobbyingDonationSort {
  return value === 'name' || value === 'donations_desc' || value === 'donations_asc'
    ? value
    : LOBBYING_DEFAULT_DONATION_SORT;
}

function lobbyingCalendarYear(): number {
  return Number(
    new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/Chicago',
      year: 'numeric',
    }).format(new Date()),
  );
}

export function lobbyingRecordDonationYear(value: unknown): number | undefined {
  const year = Number(value);
  return Number.isInteger(year) && year >= 2015 && year <= lobbyingCalendarYear()
    ? year
    : undefined;
}

export function lobbyingDonationYear(value: unknown): number | undefined {
  const year = Number(value);
  return Number.isInteger(year) && year >= 2015 && year < lobbyingCalendarYear() ? year : undefined;
}

export const LOBBYING_PAGE_SIZE = 50;

export function lobbyingListOptions({ q = '', page = 1 }: LobbyingListOptions = {}) {
  return { q: q.trim(), page: Number.isSafeInteger(page) && page > 0 ? page : 1 };
}

export const lobbyingSummaryQueryKey = () => ['lobbying-summary'] as const;
export const lobbyingPrincipalQueryKey = (id: LobbyingIdentifier | null | undefined) =>
  ['lobbying-principal', String(id ?? '')] as const;
export const lobbyingLobbyistQueryKey = (id: LobbyingIdentifier | null | undefined) =>
  ['lobbying-lobbyist', String(id ?? '')] as const;
export function lobbyingPrincipalsQueryKey(options: LobbyingListOptions = {}) {
  const { q, page } = lobbyingListOptions(options);
  return ['lobbying-principals', q, page] as const;
}
export function lobbyingLobbyistsQueryKey(options: LobbyingListOptions = {}) {
  const { q, page } = lobbyingListOptions(options);
  return [
    'lobbying-lobbyists',
    q,
    page,
    lobbyingDonationYear(options.year) ?? null,
    lobbyingDonationSort(options.sort),
  ] as const;
}

export interface LobbyingSourceStamp {
  release_id: string | null;
  copied_at: string | null;
  sources: { expenditures: string | null; lobbyists: string | null };
}

export interface LobbyingSummary extends LobbyingSourceStamp {
  state: 'reported' | 'unavailable';
  registered_lobbyists: number | null;
  principals_reporting: number | null;
  latest_reported_year: number | null;
  first_year: number | null;
  last_year: number | null;
}

export interface LobbyingSpendingRow {
  year: number | null;
  record_number: number;
  puc_lobbying_amount: string | null;
  legislative_lobbying_amount: string | null;
  administrative_lobbying_amount: string | null;
  mgu_lobbying_amount: string | null;
  general_lobbying_amount: string | null;
  total_spent: string | null;
}

export interface LobbyingPrincipalLobbyist {
  registration_number: string;
  name: string;
  formatted_name: string;
  principal_name_as_listed: string;
  principal_name_differs: boolean;
}

export interface LobbyingPrincipal extends LobbyingSourceStamp {
  entity_id: number;
  state: 'reported' | 'no_spending_rows' | 'unavailable';
  name: string | null;
  /** This principal's latest year with any reported amount, including a real zero. */
  latest_reported_year: number | null;
  /** The entire spending file's latest year with any reported amount. */
  source_latest_year: number | null;
  spending: {
    state: 'reported' | 'no_spending_rows' | 'unavailable';
    rows: LobbyingSpendingRow[];
  };
  lobbyists: { state: LobbyingState; total: number | null; rows: LobbyingPrincipalLobbyist[] };
}

export interface LobbyingAssociation {
  entity_id: number;
  name: string;
  spending_name: string | null;
  position: number;
  linkable: boolean;
  state: 'reported' | 'no_spending_rows';
}

export interface LobbyingContributionPayment {
  identity_basis?: 'official_report' | 'source_registration_number';
  record_number: number;
  contributor_name: string | null;
  employer: string | null;
  amount: string | null;
  received_on: string | null;
  in_kind: string | null;
  in_kind_description: string | null;
}

export interface LobbyingContributionCommittee {
  registration_number: string | null;
  name: string | null;
  kind: string | null;
  recipient_type: string | null;
  linkable: boolean;
  payment_count: number;
  payments: LobbyingContributionPayment[];
}

export interface LobbyingContributionYear {
  year: number | null;
  payment_count: number;
  committee_count: number;
  committees: LobbyingContributionCommittee[];
}

export interface LobbyingContributions {
  state: LobbyingState;
  payment_count: number | null;
  committee_count: number | null;
  /** Campaign contributions have their own source and date, not the lobbying pair's. */
  release_id: string | null;
  copied_at: string | null;
  source_url: string | null;
  years: LobbyingContributionYear[];
}

export interface LobbyingLobbyist extends LobbyingSourceStamp {
  registration_number: string;
  state: 'reported' | 'not_registered_today' | 'unavailable';
  name: string | null;
  formatted_name: string | null;
  /** Absent when no pair is held; otherwise the entire spending file's latest year. */
  latest_reported_year?: number | null;
  principals: {
    state: 'reported' | 'not_registered_today' | 'unavailable';
    total: number | null;
    rows: LobbyingAssociation[];
  };
  contributions: LobbyingContributions;
}

export interface LobbyingListPage extends LobbyingSourceStamp {
  state: LobbyingState;
  limit: number;
  offset: number;
  q: string;
  matched_on: 'substring_of_the_filed_name';
  total: number | null;
  has_more: boolean;
}

export interface LobbyingPrincipalListRow {
  /** Distinct current registered spellings sharing this official entity ID. */
  registered_names?: string[];
  entity_id: number;
  name: string;
  state: 'reported' | 'no_spending_rows';
  linkable: boolean;
  latest_reported_year: number | null;
}

export interface LobbyingPrincipalsPage extends LobbyingListPage {
  /** The entire spending file's latest year; each row also carries its own year. */
  latest_reported_year: number | null;
  principals: LobbyingPrincipalListRow[];
}

export interface LobbyingLobbyistListRow {
  registration_number: string;
  name: string;
  formatted_name: string;
  principal_count: number;
  donation_amount?: string | null;
  donation_state?: 'reported' | 'no_records' | 'unavailable';
}

export interface LobbyingLobbyistsPage extends LobbyingListPage {
  lobbyists: LobbyingLobbyistListRow[];
  sort?: LobbyingDonationSort;
  requested_year?: number | null;
  donations?: LobbyingDirectoryDonations;
}

export interface LobbyingDirectoryDonations {
  state: 'reported' | 'unavailable';
  year: number | null;
  available_years: number[];
  release_id: string | null;
  copied_at: string | null;
  source_url: string | null;
  eligible_count: number | null;
}
