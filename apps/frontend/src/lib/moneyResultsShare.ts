import type { MoneyByRacePage } from '../data/types';
import { routePath } from '../navigation/links';
import { committeeSlug, type PaymentsTab } from './committeeMoneyShared';
import { MONEY_BY_RACE_TITLE, contestSeatLabel } from './moneyByRace';
import { nameSearchHeading } from './moneyNameSearch';
import {
  OUTSIDE_SPENDING_HEADING,
  subjectName,
  type OutsideSpendingRecordPage,
  type OutsideSpendingView,
} from './outsideSpending';
import type { OutsideSpendingNamesPage } from './outsideSpendingBrowse';
import { paymentsUnderNameHeading, type PaymentNameRole } from './paymentNameRoute';
import { publicPageUrl, type ShareContent, type ShareResultsKind } from './share';

function results(
  resultsKind: ShareResultsKind,
  title: string,
  description: string,
  path: string,
): ShareContent {
  return { subject: 'results', resultsKind, title, description, url: publicPageUrl(path) };
}

export function moneySearchShareContent(query: string): ShareContent {
  return results(
    'search',
    nameSearchHeading(query),
    'Matching legislators, committees, payment names, lobbyists, and organizations that hire lobbyists',
    routePath.moneySearch({ q: query.trim() }),
  );
}

export function paymentsUnderNameShareContent(
  name: string,
  role: PaymentNameRole,
  query?: string,
): ShareContent {
  return results(
    'payments',
    paymentsUnderNameHeading(name, role),
    'Payment records filed under this exact spelling, across the years we hold, newest first; a matching name alone does not establish identity',
    routePath.moneyPaymentsUnderName(name, role, query),
  );
}

export function committeePaymentsShareContent({
  name,
  registrationNumber,
  year,
  tab,
}: {
  name: string | null;
  registrationNumber: string;
  year: number;
  tab: PaymentsTab;
}): ShareContent {
  return results(
    'payments',
    name || `Committee ${registrationNumber}`,
    `${tab === 'gave' ? 'Incoming payment records' : 'Spending records'} in filing year ${year}, largest first`,
    routePath.moneyCommitteePayments(committeeSlug(name, registrationNumber), {
      year: String(year),
      tab,
    }),
  );
}

export function moneyByRaceShareContent(
  page: MoneyByRacePage,
  anchor: string,
  query?: string,
): ShareContent {
  const contest = page.contests.find((candidate) => candidate.anchor === anchor);
  const office = page.office || 'All offices';
  const scope = contest ? contestSeatLabel(contest) : office;
  const path = routePath.moneyRaces({
    year: String(page.year),
    office: contest?.office || page.office || undefined,
    group: contest?.anchor,
    q: query || undefined,
  });
  return results(
    'race',
    MONEY_BY_RACE_TITLE,
    `${scope} · filing year ${page.year} · each committee’s figures shown separately`,
    path,
  );
}

function outsidePeriod(year: number | null): string {
  return year === null ? 'All years we hold' : `Filing year ${year}`;
}

/** Build from the accepted response, including when an older response remains visible. */
export function outsideSubjectShareContent(
  page: OutsideSpendingRecordPage,
  view: OutsideSpendingView,
): ShareContent | null {
  const subject = view === 'spender' ? page.spender : page.about;
  if (!subject || page.state === 'unavailable' || (view !== 'spender' && page.spender)) return null;
  const scope =
    view === 'spender'
      ? page.about
        ? `Outside spending supporting or opposing ${subjectName(page.about)}`
        : 'Outside spending reported by this group'
      : 'Outside spending supporting or opposing this committee';
  return results(
    'outside-spending',
    subjectName(subject),
    `${scope}, independent of the campaign · ${outsidePeriod(page.year)} · ${page.sort === 'largest' ? 'largest' : 'newest'} first`,
    routePath.moneyOutsideSpending({
      spender: page.spender?.registrationNumber,
      about: page.about?.registrationNumber,
      year: page.year === null ? undefined : String(page.year),
      sort: page.sort,
      page: page.pageNumber > 1 ? String(page.pageNumber) : undefined,
    }),
  );
}

export function outsideBrowseShareContent(page: OutsideSpendingNamesPage): ShareContent {
  const group = page.browse === 'groups' ? 'Groups that spent' : 'Committees supported or opposed';
  return results(
    'outside-spending',
    OUTSIDE_SPENDING_HEADING,
    `${group}${page.query ? ` matching “${page.query}”` : ''} · ${outsidePeriod(page.year)} · page ${page.page.number}`,
    routePath.moneyOutsideSpending({
      browse: page.browse,
      q: page.query || undefined,
      year: page.year === null ? undefined : String(page.year),
      page: page.page.number > 1 ? String(page.page.number) : undefined,
    }),
  );
}
