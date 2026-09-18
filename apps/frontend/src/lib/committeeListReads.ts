/**
 * The committee register read: how many rows one page holds, and the key a page is
 * stored under.
 *
 * `hooks/useAppQueries.ts` is in the program every page downloads before anything
 * draws, and it needs only these 2 names from the register. Importing them from
 * `lib/committeeList.ts` put every sentence the register prints, and the shared
 * committee wording behind it, into that first download. This module imports
 * nothing. `lib/committeeList.ts` re-exports both names, so the screen, its tests,
 * `api/page.ts` and `api/sitemap.ts` import them from where they always did.
 */

/**
 * How many rows one numbered page holds. 50 is half the register endpoint's own
 * maximum, so a page is always one request.
 *
 * The register was a "Show more" button until #1812. Google states it does not
 * press buttons or run actions that need a person's click, so every filer past
 * the first 50 was unreachable to it and 1,553 of 1,603 committee pages had no
 * ordinary link anywhere on the site
 * (`docs/architecture/page-metadata-for-search-and-sharing-decisions.md` §20.5
 * rule 2). Numbered pages with their own addresses are what fixed that, and they
 * are the same shape the bills and legislators directories already use.
 */
export const COMMITTEE_PAGE_SIZE = 50;

/**
 * The React Query key one page of the register answers. Built here rather than
 * written out in the hook so `api/page.ts` can label the payload it already read
 * with the very key the app will ask for (issue #1966). Two copies of a key are
 * two chances to drift, and a drifted key seeds nothing and improves nothing.
 */
export function committeeRegisterQueryKey(options: {
  kind?: string;
  query?: string;
  page: number;
  pageSize: number;
}): readonly unknown[] {
  return [
    'campaign-finance-committees',
    options.kind ?? 'all',
    options.query ?? '',
    options.page,
    options.pageSize,
  ];
}
