export const LEGISLATOR_SEARCH_LABEL = 'Search by name';
export const CLEAR_SEARCH_TARGET_SIZE = 44;
export const LEGISLATOR_PAGE_SIZE = 12;

type ChamberFilter = 'All' | 'House' | 'Senate';
type PartyFilter = 'All' | 'DFL' | 'R' | 'I';

type EmptyStateInput = {
  query: string;
  chamber: ChamberFilter;
  party: PartyFilter;
  hasSessionData: boolean;
};

type EmptyState = {
  heading: string;
  body: string;
  action: 'Clear search' | 'Clear filters' | 'Clear all';
};

export function deriveLegislatorEmptyState({
  query,
  chamber,
  party,
  hasSessionData,
}: EmptyStateInput): EmptyState | null {
  if (!hasSessionData) return null;

  const trimmedQuery = query.trim();
  const hasQuery = trimmedQuery.length > 0;
  const hasFilters = chamber !== 'All' || party !== 'All';

  if (hasQuery && hasFilters) {
    return {
      heading: `No legislators match “${trimmedQuery}” with these filters`,
      body: 'Try a different name or remove a filter.',
      action: 'Clear all',
    };
  }
  if (hasQuery) {
    return {
      heading: `No legislators match “${trimmedQuery}”`,
      body: 'Try a different name.',
      action: 'Clear search',
    };
  }
  if (hasFilters) {
    return {
      heading: 'No legislators match these filters',
      body: 'Remove a filter or clear them all.',
      action: 'Clear filters',
    };
  }
  return null;
}

export function clearLegislatorSearchParams() {
  return { page: undefined, q: undefined };
}

export function clearLegislatorFilterParams() {
  return { page: undefined, chamber: undefined, party: undefined };
}

export function clearAllLegislatorSearchParams() {
  return { ...clearLegislatorSearchParams(), ...clearLegislatorFilterParams() };
}

export function paginateLegislatorResults<T>(items: readonly T[], requestedPage: number) {
  const total = items.length;
  const totalPages = Math.max(1, Math.ceil(total / LEGISLATOR_PAGE_SIZE));
  const page = Math.min(Math.max(1, requestedPage), totalPages);
  const start = (page - 1) * LEGISLATOR_PAGE_SIZE;

  return { total, totalPages, page, items: items.slice(start, start + LEGISLATOR_PAGE_SIZE) };
}

export function billAuthorshipLabel(count: number) {
  return count === 1
    ? '1 bill authored or co-authored across available sessions'
    : `${count} bills authored or co-authored across available sessions`;
}
