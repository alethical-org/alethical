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
  const payments: MoneyDetailsPayment[] = [];
  const linkable = new Set<string>();
  let releaseId: string | null = null;
  let expectedCount: number | null = null;
  let sourceUrl: string | null = null;
  let fetchedAt: string | null = null;
  while (true) {
    signal?.throwIfAborted();
    const offset = payments.length;
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
    if (releaseId !== null && releaseId !== data.release_id) {
      throw new MoneyDetailsReadError('release_changed');
    }
    if (data.registration_number && data.registration_number !== registrationNumber) {
      throw new MoneyDetailsReadError('wrong_committee');
    }
    if (data.year !== undefined && data.year !== year)
      throw new MoneyDetailsReadError('wrong_year');
    if (data.direction !== undefined && data.direction !== direction) {
      throw new MoneyDetailsReadError('wrong_direction');
    }
    releaseId = data.release_id;
    sourceUrl ??= data.source_url ?? null;
    fetchedAt ??= data.fetched_at ?? null;
    if (data.state !== 'reported') {
      if (offset !== 0 || (data.payments?.length ?? 0) > 0 || data.page?.has_more) {
        throw new MoneyDetailsReadError('state_changed');
      }
      return {
        registrationNumber,
        year,
        direction,
        state: data.state === 'not_reported' ? 'not_reported' : 'unavailable',
        payments: [],
        releaseId,
        linkableRegistrationNumbers: [],
        sourceUrl,
        fetchedAt,
        totalPayments: null,
      };
    }
    const page = data.page;
    if (
      !page ||
      page.offset !== offset ||
      !Number.isSafeInteger(page.total_payments) ||
      page.total_payments! < 0
    ) {
      throw new MoneyDetailsReadError('invalid_page_count');
    }
    if (expectedCount !== null && expectedCount !== page.total_payments) {
      throw new MoneyDetailsReadError('count_changed');
    }
    expectedCount = page.total_payments!;
    const rows = data.payments;
    if (!Array.isArray(rows) || rows.length > 250 || (page.has_more && rows.length === 0)) {
      throw new MoneyDetailsReadError('invalid_page');
    }
    payments.push(
      ...rows.map((row) => (direction === 'received' ? receivedRow(row) : madeRow(row))),
    );
    for (const number of data.linkable_registration_numbers ?? []) linkable.add(number);
    if (payments.length > expectedCount || (page.has_more && payments.length >= expectedCount)) {
      throw new MoneyDetailsReadError('count_mismatch');
    }
    if (!page.has_more) {
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
  }
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
