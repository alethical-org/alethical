export type BillSearchSortKey = 'best' | 'progress' | 'action' | 'introduced';

export const BILL_SEARCH_SORT_TO_API: Record<
  BillSearchSortKey,
  'relevance' | 'progress' | 'latest_action' | 'introduced'
> = {
  best: 'relevance',
  progress: 'progress',
  action: 'latest_action',
  introduced: 'introduced',
};

export const BILL_SEARCH_SORT_OPTIONS = [
  { key: 'progress', label: 'Legislative progress' },
  { key: 'action', label: 'Latest action' },
  { key: 'introduced', label: 'Introduction date' },
] as const;

export function resolveBillSearchSort(value: unknown, hasQuery: boolean): BillSearchSortKey {
  if (value === 'best') return hasQuery ? 'best' : 'progress';
  if (value === 'progress' || value === 'action' || value === 'introduced') return value;
  return hasQuery ? 'best' : 'progress';
}
