import { useEffect } from 'react';
import { Platform } from 'react-native';

import {
  askPageMetadata,
  billListPageMetadata,
  billPageMetadata,
  homePageMetadata,
  legislatorListPageMetadata,
  researchPageMetadata,
  notFoundPageMetadata,
  SITE_NAME,
  STATIC_PAGE_METADATA,
} from '../lib/share';
import { researchBySlug } from '../lib/research';

import { MainTabParamList, RootStackParamList } from './types';
import { pathForRoute } from './webRoutes';
import { directoryPageNumber } from '../lib/directoryPagination';

/**
 * Who owns the browser tab title, and why it is not React Navigation's default.
 *
 * `api/page.ts` now puts each address's real title into the first server response
 * (issue #1325). The old formatter then overwrote it a moment later with
 * `{screen name} | Alethical` — so a visitor, and a search engine that runs the
 * page, ended up recording `Legislator | Alethical` with no person's name in it.
 *
 * The titles here come from the same builders the server uses
 * (`apps/frontend/src/lib/share.ts`), so the tab, the first response and the share
 * preview cannot say three different things. Titles that need a loaded record
 * (a legislator's name) are handed in by the screen once it has one, and until
 * then whatever the server sent is left alone rather than replaced by a guess.
 */

type TitledRoute = {
  name: keyof RootStackParamList | keyof MainTabParamList;
  params?: Record<string, unknown>;
};

// Keyed by pathname, so the tab bar's own state changes and query-string edits
// (a filter, a bill tab) cannot downgrade a title a screen already resolved.
const titlesByPath = new Map<string, string>();

function pathnameOf(route: TitledRoute): string {
  return pathForRoute(route).split('?')[0];
}

/** The best title a route can give before any record has loaded. */
function titleWithoutRecord(route: TitledRoute): string | null {
  switch (route.name) {
    case 'Home':
      return homePageMetadata().title;
    case 'Bills':
      return billListPageMetadata(
        directoryPageNumber(route.params?.page ? String(route.params.page) : undefined),
      ).title;
    case 'Legislators':
      return legislatorListPageMetadata(
        directoryPageNumber(route.params?.page ? String(route.params.page) : undefined),
      ).title;
    case 'Ask':
      return askPageMetadata(route.params?.q ? String(route.params.q) : null).title;
    case 'BillDetail': {
      // The bill's number and year are both inside its id, so the tab is already
      // specific to the bill before a single byte of it has been fetched.
      const billId = route.params?.billId ? String(route.params.billId) : '';
      return billId ? billPageMetadata({ billId }).title : null;
    }
    case 'NotFound':
      return notFoundPageMetadata().title;
    case 'Guide':
    case 'Research': {
      const slug = route.params?.slug ? String(route.params.slug) : '';
      const piece = slug ? researchBySlug(slug) : undefined;
      // An unknown slug renders the NotFound screen, which titles itself.
      return piece ? researchPageMetadata(piece).title : null;
    }
    default:
      return STATIC_PAGE_METADATA[pathnameOf(route)]?.title ?? null;
  }
}

export function documentTitleForRoute(route: TitledRoute): string {
  const remembered = titlesByPath.get(pathnameOf(route));
  if (remembered) return remembered;

  const derived = titleWithoutRecord(route);
  if (derived) return derived;

  // Nothing better than what the server already put in the tab.
  return typeof document !== 'undefined' && document.title ? document.title : SITE_NAME;
}

function rememberPageTitle(pathname: string, title: string) {
  titlesByPath.set(pathname, title);
  if (typeof document === 'undefined' || typeof window === 'undefined') return;
  // Only the page actually on screen — a background fetch finishing for a page
  // the visitor has already left must not rename the tab they are looking at.
  if (window.location?.pathname === pathname) {
    document.title = title;
  }
}

/**
 * Hand the resolved title for one page to the tab. Safe to call with nulls while
 * the record is still loading, and a no-op off the web.
 */
export function useDocumentTitle(
  pathname: string | null | undefined,
  title: string | null | undefined,
) {
  useEffect(() => {
    if (Platform.OS !== 'web' || !pathname || !title) return;
    rememberPageTitle(pathname, title);
  }, [pathname, title]);
}
