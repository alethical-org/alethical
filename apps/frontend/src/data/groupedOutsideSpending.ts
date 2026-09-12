import { publicApiRequest } from './api';
import { sumMoneyAmounts } from '../lib/campaignMoneyDetails';
import type { OutsideSpendingYear } from '../lib/outsideSpending';
import {
  combineOutsideSpenders,
  outsideSpenderFigures,
  outsideSpenderIdentity,
  outsideSpenderKey,
  paymentsForOutsideSpender,
  type OutsideDirection,
  type OutsideGroupPayment,
  type OutsideSpenderFigure,
  type OutsideSpenderGroup,
} from '../lib/groupedOutsideSpending';

interface GroupPayload {
  spender: string | null;
  spender_registration_number: string | null;
  spender_linkable: boolean;
  direction: OutsideDirection;
  amount: string | null;
  row_count: number;
  grouping_basis: 'registration_number' | 'exact_name';
}

interface PaymentPayload {
  spender: string | null;
  spender_registration_number: string | null;
  about_committee_registration_number: string | null;
  direction: OutsideDirection;
  amount: string | null;
  paid_on: string | null;
  purpose: string | null;
  vendor_name: string | null;
  record_number: number;
  year: number | null;
}

interface FiguresPayload {
  row_count: number;
  spender_count: number;
  supporting_count: number;
  supporting_amount: string | null;
  supporting_spender_count: number;
  opposing_count: number;
  opposing_amount: string | null;
  opposing_spender_count: number;
  direction_not_recorded_count: number;
  direction_not_recorded_amount: string | null;
  direction_not_recorded_spender_count: number;
}

interface OutsidePayload {
  state: string;
  about: { registration_number: string } | null;
  year: number | null;
  snapshot_id: string | null;
  release_id: string | null;
  group_by?: string;
  groups?: GroupPayload[];
  rows?: PaymentPayload[];
  figures: FiguresPayload | null;
  page?: { number: number; size: number; total_rows: number | null; has_more: boolean };
}

export interface GroupedOutsideSpending {
  year: number;
  snapshotId: string;
  releaseId: string;
  groups: OutsideSpenderGroup[];
  figures: OutsideSpenderFigure[];
  aboutPaymentCounts: Record<string, number>;
}

export class OutsideSpendingReadError extends Error {
  constructor(public readonly reason: string) {
    super(reason);
    this.name = 'OutsideSpendingReadError';
  }
}

function requireRead(condition: unknown, reason: string): asserts condition {
  if (!condition) throw new OutsideSpendingReadError(reason);
}

function isDirection(value: string): value is OutsideDirection {
  return value === 'For' || value === 'Against' || value === 'not recorded';
}

function isAmount(value: string | null): boolean {
  return value === null || (typeof value === 'string' && sumMoneyAmounts([value]) !== null);
}

function sameAmount(a: string | null, b: string | null): boolean {
  return a === null || b === null ? a === b : sumMoneyAmounts([a]) === sumMoneyAmounts([b]);
}

function checkScope(
  body: OutsidePayload,
  about: string,
  year: number,
  snapshotId: string,
  releaseId?: string,
) {
  requireRead(body.year === year && body.about?.registration_number === about, 'wrong_scope');
  // A download identity and the enclosing release identity are distinct identifiers.
  requireRead(body.snapshot_id === snapshotId, 'snapshot_changed');
  requireRead(typeof body.release_id === 'string' && body.release_id.length > 0, 'missing_release');
  if (releaseId) requireRead(body.release_id === releaseId, 'release_changed');
  requireRead(body.state === 'reported' || body.state === 'not_reported', 'unavailable');
}

function shapeGroup(row: GroupPayload, about: string): OutsideSpenderGroup {
  requireRead(isDirection(row.direction), 'invalid_direction');
  requireRead(isAmount(row.amount), 'invalid_amount');
  requireRead(Number.isSafeInteger(row.row_count) && row.row_count > 0, 'invalid_count');
  const registration = row.spender_registration_number;
  requireRead(
    registration === null || (typeof registration === 'string' && registration.length > 0),
    'invalid_registration',
  );
  requireRead(row.spender === null || typeof row.spender === 'string', 'invalid_name');
  requireRead(
    row.grouping_basis === (registration ? 'registration_number' : 'exact_name'),
    'invalid_basis',
  );
  const identity = outsideSpenderIdentity(registration, row.spender);
  return {
    key: outsideSpenderKey(identity, row.direction),
    identity,
    name: row.spender,
    registrationNumber: registration,
    linkable: registration !== null && row.spender_linkable === true,
    groupingBasis: row.grouping_basis,
    direction: row.direction,
    amount: row.amount,
    paymentCount: row.row_count,
    aboutRegistrationNumbers: [about],
  };
}

function checkGroupFigures(groups: OutsideSpenderGroup[], figures: FiguresPayload | null) {
  requireRead(figures !== null, 'missing_figures');
  const totals = outsideSpenderFigures(groups);
  const expected = [
    [figures.supporting_count, figures.supporting_amount, figures.supporting_spender_count],
    [figures.opposing_count, figures.opposing_amount, figures.opposing_spender_count],
    [
      figures.direction_not_recorded_count,
      figures.direction_not_recorded_amount,
      figures.direction_not_recorded_spender_count,
    ],
  ] as const;
  requireRead(
    groups.reduce((n, group) => n + group.paymentCount, 0) === figures.row_count,
    'incomplete_groups',
  );
  requireRead(
    new Set(groups.map((group) => group.identity)).size === figures.spender_count,
    'incomplete_groups',
  );
  totals.forEach((figure, index) => {
    const [count, amount, spenders] = expected[index];
    // The existing endpoint withholds all direction amounts when any amount is
    // missing. Preserve that refusal even if one direction's rows could be summed.
    requireRead(
      figure.paymentCount === count &&
        figure.spenderCount === spenders &&
        isAmount(amount) &&
        (amount === null || sameAmount(figure.amount, amount)),
      'incomplete_groups',
    );
  });
}

/** One complete grouped request per confirmed committee, before any detail request. */
export async function getGroupedOutsideSpending(
  year: OutsideSpendingYear,
  signal?: AbortSignal,
): Promise<GroupedOutsideSpending> {
  signal?.throwIfAborted();
  requireRead(year.state === 'reported' && year.snapshotId, 'unavailable');
  const snapshotId = year.snapshotId;
  const registrations = [
    ...new Set(year.committees.map((committee) => committee.registrationNumber)),
  ].sort();
  requireRead(registrations.length > 0, 'unconfirmed');
  const responses = await Promise.all(
    registrations.map(async (about) => {
      const params = new URLSearchParams({ about, year: String(year.year), group_by: 'spender' });
      const { data } = await publicApiRequest<{ data: OutsidePayload }>(
        `/campaign-finance/outside-spending?${params}`,
        signal,
      );
      signal?.throwIfAborted();
      checkScope(data, about, year.year, snapshotId);
      requireRead(data.group_by === 'spender' && Array.isArray(data.groups), 'invalid_groups');
      const groups = data.groups.map((row) => shapeGroup(row, about));
      requireRead(
        new Set(groups.map((group) => group.key)).size === groups.length,
        'duplicate_group',
      );
      if (data.state === 'not_reported') requireRead(groups.length === 0, 'invalid_empty_state');
      else checkGroupFigures(groups, data.figures);
      return { about, data, groups };
    }),
  );
  const releaseId = responses[0].data.release_id!;
  requireRead(
    responses.every(({ data }) => data.release_id === releaseId),
    'release_changed',
  );
  const groups = combineOutsideSpenders(responses.flatMap((response) => response.groups));
  const figures = outsideSpenderFigures(groups);
  figures.forEach((figure, index) => {
    figure.amount = sumMoneyAmounts(
      responses.map(({ data }) => {
        if (data.state === 'not_reported') return '0';
        return [
          data.figures!.supporting_amount,
          data.figures!.opposing_amount,
          data.figures!.direction_not_recorded_amount,
        ][index];
      }),
    );
  });
  const summaryCounts = [
    year.supportingPayments,
    year.opposingPayments,
    year.directionNotRecordedPayments,
  ];
  figures.forEach((figure, index) => {
    requireRead(summaryCounts[index] === figure.paymentCount, 'summary_changed');
  });
  return {
    year: year.year,
    snapshotId,
    releaseId,
    groups,
    figures,
    aboutPaymentCounts: Object.fromEntries(
      responses.map(({ about, groups }) => [
        about,
        groups.reduce((n, group) => n + group.paymentCount, 0),
      ]),
    ),
  };
}

async function getAllAboutPayments(
  grouped: GroupedOutsideSpending,
  about: string,
  expectedCount: number,
  signal?: AbortSignal,
): Promise<OutsideGroupPayment[]> {
  const payments: OutsideGroupPayment[] = [];
  let page = 1;
  while (payments.length < expectedCount) {
    signal?.throwIfAborted();
    const params = new URLSearchParams({
      about,
      year: String(grouped.year),
      page: String(page),
      sort: 'newest',
    });
    const { data } = await publicApiRequest<{ data: OutsidePayload }>(
      `/campaign-finance/outside-spending?${params}`,
      signal,
    );
    signal?.throwIfAborted();
    checkScope(data, about, grouped.year, grouped.snapshotId, grouped.releaseId);
    requireRead(
      data.state === 'reported' && Array.isArray(data.rows) && data.page,
      'incomplete_payments',
    );
    requireRead(
      data.page.number === page && data.page.size === 50 && data.page.total_rows === expectedCount,
      'invalid_page',
    );
    requireRead(data.rows.length > 0 && data.rows.length <= 50, 'invalid_page');
    for (const row of data.rows) {
      requireRead(
        row.about_committee_registration_number === about && row.year === grouped.year,
        'wrong_scope',
      );
      requireRead(
        isDirection(row.direction) &&
          isAmount(row.amount) &&
          Number.isSafeInteger(row.record_number),
        'invalid_payment',
      );
      payments.push({
        aboutRegistrationNumber: about,
        spender: row.spender,
        spenderRegistrationNumber: row.spender_registration_number,
        direction: row.direction,
        amount: row.amount,
        paidOn: row.paid_on,
        purpose: row.purpose,
        vendorName: row.vendor_name,
        recordNumber: row.record_number,
      });
    }
    requireRead(
      payments.length <= expectedCount && data.page.has_more === payments.length < expectedCount,
      'incomplete_payments',
    );
    page += 1;
  }
  // Source row numbers are unique within a saved file. Repeated dates and amounts
  // are valid gifts; a repeated source row means pages overlapped and must fail.
  requireRead(
    new Set(payments.map((payment) => payment.recordNumber)).size === payments.length,
    'overlapping_pages',
  );
  return payments;
}

/** Called on expansion; never return a partial list or calculate a headline from it. */
export async function getCompleteOutsideSpendingPayments(
  grouped: GroupedOutsideSpending,
  signal?: AbortSignal,
): Promise<OutsideGroupPayment[]> {
  signal?.throwIfAborted();
  const pages = await Promise.all(
    Object.entries(grouped.aboutPaymentCounts).map(([about, count]) =>
      getAllAboutPayments(grouped, about, count, signal),
    ),
  );
  const payments = pages.flat();
  const keys = new Set(grouped.groups.map((group) => group.key));
  requireRead(
    payments.every((payment) =>
      keys.has(
        outsideSpenderKey(
          outsideSpenderIdentity(payment.spenderRegistrationNumber, payment.spender),
          payment.direction,
        ),
      ),
    ),
    'unexpected_spender',
  );
  for (const group of grouped.groups) {
    const matches = paymentsForOutsideSpender(payments, group);
    requireRead(
      matches.length === group.paymentCount &&
        sameAmount(sumMoneyAmounts(matches.map((payment) => payment.amount)), group.amount),
      'incomplete_payments',
    );
  }
  return payments;
}
