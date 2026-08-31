/**
 * Public directory page sizes. The app and the first server response both read
 * these values so a crawler never receives a different set of records from the
 * page a person sees after React starts.
 */
export const BILL_DIRECTORY_PAGE_SIZE = 10;
export const LEGISLATOR_DIRECTORY_PAGE_SIZE = 12;
export const LEGISLATOR_ROSTER_LIMIT = 250;
export const BILL_DIRECTORY_HEADING = 'Search bills';
export const LEGISLATOR_DIRECTORY_HEADING = 'Search legislators';

/** Invalid page text falls back to page 1, matching the screens. */
export function directoryPageNumber(value: string | null | undefined): number {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isSafeInteger(parsed) ? Math.max(1, parsed) : 1;
}

/** The 3 public directories that page by a numbered address. */
export type DirectoryBasePath = '/bills' | '/legislators' | '/money/committees';

export function directoryPagePath(basePath: DirectoryBasePath, page: number): string {
  return page > 1 ? `${basePath}?page=${page}` : basePath;
}

export function directoryTotalPages(total: number, pageSize: number): number {
  return Math.max(1, Math.ceil(total / pageSize));
}

export function compareLegislatorNames(
  left: { full_name?: string | null; name?: string | null },
  right: { full_name?: string | null; name?: string | null },
): number {
  return (left.full_name ?? left.name ?? '').localeCompare(
    right.full_name ?? right.name ?? '',
    'en',
  );
}

export function directoryPageIsOutOfRange(page: number, total: number, pageSize: number): boolean {
  return page > directoryTotalPages(total, pageSize);
}

/** Only a finished, unfiltered directory may turn a numbered URL into 404. */
export function loadedDirectoryPageIsOutOfRange({
  isSuccess,
  isDefaultDirectory,
  page,
  total,
  pageSize,
}: {
  isSuccess: boolean;
  isDefaultDirectory: boolean;
  page: number;
  total: number | null | undefined;
  pageSize: number;
}): boolean {
  return (
    isSuccess &&
    isDefaultDirectory &&
    total != null &&
    directoryPageIsOutOfRange(page, total, pageSize)
  );
}

/**
 * Explicit resting controls are still the plain Bills directory. Links copied
 * from the app may carry them, so they must not lose the same crawlable page and
 * self-canonical address merely because the defaults were written out.
 */
export function isDefaultBillDirectoryParams(params: Record<string, unknown>): boolean {
  return Object.entries(params).every(([key, value]) => {
    if (key === 'page') return true;
    if (key === 'scope') return value === 'legislature';
    if (key === 'sort') return value === 'progress';
    return value == null || value === '';
  });
}

/**
 * Page jumps in powers of 10 keep a directory with 1,000 pages within a few
 * dozen normal links, without printing 1,000 page numbers on every response.
 * Previous/Next already cover neighbours, so those are omitted here.
 */
export function directoryJumpPages(page: number, totalPages: number): number[] {
  const pages = new Set<number>();
  const add = (candidate: number) => {
    if (
      candidate >= 1 &&
      candidate <= totalPages &&
      candidate !== page &&
      Math.abs(candidate - page) > 1
    ) {
      pages.add(candidate);
    }
  };

  add(1);
  for (const distance of [10, 100, 1000]) {
    add(page - distance);
    add(page + distance);
  }
  add(totalPages);

  return [...pages].sort((left, right) => left - right);
}
