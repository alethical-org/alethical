import { LEGISLATOR_DIRECTORY_PAGE_SIZE } from './directoryPagination';

export const LEGISLATOR_SEARCH_LABEL = 'Search by name';
export const CLEAR_SEARCH_TARGET_SIZE = 44;
export const LEGISLATOR_PAGE_SIZE = LEGISLATOR_DIRECTORY_PAGE_SIZE;
// Portrait boxes use the 160:207 shape of the tallest source photo, and every
// surface scales the whole photo to fit inside rather than filling the box
// (#1334). Both the Minnesota House and Senate photo policies say their images
// "may not be digitally altered in any way, including cropping", and filling a
// box that is a different shape crops whatever overflows. Measured across 50
// portraits from both chambers, sources are always 160 wide but 197-207 tall,
// so no single box shape fits all of them and only fit-inside never crops.
export const LEGISLATOR_PORTRAIT_WIDTH = 64;
export const LEGISLATOR_PORTRAIT_HEIGHT = 83;
export const LEGISLATOR_PORTRAIT_LOOKAHEAD = 320;

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

export function filterLegislatorsByName<T extends { name: string }>(
  legislators: readonly T[],
  query: string,
) {
  const words = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return legislators;

  return legislators.filter((legislator) => {
    const name = legislator.name.toLocaleLowerCase();
    return words.every((word) => name.includes(word));
  });
}

export function paginateLegislatorResults<T>(items: readonly T[], requestedPage: number) {
  const total = items.length;
  const totalPages = Math.max(1, Math.ceil(total / LEGISLATOR_PAGE_SIZE));
  const page = Math.min(Math.max(1, requestedPage), totalPages);
  const start = (page - 1) * LEGISLATOR_PAGE_SIZE;

  return { total, totalPages, page, items: items.slice(start, start + LEGISLATOR_PAGE_SIZE) };
}

export function isLegislatorPortraitEager(cardIndex: number, isDesktop: boolean) {
  // The first results row is 2 cards on desktop and 1 card on phone. Keep that
  // row immediate; later cards get a small lookahead without making every
  // portrait compete with the page's first paint.
  return cardIndex < (isDesktop ? 2 : 1);
}

export function legislatorPortraitImageProps(eager: boolean) {
  return {
    'aria-hidden': true,
    alt: '',
    decoding: 'async' as const,
    fetchPriority: eager ? ('high' as const) : ('low' as const),
    height: LEGISLATOR_PORTRAIT_HEIGHT,
    loading: eager ? ('eager' as const) : ('lazy' as const),
    width: LEGISLATOR_PORTRAIT_WIDTH,
  };
}

export function legislatorPortraitFallbackProps() {
  return {
    'aria-hidden': true,
    accessibilityElementsHidden: true,
  } as const;
}

export function shouldShowLegislatorPortrait(
  photoUrl: string | null | undefined,
  photoFailed: boolean,
): photoUrl is string {
  return Boolean(photoUrl) && !photoFailed;
}

export function billAuthorshipLabel(count: number) {
  return count === 1
    ? '1 bill authored or co-authored across available sessions'
    : `${count} bills authored or co-authored across available sessions`;
}
