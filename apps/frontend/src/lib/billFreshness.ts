import { AskAnswer } from '../data/types';

const BILL_QUERY_ROOTS = new Set([
  'bill',
  'bill-votes',
  'bill-version-text',
  'bills',
  'featured-bills',
  'legislator-bills',
  'tracked-bills',
  'saved-ask-suggestion',
]);

/** Query keys whose result can display facts from a saved bill record. */
export function shouldRefreshBillQuery(queryKey: readonly unknown[]): boolean {
  const root = queryKey[0];
  return typeof root === 'string' && BILL_QUERY_ROOTS.has(root);
}

/** Every bill card embedded in one Ask response, once and in display order. */
export function askBillCardIds(answer?: AskAnswer): string[] {
  if (!answer) return [];

  const ids = [
    ...answer.bills.map((bill) => bill.id),
    ...answer.billCards.map((bill) => bill.id),
    ...answer.latestActionBillCards.map((bill) => bill.id),
    answer.resolvedBill?.id,
    answer.answeringBill?.id,
    answer.answeringBillCard?.id,
  ];

  return [...new Set(ids.filter((id): id is string => Boolean(id)))];
}

/** Prefer the current read-only bill record while keeping the original as fallback. */
export function currentAskBill<TOriginal extends { id: string }, TCurrent extends { id: string }>(
  original: TOriginal,
  currentById: ReadonlyMap<string, TCurrent>,
): TOriginal | (TOriginal & TCurrent) {
  const current = currentById.get(original.id);
  return current ? { ...original, ...current } : original;
}
