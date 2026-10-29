import { formatDay, formatMoney } from '@alethical/shared/moneyFormat';
import {
  sourcePlace,
  STATEMENT_BOX_SENTENCE,
  STATEMENT_COLUMNS,
  STATEMENT_FAILED,
  STATEMENT_GROUP_NAME,
  STATEMENT_LABEL,
  STATEMENT_LINE_LABELS,
  STATEMENT_LOADING,
  STATEMENT_NOT_READ,
  STATEMENT_NOT_REPORTED,
  STATEMENT_NOT_YET_READ,
  STATEMENT_PDF_LABEL,
  STATEMENT_REFRESH_FAILED,
  STATEMENT_SCHEDULE,
  statementDatesLine,
  statementDetailFromPayload,
  statementPdfAccessibleName,
  UNLINKED_FIELD_LABELS,
} from '@alethical/shared/disclosureStatementCopy';

import { useRead } from '../../api/read';
import { WithArrow } from '../../ui/parts';

export interface StatementFields {
  donor: string | null;
  recipient: string | null;
  date: string | null;
  amount: string | null;
}

/**
 * One disclosure statement (Disclosure Statement Panel drawing): what the ticked box
 * says, Schedule A1 when the box names sources, Lines A to C, the dates and the PDF.
 * The reading is fetched only when the statement has one; a statement nobody has
 * read says so, and a missing line reads "Not reported", never $0.
 */
export function StatementPanel({
  id,
  readable,
  pdfUrl,
  level,
  fields,
  pdfDonor,
  pdfDate,
}: {
  id: string;
  /** False for a statement listed but not read: there is no reading to fetch. */
  readable: boolean;
  pdfUrl: string;
  level: 3 | 4;
  /** Shown on statements not linked to a payment, which carry their own gift. */
  fields?: StatementFields;
  pdfDonor: string | null;
  pdfDate: string | null;
}) {
  const read = useRead<unknown>(
    readable ? `campaign-finance/disclosure-statements/${encodeURIComponent(id)}` : null,
    { keepPrevious: true },
  );
  const detail = read.data ? statementDetailFromPayload(read.data) : null;
  const unreadable = read.data !== null && detail === null;
  const status: 'ready' | 'loading' | 'failed' | 'refresh' = !readable
    ? 'ready'
    : read.loading
      ? 'loading'
      : read.failed || unreadable
        ? detail
          ? 'refresh'
          : 'failed'
        : 'ready';
  const ready = status === 'ready' || status === 'refresh';
  const box = detail?.box ?? null;
  const dates = detail ? statementDatesLine(detail.signedOn, detail.receivedOn) : '';
  const field = (value: string | null) => value ?? STATEMENT_NOT_YET_READ;
  const shownFields = fields && {
    donor: fields.donor ?? detail?.donorName ?? null,
    recipient: fields.recipient ?? detail?.recipientName ?? null,
    date: formatDay(fields.date ?? detail?.giftDate ?? null),
    amount: formatMoney(fields.amount ?? detail?.giftAmount ?? null),
  };
  const lines: Array<[string, string | null]> = detail
    ? [
        [STATEMENT_LINE_LABELS.a, detail.lineA],
        [STATEMENT_LINE_LABELS.b, detail.lineB],
        [STATEMENT_LINE_LABELS.c, detail.lineC],
      ]
    : [];
  return (
    <div role="group" aria-label={STATEMENT_GROUP_NAME} className="cmt-stmt">
      <span className="cmt-mono-label">{STATEMENT_LABEL}</span>
      {status === 'loading' && (
        <div role="status" aria-busy="true" className="cmt-stmt-loading">
          <span className="cmt-stmt-bar cmt-stmt-bar-long" />
          <span className="cmt-stmt-bar cmt-stmt-bar-short" />
          <span>{STATEMENT_LOADING}</span>
        </div>
      )}
      {(status === 'failed' || status === 'refresh') && (
        <div role="alert" className="cmt-stmt-alert">
          <span>{status === 'failed' ? STATEMENT_FAILED : STATEMENT_REFRESH_FAILED}</span>
          <button
            type="button"
            className="f-btn f-btn-secondary f-btn-small cmt-start"
            aria-disabled={read.pending || undefined}
            onClick={() => !read.pending && read.retry()}
          >
            Try again
          </button>
        </div>
      )}
      {shownFields && status !== 'loading' && (
        <dl className="cmt-stmt-fields">
          {(
            [
              [UNLINKED_FIELD_LABELS.donor, shownFields.donor],
              [UNLINKED_FIELD_LABELS.recipient, shownFields.recipient],
              [UNLINKED_FIELD_LABELS.date, shownFields.date],
              [UNLINKED_FIELD_LABELS.amount, shownFields.amount],
            ] as const
          ).map(([label, value]) => (
            <div key={label} className="cmt-contents">
              <dt>{label}</dt>
              <dd data-missing={value === null || undefined}>{field(value)}</dd>
            </div>
          ))}
        </dl>
      )}
      {ready && (
        <p className="cmt-stmt-sentence">
          {box ? STATEMENT_BOX_SENTENCE[box] : STATEMENT_NOT_READ}
        </p>
      )}
      {ready && box === 3 && detail && (
        <div className="cmt-stmt-schedule">
          <div role="heading" aria-level={level} className="cmt-stmt-schedule-title">
            {STATEMENT_SCHEDULE}
          </div>
          <div role="table" aria-label={STATEMENT_SCHEDULE} className="cmt-stmt-table">
            <div role="row" className="cmt-stmt-row cmt-stmt-head">
              <span role="columnheader">{STATEMENT_COLUMNS[0]}</span>
              <span role="columnheader">{STATEMENT_COLUMNS[1]}</span>
              <span role="columnheader" className="cmt-right">
                {STATEMENT_COLUMNS[2]}
              </span>
            </div>
            {detail.sources.map((source, index) => {
              const amount = formatMoney(source.amount);
              return (
                <div key={`${source.name}-${index}`} role="row" className="cmt-stmt-row">
                  <span role="cell" className="cmt-wrap">
                    {source.name}
                  </span>
                  <span role="cell" className="cmt-secondary">
                    {sourcePlace(source)}
                  </span>
                  <span
                    role="cell"
                    className="cmt-right cmt-figure"
                    data-missing={!amount || undefined}
                  >
                    {amount ?? STATEMENT_NOT_REPORTED}
                  </span>
                </div>
              );
            })}
          </div>
          <dl className="cmt-stmt-lines">
            {lines.map(([label, value]) => {
              const amount = formatMoney(value);
              return (
                <div key={label} className="cmt-contents">
                  <dt>{label}</dt>
                  <dd className="cmt-figure" data-missing={!amount || undefined}>
                    {amount ?? STATEMENT_NOT_REPORTED}
                  </dd>
                </div>
              );
            })}
          </dl>
        </div>
      )}
      {ready && box !== null && dates && <p className="cmt-stmt-dates">{dates}</p>}
      {status !== 'loading' && (
        <a
          href={pdfUrl}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={statementPdfAccessibleName(
            detail?.donorName ?? pdfDonor,
            detail?.giftDate ?? pdfDate,
          )}
          className="f-dest cmt-link-44"
        >
          <span>
            <WithArrow>{STATEMENT_PDF_LABEL}</WithArrow>
          </span>
        </a>
      )}
    </div>
  );
}
