import type { RootStackParamList } from '../navigation/types';
import type { OutsideSpendingRecordPage } from './outsideSpending';

export type OutsideSpendingBrowseMode = 'groups' | 'committees';
export type OutsideSpendingBrowseAddress = NonNullable<RootStackParamList['OutsideSpending']>;
export interface OutsideSpendingNamesPage {
  state: 'reported' | 'not_reported' | 'unavailable';
  browse: OutsideSpendingBrowseMode;
  year: number | null;
  query: string;
  names: { name: string; registration_number: string | null; in_register: boolean }[];
  years: number[];
  page: { number: number; size: number; total_names: number | null; has_more: boolean };
  snapshot_id: string;
  release_id: string;
  fetched_at: string | null;
  source_url: string | null;
}

export const OUTSIDE_BROWSE_INTRO =
  'Groups report spending to support or oppose a candidate independently of the candidate’s campaign. These records show what the groups spent, not money the campaign received.';
export const OUTSIDE_BROWSE_SCOPE =
  'These figures cover the whole period, whatever name you search for';
export const COMMITTEE_DEFINITION =
  'A campaign committee is the organization that handles a candidate’s campaign money';
export const NAME_WITHOUT_RECORD = 'We cannot open a separate spending record for this name';
export const HOW_TO_READ_OUTSIDE =
  'Choose a group to see which committees its spending supported or opposed. Choose a committee to see which groups spent supporting or opposing it. Each payment shows its amount, date, purpose, and who was paid, when those details appear in the filing.';
export const OUTSIDE_LIMITS =
  'These records cover filings held by the Minnesota Campaign Finance and Public Disclosure Board from 2015 onward. They do not include spending reported only to other agencies. We cannot tell whether each group has finished reporting for a year.';
export const OUTSIDE_OUTCOMES =
  'The filings show spending, not whether it changed a vote, a position, or an election result. No matching record does not mean nothing was spent.';
export const OUTSIDE_DOWNLOADS =
  'https://cfb.mn.gov/reports-and-data/self-help/data-downloads/campaign-finance/';

export function outsideBrowseMode(value?: string): OutsideSpendingBrowseMode {
  return value === 'committees' ? 'committees' : 'groups';
}

/** A filter change starts a new list. Explicit undefined clears merged route params. */
export function outsideBrowseChange(
  current: OutsideSpendingBrowseAddress,
  change: Partial<OutsideSpendingBrowseAddress>,
): OutsideSpendingBrowseAddress {
  return {
    browse: outsideBrowseMode(current.browse),
    year: current.year,
    q: current.q,
    page: undefined,
    ...change,
    spender: undefined,
    about: undefined,
    sort: undefined,
  };
}

export function outsideBrowsePeriod(page: OutsideSpendingRecordPage): string {
  if (page.year !== null) return String(page.year);
  const first = page.figures?.firstYear;
  const last = page.figures?.lastYear;
  if (first == null || last == null) return 'All years';
  return first === last ? String(first) : `${first} through ${last}`;
}

/** Only a local browse address can be used as a remembered return destination. */
export function outsideBrowseReturn(address: OutsideSpendingBrowseAddress): string {
  const fallback = new URLSearchParams({ browse: address.about ? 'committees' : 'groups' });
  if (address.year) fallback.set('year', address.year);
  if (address.returnTo) {
    try {
      const url = new URL(address.returnTo, 'https://www.alethical.com');
      if (
        url.origin === 'https://www.alethical.com' &&
        url.pathname === '/money/outside-spending' &&
        !url.searchParams.has('spender') &&
        !url.searchParams.has('about')
      ) {
        return `${url.pathname}${url.search}`;
      }
    } catch {
      /* Malformed navigation state uses the same safe fallback as a shared link. */
    }
  }
  return `/money/outside-spending?${fallback}`;
}
