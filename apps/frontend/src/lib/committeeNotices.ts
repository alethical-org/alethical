import { formatDay, formatMoney } from './moneyFormat';

/**
 * A committee's large-contribution notices, for its Campaign money tab (#2347).
 *
 * A notice is how a committee tells the Minnesota Campaign Finance Board, by the end of
 * the next business day, about money from one source received in the days before an
 * election (Minnesota Statutes 10A.20 subd. 5). The same money appears again as an
 * ordinary payment once the committee files its next report, so **no notice amount is
 * ever added to anything on the page**: this module formats amounts and never sums one.
 *
 * Every sentence the card prints is here, so the card and the text served before the
 * app loads (`pageSnapshot.ts`) print the same words. Imported by the committee screen
 * and by the served text only.
 */

export type NoticeStatus = 'matched' | 'not_yet_on_a_report' | 'no_exact_match';
export type NoticeThreshold =
  'more_than_1000' | 'more_than_2000' | 'more_than_400' | 'more_than_half_the_limit';
export type NoticesState = 'listed' | 'not_covered' | 'no_windows' | 'unavailable';
export type WindowOpenState = 'not_open' | 'open' | 'closed';

export interface NoticeMatchedPayment {
  contributor: string | null;
  contributorType: string | null;
  receivedOn: string | null;
  amount: string | null;
  recordNumber: number;
}

export interface CommitteeNotice {
  id: string;
  contributor: string;
  amount: string;
  contributionDate: string;
  receivedOn: string | null;
  employer: string | null;
  inKind: boolean;
  inKindDescription: string | null;
  loan: boolean;
  amended: boolean;
  earlierContributor: string | null;
  earlierContributionDate: string | null;
  earlierAmount: string | null;
  status: NoticeStatus;
  matchedPayment: NoticeMatchedPayment | null;
  pdfUrl: string;
}

export interface NoticeWindow {
  key: string;
  label: string;
  start: string;
  end: string;
  notices: CommitteeNotice[];
}

export interface CommitteeNotices {
  state: NoticesState;
  registrationNumber: string;
  year: number;
  threshold: NoticeThreshold | null;
  windows: NoticeWindow[];
  copiedOn: string | null;
  sourceUrl: string;
  anyAmended: boolean;
  /** The end of the latest report in our copy, which N5 prints; `null` when unknown. */
  reportCoveredThrough: string | null;
}

const text = (value: unknown): string | null => (typeof value === 'string' ? value : null);
const amountText = (value: unknown): string | null =>
  typeof value === 'string' ? value : typeof value === 'number' ? String(value) : null;

function noticeFrom(row: Record<string, unknown>): CommitteeNotice | null {
  const contributor = text(row.contributor);
  const amount = amountText(row.amount);
  const contributionDate = text(row.contribution_date);
  const pdfUrl = text(row.pdf_url);
  const status = text(row.status) as NoticeStatus | null;
  if (!contributor || !amount || !contributionDate || !pdfUrl || !status) return null;
  const matched = row.matched_payment as Record<string, unknown> | null | undefined;
  return {
    id: text(row.id) ?? `${contributor}-${contributionDate}-${amount}`,
    contributor,
    amount,
    contributionDate,
    receivedOn: text(row.received_on),
    employer: text(row.employer),
    inKind: row.in_kind === true,
    inKindDescription: text(row.in_kind_description),
    loan: row.loan === true,
    amended: row.amended === true,
    earlierContributor: text(row.earlier_contributor),
    earlierContributionDate: text(row.earlier_contribution_date),
    earlierAmount: amountText(row.earlier_amount),
    status,
    matchedPayment:
      matched && typeof matched.record_number === 'number'
        ? {
            contributor: text(matched.contributor),
            contributorType: text(matched.contributor_type),
            receivedOn: text(matched.received_on),
            amount: amountText(matched.amount),
            recordNumber: matched.record_number,
          }
        : null,
    pdfUrl,
  };
}

/** The served answer, read defensively: a notice missing a field it prints is dropped. */
export function committeeNoticesFromPayload(data: unknown): CommitteeNotices | null {
  if (!data || typeof data !== 'object') return null;
  const payload = data as Record<string, unknown>;
  const state = text(payload.state) as NoticesState | null;
  if (!state) return null;
  const windows = Array.isArray(payload.windows) ? payload.windows : [];
  return {
    state,
    registrationNumber: text(payload.registration_number) ?? '',
    year: typeof payload.year === 'number' ? payload.year : 0,
    threshold: text(payload.threshold) as NoticeThreshold | null,
    windows: windows.flatMap((raw) => {
      const window = raw as Record<string, unknown>;
      const key = text(window.key);
      const label = text(window.label);
      const start = text(window.start);
      const end = text(window.end);
      if (!key || !label || !start || !end) return [];
      const notices = Array.isArray(window.notices) ? window.notices : [];
      return [
        {
          key,
          label,
          start,
          end,
          notices: notices
            .map((row) => noticeFrom(row as Record<string, unknown>))
            .filter((row): row is CommitteeNotice => row !== null),
        },
      ];
    }),
    copiedOn: text(payload.copied_on),
    sourceUrl: text(payload.source_url) ?? NOTICE_LIST_URL,
    anyAmended: payload.any_amended === true,
    reportCoveredThrough: text(payload.report_covered_through),
  };
}

/** Only a listed answer with at least 1 window draws. Every other state is absent by
 *  scope, never an empty card. */
export function noticesCardDraws(notices: CommitteeNotices | null | undefined): boolean {
  return notices?.state === 'listed' && notices.windows.length > 0;
}

/** Today's date in Minnesota, as `YYYY-MM-DD`. Window chips read against the reader's
 *  today; the notices listed are as of the copy date the foot prints. */
export function minnesotaToday(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Chicago',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

export function windowOpenState(window: NoticeWindow, today: string): WindowOpenState {
  if (today < window.start) return 'not_open';
  if (today <= window.end) return 'open';
  return 'closed';
}

// --- The words --------------------------------------------------------------------

export const NOTICE_LIST_URL =
  'https://cfb.mn.gov/reports-and-data/viewers/campaign-finance/large-contribution-notices/';

export const NOTICES_HEADING = 'Large-contribution notices';

const THRESHOLD_WORDS: Record<NoticeThreshold, string> = {
  more_than_1000: 'more than $1,000',
  more_than_2000: 'more than $2,000',
  more_than_400: 'more than $400',
  more_than_half_the_limit: 'more than half of what one source may give it in the election cycle',
};

/** N1. The statute's own test: money from one source, added up, above the filer's
 *  threshold, received between the last report before an election and the election. */
export function noticesLead(threshold: NoticeThreshold | null): string {
  const amount = THRESHOLD_WORDS[threshold ?? 'more_than_1000'];
  return (
    'A committee must tell the Minnesota Campaign Finance Board by the end of the next ' +
    `business day when money from one source adding up to ${amount} arrives in the days ` +
    'just before an election. The same money appears again as an ordinary payment once the ' +
    'committee files its next report, so a notice is never a second gift. No notice amount ' +
    'is added to any total on this page.'
  );
}

/** N2a and N2b, the window chips. */
export const NOTICE_WINDOW_OPEN = 'Open now, so more may arrive';
export const NOTICE_WINDOW_NOT_OPEN = 'Not open yet';

/** N3. About the Board's list as we copied it, never about the committee's gifts. */
export const NOTICE_WINDOW_NONE =
  'The Board’s list held no notice from this committee for these dates when we last copied it';

/** N4, visible. Names the tab the matched payment sits under. */
export function noticeMatchedLabel(tabLabel: string): string {
  return `Also a payment in the list above, under ${tabLabel}`;
}

/** N4, accessible name: names the contributor and the date. */
export function noticeMatchedAccessibleName(notice: CommitteeNotice): string {
  return `Show the ${formatDay(notice.contributionDate)} payment from ${notice.contributor} in the list above`;
}

/** N5, Design's supplied sentence: dates our copy and says nothing about what the Board
 *  holds today. Printed only when that date is known and the gift is after it. */
export function noticeAfterLatestReport(coveredThrough: string | null): string | null {
  const day = formatDay(coveredThrough);
  return day ? `Our latest copied report covers dates through ${day}` : null;
}

/** N6, Design's supplied sentence, for every other notice with no confirmed payment. It
 *  names no cause. */
export const NOTICE_NOT_LINKED =
  'We have not linked this notice to a payment in our copied records';

/** N7. The visible text comes first in the spoken name, as on the statement PDF link. */
export const NOTICE_PDF_LABEL = 'View notice PDF';
export function noticePdfAccessibleName(notice: CommitteeNotice): string {
  return [NOTICE_PDF_LABEL, notice.contributor, formatDay(notice.contributionDate)].join(', ');
}

/** N8. */
export const NOTICES_LOADING = 'Loading the large-contribution notices…';

/** N9. */
export const NOTICES_FAILED =
  'We couldn’t load these notices. This is a problem on our side and says nothing about the ' +
  'committee.';

/** N10, split so the list's name can be the link. */
export const NOTICES_SOURCE_LABEL = 'Minnesota’s list of large-contribution notices';
export function noticesCopiedLine(copiedOn: string | null): string {
  const day = formatDay(copiedOn);
  return day ? `${NOTICES_SOURCE_LABEL} copied ${day}` : NOTICES_SOURCE_LABEL;
}

/** N11. The value as first filed, kept readable on an amended notice. */
export function noticeFirstFiledLine(notice: CommitteeNotice): string | null {
  const parts = [
    notice.earlierContributor,
    formatDay(notice.earlierContributionDate),
    formatMoney(notice.earlierAmount),
  ].filter((part): part is string => Boolean(part));
  return parts.length ? `As first filed: ${parts.join(' · ')}` : null;
}

export const NOTICE_AMENDED_NOTE = 'Amended means the committee filed a revised version';
export const NOTICE_RECEIVED_LABEL = 'Received by the Board:';
export const NOTICE_LOAN_CHIP = 'LOAN';

/** "Jul 21 – Aug 10, 2026", or both years when a window spans 2. */
export function noticeWindowDates(window: Pick<NoticeWindow, 'start' | 'end'>): string {
  const start = formatDay(window.start) ?? window.start;
  const end = formatDay(window.end) ?? window.end;
  const sameYear = window.start.slice(0, 4) === window.end.slice(0, 4);
  return `${sameYear ? start.replace(/, \d{4}$/, '') : start} – ${end}`;
}

/** The detail line under a notice's name, as plain text for the served copy. The card
 *  draws the same pieces, with the date bold and the chips as chips. */
export function noticeDetailParts(notice: CommitteeNotice, inKindMarker: string): string[] {
  return [
    formatDay(notice.contributionDate) ?? notice.contributionDate,
    ...(notice.receivedOn ? [`${NOTICE_RECEIVED_LABEL} ${formatDay(notice.receivedOn)}`] : []),
    ...(notice.employer ? [notice.employer] : []),
    ...(notice.inKind ? [[inKindMarker, notice.inKindDescription].filter(Boolean).join(' ')] : []),
    ...(notice.loan ? [NOTICE_LOAN_CHIP] : []),
  ];
}

/** The status line's words, by status. `tabLabel` is where the matched payment sits. */
export function noticeStatusText(
  notice: CommitteeNotice,
  tabLabel: string | null,
  coveredThrough: string | null,
): string {
  if (notice.status === 'matched') {
    return tabLabel ? noticeMatchedLabel(tabLabel) : 'Also a payment in the list above';
  }
  if (notice.status === 'not_yet_on_a_report') {
    return noticeAfterLatestReport(coveredThrough) ?? NOTICE_NOT_LINKED;
  }
  return NOTICE_NOT_LINKED;
}
