/**
 * The outside-spending reads, apart from their wording: the shape of a year's
 * figures on a legislator's profile and the placeholder for a year whose request
 * failed, and the record page's payload, shaper and read key.
 *
 * `data/api.ts` and `hooks/useAppQueries.ts` are in the program every page downloads
 * before anything draws, and they need only these names from outside spending.
 * Importing them from `lib/outsideSpending.ts` put every sentence the profile block
 * and the record page print, and the money formatters behind them, into that first
 * download. This module imports only types. `lib/outsideSpending.ts` re-exports
 * every name here, so the screens, their tests and `api/page.ts` import them from
 * where they always did.
 */

import type { CurrentClaimFreshness } from '../data/types';

/**
 * Which answer this year carries. Read it before any figure.
 *
 * The first 3 are the server's own. `load_failed` never comes from the server: it is
 * what a year gets when its request did not arrive, so one year failing cannot delete
 * the other year's real figures. Its own sentence, because a request that failed is a
 * different fact from a download of ours that is stale, and telling a reader the
 * filings are out of date when the network dropped would be a claim we cannot support.
 */
export type OutsideSpendingState = 'reported' | 'link_unconfirmed' | 'unavailable' | 'load_failed';

export interface OutsideSpendingCommittee {
  registrationNumber: string;
  name: string;
  /** The office the reviewer recorded, when they recorded one. */
  office: string | null;
}

export interface OutsideSpendingYear {
  year: number;
  state: OutsideSpendingState;
  /** Age of the confirmed ownership behind these figures, separate from the
   * download date. Optional for older saved records; absence never means fresh. */
  currentClaim?: CurrentClaimFreshness;
  /** Which download answered, so 2 years can be checked for agreeing on one. */
  snapshotId: string | null;
  /**
   * The committees these figures cover, named. A member can hold several at once, and
   * the figures are a sum across every one a person has confirmed -- so a page that
   * does not name them says "spent about this legislator" over a total that may cover
   * one committee out of several, or 2 races at once.
   */
  committees: OutsideSpendingCommittee[];
  /** Null in every state but `reported`, where a 0 is a measured 0. */
  supporting: number | null;
  opposing: number | null;
  /**
   * Money whose "For" or "Against" the filing does not record. 0 for every
   * committee in the current release, so the block shows it only when it is not.
   */
  directionNotRecorded: number | null;
  /**
   * Each figure's own payment count. Kept apart rather than shared, because one
   * count printed under 2 figures says the same payments produced each of them.
   */
  supportingPayments: number | null;
  opposingPayments: number | null;
  directionNotRecordedPayments: number | null;
  firstPaymentOn: string | null;
  lastPaymentOn: string | null;
  sourceUrl: string | null;
  fetchedAt: string | null;
}

/**
 * The placeholder for a year whose request did not arrive.
 *
 * Every figure null, so nothing can be printed for it, and its own state so its
 * sentence says what actually happened. Exists because the 2 years are 2 requests: with
 * one combined promise, either year failing threw away the other year's real figures
 * and replaced them with a whole-card error. Found by an automated review on #1332.
 */
export function outsideSpendingLoadFailure(year: number): OutsideSpendingYear {
  return {
    year,
    state: 'load_failed',
    snapshotId: null,
    committees: [],
    supporting: null,
    opposing: null,
    directionNotRecorded: null,
    supportingPayments: null,
    opposingPayments: null,
    directionNotRecordedPayments: null,
    firstPaymentOn: null,
    lastPaymentOn: null,
    sourceUrl: null,
    fetchedAt: null,
  };
}

export type OutsideSpendingRecordState = 'reported' | 'not_reported' | 'unavailable';

export type OutsideSpendingView = 'record' | 'spender' | 'about';

export type OutsideSpendingSort = 'newest' | 'largest';

export interface OutsideSpendingRecordRow {
  spender: string | null;
  spenderRegistrationNumber: string | null;
  spenderInRegister: boolean;
  spenderLinkable: boolean;
  aboutCommitteeName: string | null;
  aboutCommitteeRegistrationNumber: string | null;
  aboutCommitteeInRegister: boolean;
  aboutCommitteeLinkable: boolean;
  /** The server's own 3 values: "For", "Against", or "not recorded". */
  direction: string;
  directionAsFiled: string | null;
  purpose: string | null;
  vendorName: string | null;
  expenditureType: string | null;
  inKind: boolean;
  paidOn: string | null;
  year: number | null;
  amount: string | null;
  unpaidAmount: string | null;
}

export interface OutsideSpendingRecordFigures {
  rowCount: number;
  rowsMissingAnAmount: number;
  amountTotal: string | null;
  supportingCount: number;
  supportingAmount: string | null;
  opposingCount: number;
  opposingAmount: string | null;
  directionNotRecordedCount: number;
  directionNotRecordedAmount: string | null;
  inKindCount: number;
  firstYear: number | null;
  lastYear: number | null;
  committeeCount: number;
  spenderCount: number;
  committeesNotLinkable: number | null;
}

export interface OutsideSpendingSubject {
  registrationNumber: string;
  name: string | null;
  inRegister: boolean;
  linkable: boolean;
  kind: string | null;
  office: string | null;
  district: string | null;
  confirmedMember: { slug: string; fullName: string } | null;
}

export interface OutsideSpendingRecordPage {
  snapshotId?: string | null;
  state: OutsideSpendingRecordState;
  about: OutsideSpendingSubject | null;
  spender: OutsideSpendingSubject | null;
  year: number | null;
  sort: OutsideSpendingSort;
  rows: OutsideSpendingRecordRow[];
  pageNumber: number;
  pageSize: number;
  totalRows: number | null;
  hasMore: boolean;
  figures: OutsideSpendingRecordFigures | null;
  sourceUrl: string | null;
  fetchedAt: string | null;
}

// --- Reading the service's own JSON --------------------------------------------
//
// These sit here rather than in `data/api.ts` so `api/page.ts` can shape the very
// payload it already read into the page a reader gets (issue #1966). The page
// function runs in Node and cannot load `data/api.ts`, which imports
// `react-native` (pinned by `lib/__tests__/pageFunctionImports.test.ts`).
//
// One shaper, used by both sides, is the point: a seeded figure and a fetched
// figure come out of the same code, so they cannot differ.

/** The record page's payload, exactly as `/campaign-finance/outside-spending` sends it. */
export interface ApiOutsideSpendingRecordPagePayload {
  snapshot_id?: string | null;
  state?: string;
  about?: Record<string, unknown> | null;
  spender?: Record<string, unknown> | null;
  year?: number | null;
  sort?: string;
  rows?: Record<string, unknown>[] | null;
  page?: { number: number; size: number; has_more: boolean; total_rows?: number | null } | null;
  figures?: Record<string, unknown> | null;
  source_url?: string | null;
  fetched_at?: string | null;
}

const asBool = (value: unknown): boolean => value === true;
const asInt = (value: unknown): number | null => (typeof value === 'number' ? value : null);
const asText = (value: unknown): string | null => (typeof value === 'string' ? value : null);

function recordState(state: string | undefined): OutsideSpendingRecordState {
  if (state === 'reported') return 'reported';
  if (state === 'not_reported') return 'not_reported';
  return 'unavailable';
}

function outsideSpendingRecordSubject(
  raw: Record<string, unknown> | null | undefined,
): OutsideSpendingSubject | null {
  if (!raw) return null;
  const member = raw.confirmed_member as Record<string, unknown> | null | undefined;
  return {
    registrationNumber: String(raw.registration_number ?? ''),
    name: asText(raw.name),
    inRegister: asBool(raw.in_register),
    linkable: asBool(raw.linkable),
    kind: asText(raw.kind),
    office: asText(raw.office),
    district: asText(raw.district),
    confirmedMember:
      member && typeof member.slug === 'string' && typeof member.full_name === 'string'
        ? { slug: member.slug, fullName: member.full_name }
        : null,
  };
}

function outsideSpendingRecordRow(raw: Record<string, unknown>): OutsideSpendingRecordRow {
  return {
    spender: asText(raw.spender),
    spenderRegistrationNumber: asText(raw.spender_registration_number),
    spenderInRegister: asBool(raw.spender_in_register),
    spenderLinkable: asBool(raw.spender_linkable),
    aboutCommitteeName: asText(raw.about_committee_name),
    aboutCommitteeRegistrationNumber: asText(raw.about_committee_registration_number),
    aboutCommitteeInRegister: asBool(raw.about_committee_in_register),
    aboutCommitteeLinkable: asBool(raw.about_committee_linkable),
    direction: asText(raw.direction) ?? 'not recorded',
    directionAsFiled: asText(raw.direction_as_filed),
    purpose: asText(raw.purpose),
    vendorName: asText(raw.vendor_name),
    expenditureType: asText(raw.expenditure_type),
    inKind: asBool(raw.in_kind),
    paidOn: asText(raw.paid_on),
    year: asInt(raw.year),
    amount: asText(raw.amount),
    unpaidAmount: asText(raw.unpaid_amount),
  };
}

function outsideSpendingRecordFigures(
  raw: Record<string, unknown> | null | undefined,
): OutsideSpendingRecordFigures | null {
  if (!raw) return null;
  return {
    rowCount: asInt(raw.row_count) ?? 0,
    rowsMissingAnAmount: asInt(raw.rows_missing_an_amount) ?? 0,
    amountTotal: asText(raw.amount_total),
    supportingCount: asInt(raw.supporting_count) ?? 0,
    supportingAmount: asText(raw.supporting_amount),
    opposingCount: asInt(raw.opposing_count) ?? 0,
    opposingAmount: asText(raw.opposing_amount),
    directionNotRecordedCount: asInt(raw.direction_not_recorded_count) ?? 0,
    directionNotRecordedAmount: asText(raw.direction_not_recorded_amount),
    inKindCount: asInt(raw.in_kind_count) ?? 0,
    firstYear: asInt(raw.first_year),
    lastYear: asInt(raw.last_year),
    committeeCount: asInt(raw.committee_count) ?? 0,
    spenderCount: asInt(raw.spender_count) ?? 0,
    committeesNotLinkable: asInt(raw.committees_not_linkable),
  };
}

/** One page of the record, from the payload the service sent. Figures only where
 *  the service says `reported`, so a gap never renders as a zero. */
export function outsideSpendingRecordPageFromPayload(
  payload: ApiOutsideSpendingRecordPagePayload,
): OutsideSpendingRecordPage {
  const state = recordState(payload.state);
  return {
    state,
    snapshotId: asText(payload.snapshot_id),
    about: outsideSpendingRecordSubject(payload.about),
    spender: outsideSpendingRecordSubject(payload.spender),
    year: payload.year ?? null,
    sort: payload.sort === 'largest' ? 'largest' : 'newest',
    rows: state === 'reported' ? (payload.rows ?? []).map(outsideSpendingRecordRow) : [],
    pageNumber: payload.page?.number ?? 1,
    pageSize: payload.page?.size ?? 50,
    totalRows: payload.page?.total_rows ?? null,
    hasMore: payload.page?.has_more ?? false,
    figures: state === 'reported' ? outsideSpendingRecordFigures(payload.figures) : null,
    sourceUrl: payload.source_url ?? null,
    fetchedAt: payload.fetched_at ?? null,
  };
}

/**
 * The React Query key one page of the record answers. Shared with `api/page.ts`
 * so the payload it already read is labelled with the key the app asks for
 * (issue #1966).
 */
export function outsideSpendingRecordQueryKey(options: {
  about?: string;
  spender?: string;
  year: number | null;
  sort: OutsideSpendingSort;
  page: number;
}): readonly unknown[] {
  return [
    'outside-spending-record',
    options.about ?? null,
    options.spender ?? null,
    options.year,
    options.sort,
    options.page,
  ];
}
