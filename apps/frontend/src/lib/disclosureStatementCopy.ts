import { formatDay } from './moneyFormat';

/**
 * The words a disclosure statement prints inside the payment it names (#2347).
 *
 * An unregistered association giving to an independent-expenditure committee or fund
 * files a statement naming where the money for that gift came from. Each sentence here
 * speaks for this one contribution only: none implies a source controls the committee, caused
 * its spending, or gave any other gift, and no statement amount is ever added to
 * anything. A gift with no statement prints nothing new at all.
 */

export type StatementState = 'read' | 'gift_identified';

export interface AttachedStatement {
  id: string;
  state: StatementState;
  pdfUrl: string;
}

export interface StatementSource {
  name: string;
  city: string | null;
  state: string | null;
  amount: string | null;
}

export interface StatementDetail {
  id: string;
  state: StatementState;
  donorName: string;
  recipientName: string | null;
  giftDate: string;
  giftAmount: string;
  pdfUrl: string;
  box: 1 | 2 | 3 | null;
  sources: StatementSource[];
  lineA: string | null;
  lineB: string | null;
  lineC: string | null;
  signedOn: string | null;
  receivedOn: string | null;
}

const text = (value: unknown): string | null => (typeof value === 'string' ? value : null);
const amount = (value: unknown): string | null =>
  typeof value === 'string' ? value : typeof value === 'number' ? String(value) : null;

export function statementDetailFromPayload(data: unknown): StatementDetail | null {
  if (!data || typeof data !== 'object') return null;
  const row = data as Record<string, unknown>;
  const state = text(row.state);
  const id = text(row.id);
  const pdfUrl = text(row.pdf_url);
  if (!id || !pdfUrl || (state !== 'read' && state !== 'gift_identified')) return null;
  const box = row.box === 1 || row.box === 2 || row.box === 3 ? row.box : null;
  return {
    id,
    state,
    donorName: text(row.donor_name) ?? '',
    recipientName: text(row.recipient_name),
    giftDate: text(row.gift_date) ?? '',
    giftAmount: amount(row.gift_amount) ?? '',
    pdfUrl,
    box,
    sources: (Array.isArray(row.sources) ? row.sources : []).flatMap((raw) => {
      const source = raw as Record<string, unknown>;
      const name = text(source.name);
      return name
        ? [
            {
              name,
              city: text(source.city),
              state: text(source.state),
              amount: amount(source.amount),
            },
          ]
        : [];
    }),
    lineA: amount(row.line_a),
    lineB: amount(row.line_b),
    lineC: amount(row.line_c),
    signedOn: text(row.signed_on),
    receivedOn: text(row.received_on),
  };
}

export const STATEMENT_LABEL = 'DISCLOSURE STATEMENT';
export const STATEMENT_GROUP_NAME = 'Disclosure statement';

/** S1, after "{n} payment records" on a collapsed row holding at least 1 statement. */
export function statementCountFragment(withStatement: number, payments: number): string | null {
  if (withStatement <= 0) return null;
  if (payments === 1) return 'with a disclosure statement';
  if (withStatement === payments) return `all ${payments} with a disclosure statement`;
  return `${withStatement} with a disclosure statement`;
}

/** S2, S3 and S4: what the ticked box says, about this contribution only. S2 and S3 are
 *  Design's supplied sentences. */
export const STATEMENT_BOX_SENTENCE: Record<1 | 2 | 3, string> = {
  3: 'This statement names the sources below for this contribution',
  1: 'The donor reports using only business revenue for this contribution',
  2: 'The donor reports giving $5,000 or less in total to Minnesota independent-expenditure committees and funds this year, so this statement lists no sources',
};

/** S5. Held, and its details not read yet. */
export const STATEMENT_NOT_READ = 'We have this statement, but have not yet read its details';

/** S6. The visible text comes first in the spoken name, which adds the donor and the
 *  contribution date where a reading holds them. Still offered when the detail fails. */
export const STATEMENT_PDF_LABEL = 'View statement PDF';
export function statementPdfAccessibleName(donor: string | null, giftDate: string | null): string {
  const parts = [STATEMENT_PDF_LABEL, donor, formatDay(giftDate)].filter(Boolean);
  return parts.join(', ');
}

/** S7. */
export const STATEMENT_LOADING = 'Loading statement details…';

/** S8, when nothing has loaded yet. */
export const STATEMENT_FAILED =
  'We couldn’t load this statement’s details. You can still open its PDF.';

/** R1, when a refresh fails and the details loaded earlier stay on screen. */
export const STATEMENT_REFRESH_FAILED =
  'We couldn’t refresh this statement’s details. The details below were loaded earlier.';

export const STATEMENT_SCHEDULE = 'Schedule A1';
export const STATEMENT_COLUMNS = ['Name', 'City, state', 'Amount'] as const;
export const STATEMENT_LINE_LABELS = {
  a: 'Line A · Total of itemized sources',
  b: 'Line B · Amount from sources not required to be itemized',
  c: 'Line C · Amount from business revenue',
} as const;
export const STATEMENT_NOT_REPORTED = 'Not reported';

/** "Signed: Sep 20, 2026 · Received by the Board: Sep 21, 2026", each half only where the
 *  form states it. */
export function statementDatesLine(signedOn: string | null, receivedOn: string | null): string {
  return [
    signedOn ? `Signed: ${formatDay(signedOn)}` : null,
    receivedOn ? `Received by the Board: ${formatDay(receivedOn)}` : null,
  ]
    .filter(Boolean)
    .join(' · ');
}

/** A source's place: city and state, never a ZIP. */
export function sourcePlace(source: StatementSource): string {
  return [source.city, source.state].filter(Boolean).join(', ');
}

/** The catalogue copy date line reused under block 11 whenever the tab shows a statement. */
export function catalogueCopiedLine(copiedOn: string | null): string | null {
  const day = formatDay(copiedOn);
  return day ? `Minnesota’s report catalogue copied ${day}` : null;
}

// --- Statements not linked to a payment ------------------------------------------

export type ListedStatementState = StatementState | 'not_read';

export interface ListedStatement {
  id: string;
  state: ListedStatementState;
  reportName: string | null;
  reportPeriod: string;
  statementNumber: number;
  donorName: string | null;
  recipientName: string | null;
  giftDate: string | null;
  giftAmount: string | null;
  pdfUrl: string;
}

export interface UnlinkedStatements {
  registrationNumber: string;
  year: number;
  statements: ListedStatement[];
  copiedOn: string | null;
}

export function unlinkedStatementsFromPayload(data: unknown): UnlinkedStatements | null {
  if (!data || typeof data !== 'object') return null;
  const payload = data as Record<string, unknown>;
  if (payload.state !== 'listed' || !Array.isArray(payload.statements)) return null;
  return {
    registrationNumber: text(payload.registration_number) ?? '',
    year: typeof payload.year === 'number' ? payload.year : 0,
    statements: payload.statements.flatMap((raw) => {
      const row = raw as Record<string, unknown>;
      const id = text(row.id);
      const pdfUrl = text(row.pdf_url);
      const state = text(row.state);
      if (
        !id ||
        !pdfUrl ||
        (state !== 'read' && state !== 'gift_identified' && state !== 'not_read')
      ) {
        return [];
      }
      return [
        {
          id,
          state,
          reportName: text(row.report_name),
          reportPeriod: text(row.report_period) ?? '',
          statementNumber: typeof row.statement_number === 'number' ? row.statement_number : 0,
          donorName: text(row.donor_name),
          recipientName: text(row.recipient_name),
          giftDate: text(row.gift_date),
          giftAmount: amount(row.gift_amount),
          pdfUrl,
        },
      ];
    }),
    copiedOn: text(payload.copied_on),
  };
}

/** U1 and U2, Design's supplied heading and sentence (R2 refused: a missing match does
 *  not establish that our records cannot show the payment). */
export const UNLINKED_HEADING = 'Statements not linked to a payment';
export const UNLINKED_LEAD =
  'We have these statements, but have not linked them to individual payments in our copied records';
export const UNLINKED_LOADING = 'Loading these statements…';
/** When a refresh fails and the list loaded earlier stays on screen. */
export const UNLINKED_REFRESH_FAILED =
  'We couldn’t refresh these statements. The statements below were loaded earlier.';
export const UNLINKED_FAILED =
  'We couldn’t load these statements. This is a problem on our side and says nothing about the committee.';
export const UNLINKED_FIELD_LABELS = {
  donor: 'Donor',
  recipient: 'Recipient',
  date: 'Contribution date',
  amount: 'Contribution amount',
} as const;
/** A field a statement has but nobody has read yet. Never a guessed value, never $0. */
export const STATEMENT_NOT_YET_READ = 'Not yet read';
