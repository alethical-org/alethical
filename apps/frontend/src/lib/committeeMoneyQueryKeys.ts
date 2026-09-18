/**
 * The committee pages' read keys and request sizes, apart from their wording.
 *
 * `hooks/useAppQueries.ts` is in the program every page downloads before anything
 * draws, and it needs only these 4 names from the committee pages. Importing them
 * from `lib/committeeMoneyShared.ts` dragged every shared committee sentence and
 * every money formatter into that first download. This module imports nothing.
 * `lib/committeeMoneyShared.ts` re-exports every name here, so screens and
 * `api/page.ts` import them from where they always did.
 */

/**
 * The keys the committee pages' reads are stored under, written once so the page
 * function can hand a record on under the very key the app then asks for
 * (`lib/pageData.ts`, issue 2024). A key spelled out twice is a key that drifts,
 * and a drifted key does not fail: the app quietly fetches again and the second
 * wait comes back unnoticed.
 */
export function committeeMoneyQueryKey(
  registrationNumber: string | null,
  year: number,
): readonly unknown[] {
  return ['committee-money', registrationNumber, year];
}

/** The full payments view's accumulating list, in one direction. */
export function committeePaymentsListQueryKey(options: {
  registrationNumber: string | null;
  direction: 'received' | 'made';
  year: number;
}): readonly unknown[] {
  const { registrationNumber, direction, year } = options;
  return ['committee-payments-list', registrationNumber, direction, year];
}

/** The first page of a payments list, and the most one later page may hold. */
export const FIRST_PAYMENTS_LIMIT = 50;
export const PAGE_CAP = 250;
