import { publicApiRequest, type ApiCommitteePaymentsPayload, isNotFoundError } from './api';
import type {
  DetailedMadePayment,
  DetailedReceivedPayment,
  MoneyDetailsPayment,
} from '../lib/campaignMoneyDetails';

export type MoneyDetailsDirection = 'received' | 'made';
export interface CompleteCampaignMoneyPayments<Payment = MoneyDetailsPayment> {
  registrationNumber: string;
  year: number;
  direction: MoneyDetailsDirection;
  state: 'reported' | 'not_reported' | 'unavailable';
  payments: Payment[];
  releaseId: string;
  linkableRegistrationNumbers: string[];
  sourceUrl: string | null;
  fetchedAt: string | null;
  totalPayments: number | null;
}

type Payload = ApiCommitteePaymentsPayload & {
  release_id?: string;
  registration_number?: string;
  year?: number;
  direction?: string;
};
import { MoneyDetailsReadError } from './moneyDetailsReadError';
export { MoneyDetailsReadError } from './moneyDetailsReadError';
const asText = (value: unknown) => (typeof value === 'string' ? value : null);
function receivedRow(row: Record<string, unknown>): DetailedReceivedPayment {
  return {
    contributor: asText(row.contributor),
    contributorRegistrationNumber: asText(row.contributor_registration_number),
    contributorType: asText(row.contributor_type),
    employer: asText(row.employer),
    amount: asText(row.amount),
    receivedOn: asText(row.received_on),
    receiptType: asText(row.receipt_type),
    inKind: asText(row.in_kind),
    inKindDescription: asText(row.in_kind_description),
    recordNumber: typeof row.record_number === 'number' ? row.record_number : undefined,
  };
}
function madeRow(row: Record<string, unknown>): DetailedMadePayment {
  return {
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
    inKindDescription: asText(row.in_kind_description),
    unpaidAmount: asText(row.unpaid_amount),
    recordNumber: typeof row.record_number === 'number' ? row.record_number : undefined,
  };
}

/** How many later pages of one list download side by side. The 2 directions of a
 *  committee read together, so a page load asks the service for at most 6 at once. */
export const LIST_PAGES_AT_ONCE = 3;

/**
 * Every payment of one committee, one year, one direction: the first page tells
 * how many there are, and the rest download side by side rather than one after
 * another. A committee with 1,000 payments in a direction spent 5 round trips in a
 * row on the live site (about 2.4 s for the list a chart is waiting on, 17 Sep
 * 2026); the same 5 pages arrive in 2 rounds now.
 *
 * Every check the one-after-another read made is still made, page by page: the
 * same release, the same committee, year and direction, the same total, rows
 * within the cap, and a list that adds up to the count the service gave. A page
 * that comes back with the wrong number of rows for its place in the list fails
 * the read rather than being spliced in.
 */
export function getCompleteCampaignMoneyPayments(
  registrationNumber: string,
  year: number,
  direction: 'received',
  signal?: AbortSignal,
): Promise<CompleteCampaignMoneyPayments<DetailedReceivedPayment>>;
export function getCompleteCampaignMoneyPayments(
  registrationNumber: string,
  year: number,
  direction: 'made',
  signal?: AbortSignal,
): Promise<CompleteCampaignMoneyPayments<DetailedMadePayment>>;
export async function getCompleteCampaignMoneyPayments(
  registrationNumber: string,
  year: number,
  direction: MoneyDetailsDirection,
  signal?: AbortSignal,
): Promise<CompleteCampaignMoneyPayments> {
  const readPage = async (offset: number): Promise<Payload> => {
    signal?.throwIfAborted();
    const params = new URLSearchParams({
      direction,
      year: String(year),
      sort: 'date',
      limit: '250',
      offset: String(offset),
    });
    const { data } = await publicApiRequest<{ data: Payload }>(
      `/committees/${encodeURIComponent(registrationNumber)}/payments?${params.toString()}`,
      signal,
    );
    signal?.throwIfAborted();
    if (!data.release_id) throw new MoneyDetailsReadError('missing_release');
    if (data.registration_number && data.registration_number !== registrationNumber) {
      throw new MoneyDetailsReadError('wrong_committee');
    }
    if (data.year !== undefined && data.year !== year)
      throw new MoneyDetailsReadError('wrong_year');
    if (data.direction !== undefined && data.direction !== direction) {
      throw new MoneyDetailsReadError('wrong_direction');
    }
    return data;
  };

  const first = await readPage(0);
  const releaseId = first.release_id!;
  const sourceUrl = first.source_url ?? null;
  const fetchedAt = first.fetched_at ?? null;
  if (first.state !== 'reported') {
    if ((first.payments?.length ?? 0) > 0 || first.page?.has_more) {
      throw new MoneyDetailsReadError('state_changed');
    }
    return {
      registrationNumber,
      year,
      direction,
      state: first.state === 'not_reported' ? 'not_reported' : 'unavailable',
      payments: [],
      releaseId,
      linkableRegistrationNumbers: [],
      sourceUrl,
      fetchedAt,
      totalPayments: null,
    };
  }
  const expectedCount = pageCount(first, 0);
  const firstRows = pageRows(first, expectedCount, 0);
  const pageSize = firstRows.length;
  if (first.page!.has_more && firstRows.length >= expectedCount) {
    throw new MoneyDetailsReadError('count_mismatch');
  }

  // Every later page's place in the list is known from the first page: the service
  // filled it to `pageSize` rows and said how many rows there are in all.
  const offsets: number[] = [];
  if (first.page!.has_more) {
    for (let offset = pageSize; offset < expectedCount; offset += pageSize) offsets.push(offset);
  }
  const later: Payload[] = [];
  let next = 0;
  async function worker() {
    while (next < offsets.length) {
      const index = next++;
      later[index] = await readPage(offsets[index]);
    }
  }
  await Promise.all(Array.from({ length: LIST_PAGES_AT_ONCE }, worker));

  const payments: MoneyDetailsPayment[] = [];
  const linkable = new Set<string>();
  const shape = (row: Record<string, unknown>) =>
    direction === 'received' ? receivedRow(row) : madeRow(row);
  payments.push(...firstRows.map(shape));
  for (const number of first.linkable_registration_numbers ?? []) linkable.add(number);
  for (const [index, data] of later.entries()) {
    const offset = offsets[index];
    if (data.release_id !== releaseId) throw new MoneyDetailsReadError('release_changed');
    if (data.state !== 'reported') throw new MoneyDetailsReadError('state_changed');
    if (pageCount(data, offset) !== expectedCount) throw new MoneyDetailsReadError('count_changed');
    const rows = pageRows(data, expectedCount, offset);
    const isLast = index === offsets.length - 1;
    // A middle page holds a full page; the last holds what is left. Anything else is
    // a list that changed underneath the read.
    if (rows.length !== (isLast ? expectedCount - offset : pageSize)) {
      throw new MoneyDetailsReadError('count_mismatch');
    }
    if (Boolean(data.page!.has_more) !== !isLast) throw new MoneyDetailsReadError('count_mismatch');
    payments.push(...rows.map(shape));
    for (const number of data.linkable_registration_numbers ?? []) linkable.add(number);
  }
  if (payments.length !== expectedCount) throw new MoneyDetailsReadError('incomplete_list');
  return {
    registrationNumber,
    year,
    direction,
    state: 'reported',
    payments,
    releaseId,
    linkableRegistrationNumbers: [...linkable],
    sourceUrl,
    fetchedAt,
    totalPayments: expectedCount,
  };
}

/** The list's total as one page states it, or a refusal when the page cannot be trusted. */
function pageCount(data: Payload, offset: number): number {
  const page = data.page;
  if (
    !page ||
    page.offset !== offset ||
    !Number.isSafeInteger(page.total_payments) ||
    page.total_payments! < 0
  ) {
    throw new MoneyDetailsReadError('invalid_page_count');
  }
  return page.total_payments!;
}

/** One page's rows, within the cap and never empty on a page that says more follow. */
function pageRows(data: Payload, expectedCount: number, offset: number): Record<string, unknown>[] {
  const rows = data.payments;
  if (!Array.isArray(rows) || rows.length > 250 || (data.page!.has_more && rows.length === 0)) {
    throw new MoneyDetailsReadError('invalid_page');
  }
  if (offset + rows.length > expectedCount) throw new MoneyDetailsReadError('count_mismatch');
  return rows;
}

export interface CampaignMoneyHistory {
  years: CompleteCampaignMoneyPayments<DetailedReceivedPayment>[];
  releaseId: string;
}

/** Only 2 year reads run at once; each year is complete before it enters the result. */
export async function getCampaignMoneyHistory(
  registrationNumber: string,
  years: readonly number[],
  selected: CompleteCampaignMoneyPayments<DetailedReceivedPayment>,
  signal?: AbortSignal,
): Promise<CampaignMoneyHistory> {
  if (selected.registrationNumber !== registrationNumber)
    throw new MoneyDetailsReadError('wrong_committee');
  const results: CompleteCampaignMoneyPayments<DetailedReceivedPayment>[] = [];
  const controller = new AbortController();
  const cancel = () => controller.abort(signal?.reason);
  signal?.addEventListener('abort', cancel, { once: true });
  if (signal?.aborted) cancel();
  let next = 0;
  async function worker() {
    while (next < years.length) {
      controller.signal.throwIfAborted();
      const index = next++;
      const year = years[index];
      const result =
        year === selected.year
          ? selected
          : await getCompleteCampaignMoneyPayments(
              registrationNumber,
              year,
              'received',
              controller.signal,
            );
      if (result.releaseId !== selected.releaseId)
        throw new MoneyDetailsReadError('release_changed');
      if (result.state === 'unavailable') throw new MoneyDetailsReadError('history_unavailable');
      results[index] = result;
    }
  }
  try {
    await Promise.all([worker(), worker()]);
  } catch (error) {
    controller.abort(error);
    throw error;
  } finally {
    signal?.removeEventListener('abort', cancel);
  }
  return { years: results, releaseId: selected.releaseId };
}

export interface CampaignMoneyYearState {
  year: number;
  linkState: string;
  committees: Record<string, { splitState: string; reportedTotal: string | null }>;
}
/** How many year reads run side by side on the per-year fallback; the API answered 4 at once in 0.6 s. */
export const YEAR_STATE_READS_AT_ONCE = 3;

/**
 * Every year's state, in the order the years were asked for, from 1 request.
 *
 * The year buttons above a member's money need only each year's `link_state` and
 * each committee's `split`, and read the whole per-year answer 11 times to get
 * them: about 4 s on the live site, 3 at a time, while the buttons waited
 * (17 Sep 2026). `/campaign-finance/years` answers the whole span at once.
 *
 * The frontend and the data service deploy separately, so a service that does
 * not serve the route yet answers 404, and this falls back to the per-year reads
 * for exactly that case. An unknown member is a 404 on both routes, and the
 * fallback then fails the same way the per-year reads always did.
 */
export async function getCampaignMoneyYearStates(
  legislatorId: string,
  years: readonly number[],
  signal?: AbortSignal,
): Promise<CampaignMoneyYearState[]> {
  if (years.length === 0) return [];
  const from = Math.min(...years);
  const to = Math.max(...years);
  let data: {
    link_state: string;
    years: {
      year: number;
      committees: {
        registration_number: string;
        split: { state: string; reported_total: string | null };
      }[];
    }[];
  };
  try {
    ({ data } = await publicApiRequest<{ data: typeof data }>(
      `/legislators/${encodeURIComponent(legislatorId)}/campaign-finance/years?from=${from}&to=${to}`,
      signal,
    ));
  } catch (error) {
    if (!isNotFoundError(error)) throw error;
    return readCampaignMoneyYearStates(years, signal, (year) =>
      getCampaignMoneyYearState(legislatorId, year, signal),
    );
  }
  const byYear = new Map(data.years.map((entry) => [entry.year, entry]));
  return years.map((year) => {
    const entry = byYear.get(year);
    if (!entry) throw new MoneyDetailsReadError('wrong_year');
    return {
      year,
      linkState: data.link_state,
      committees: Object.fromEntries(
        entry.committees.map((committee) => [
          committee.registration_number,
          { splitState: committee.split.state, reportedTotal: committee.split.reported_total },
        ]),
      ),
    };
  });
}

/**
 * The per-year reads, a few at a time: never all at once (they would crowd out
 * the selected year's own payment reads, which are what the reader is looking
 * at) and never one after another (11 years took about 7 s that way).
 */
export async function readCampaignMoneyYearStates<State>(
  years: readonly number[],
  signal: AbortSignal | undefined,
  read: (year: number) => Promise<State>,
): Promise<State[]> {
  const states: State[] = [];
  let next = 0;
  async function worker() {
    while (next < years.length) {
      signal?.throwIfAborted();
      const index = next++;
      states[index] = await read(years[index]);
    }
  }
  await Promise.all(Array.from({ length: YEAR_STATE_READS_AT_ONCE }, worker));
  return states;
}

export async function getCampaignMoneyYearState(
  legislatorId: string,
  year: number,
  signal?: AbortSignal,
): Promise<CampaignMoneyYearState> {
  const { data } = await publicApiRequest<{
    data: {
      year: number;
      link_state: string;
      committees: {
        registration_number: string;
        split: { state: string; reported_total: string | null };
      }[];
    };
  }>(`/legislators/${encodeURIComponent(legislatorId)}/campaign-finance?year=${year}`, signal);
  if (data.year !== year) throw new MoneyDetailsReadError('wrong_year');
  return {
    year,
    linkState: data.link_state,
    committees: Object.fromEntries(
      data.committees.map((committee) => [
        committee.registration_number,
        { splitState: committee.split.state, reportedTotal: committee.split.reported_total },
      ]),
    ),
  };
}
