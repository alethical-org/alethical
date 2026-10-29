import {
  lobbyingPrincipalCopy as COPY,
  lobbyingRecordNotFound,
  LOBBYING_RECORD_LOADING,
  PRINCIPAL_SOURCE_URL,
  principalLobbyistsIntroduction,
  principalSpellingLines,
  spendingRowsHaveMissingAmounts,
} from '@alethical/shared/lobbyingRecordCopy';
import type {
  LobbyingPrincipal,
  LobbyingPrincipalLobbyist,
  LobbyingSpendingRow,
} from '@alethical/shared/lobbyingTypes';
import { formatMoney } from '@alethical/shared/moneyFormat';
import { centralDateLabel } from '@alethical/shared/moneyLanding';

import { apiPath, useRead } from '../api/read';
import { useLocation } from '../router';
import { returnTarget, withFrom } from '../returnContext';
import { hrefFor, isBuilt, type RouteMatch } from '../routes';
import { useBand } from '../ui/band';
import { Refused } from '../ui/controls';
import { BackLink, LoadingLine, SourcesAndUpdates } from '../ui/parts';
import {
  IdentityBox,
  OfficialLink,
  RecordRow,
  recordNumber,
  useConfirmedIdentity,
} from './lobbying/parts';
import './lobbying.css';

const FAILED =
  'We couldn’t load the Board’s lobbying record just now. This says nothing about what was reported.';
const SPENDING_FAILED =
  'We couldn’t load this principal’s spending rows. This says nothing about what was reported.';
const LOBBYISTS_FAILED =
  'We couldn’t load the Board’s lobbyist list. This does not mean nobody was listed for this principal.';
const NOT_REPORTED = 'Not reported';

/** The 6 figures of a spending row, in the drawing's column order. */
export const SPENDING_COLUMNS: ReadonlyArray<{
  key: keyof LobbyingSpendingRow;
  label: string;
  head: string;
}> = [
  { key: 'total_spent', label: 'Total', head: 'TOTAL' },
  { key: 'general_lobbying_amount', label: 'General', head: 'GENERAL' },
  { key: 'legislative_lobbying_amount', label: 'Legislative', head: 'LEGISLATIVE' },
  { key: 'administrative_lobbying_amount', label: 'Administrative', head: 'ADMINISTRATIVE' },
  { key: 'mgu_lobbying_amount', label: 'Metropolitan', head: 'METROPOLITAN' },
  { key: 'puc_lobbying_amount', label: 'PUC', head: 'PUC' },
];

/** A reported amount as the Board's file holds it: a filed zero is "$0", a blank
 * is "Not reported", never zero. */
export function spendingFigure(value: string | number | null | undefined): string {
  return formatMoney(value) ?? NOT_REPORTED;
}

/** One lobbyist per registration number, in the served order: the list may name a
 * registration once for each spelling of this principal. */
export function distinctLobbyists(
  rows: readonly LobbyingPrincipalLobbyist[],
): LobbyingPrincipalLobbyist[] {
  const seen = new Set<string>();
  return rows.filter((row) => {
    if (seen.has(row.registration_number)) return false;
    seen.add(row.registration_number);
    return true;
  });
}

function Figure({ value }: { value: string | null }) {
  const text = spendingFigure(value);
  return <span data-missing={value === null || undefined}>{text}</span>;
}

function Spending({ principal }: { principal: LobbyingPrincipal }) {
  const band = useBand();
  const rows = principal.spending.rows;
  return (
    <>
      <div className="lbp-spending">
        {band !== 'phone' ? (
          <div className="lbp-scroll">
            <table className="lbp-table f-num">
              <caption className="f-visually-hidden">{COPY.spendingCaption}</caption>
              <thead>
                <tr>
                  <th scope="col" className="lbp-year-col">
                    YEAR
                  </th>
                  {SPENDING_COLUMNS.map((column) => (
                    <th key={column.key} scope="col">
                      {column.head}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.record_number}>
                    <th scope="row" className="lbp-year-col">
                      {row.year ?? NOT_REPORTED}
                    </th>
                    {SPENDING_COLUMNS.map((column, index) => (
                      <td key={column.key} className={index === 0 ? 'lbp-total' : undefined}>
                        <Figure value={row[column.key] as string | null} />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <ul className="lbp-cards">
            {rows.map((row) => (
              <li key={row.record_number} className="lbp-card">
                <div className="lbp-card-head f-num">
                  <span className="lbp-card-year">{row.year ?? NOT_REPORTED}</span>
                  <span className="lbp-total">
                    <span className="f-visually-hidden">Total </span>
                    <Figure value={row.total_spent} />
                  </span>
                </div>
                <dl className="lbp-card-figures f-num">
                  {SPENDING_COLUMNS.slice(1).map((column) => (
                    <div key={column.key}>
                      <dt>{column.label}</dt>
                      <dd>
                        <Figure value={row[column.key] as string | null} />
                      </dd>
                    </div>
                  ))}
                </dl>
              </li>
            ))}
          </ul>
        )}
      </div>
      <ul className="lbp-notes">
        <li>{COPY.spendingValueNote}</li>
        {spendingRowsHaveMissingAmounts(rows) && <li>{COPY.spendingMissingValueNote}</li>}
        <li>{COPY.oldKindsNote}</li>
        <li>{COPY.kindsNote}</li>
      </ul>
    </>
  );
}

/**
 * Principal (Principal drawing): 1 principal's reported lobbying spending by year,
 * each figure the Board's own and never added across years, and the lobbyists
 * listed for it on the copy date. Keyed on the Board's entity ID.
 */
export function Principal({ match }: { match: RouteMatch }) {
  const location = useLocation();
  const here = location.pathname + location.search;
  const back = returnTarget(location.search);
  const id = recordNumber(match.params.id);
  const read = useRead<LobbyingPrincipal>(id ? apiPath(['lobbying', 'principals', id]) : null);
  const record = read.data && String(read.data.entity_id) === id ? read.data : null;
  // Only the spending file gives a principal a page: an ID with no spending rows is
  // a record Finance does not have.
  const missing = !id || read.notFound || record?.state === 'no_spending_rows';
  const unavailable =
    !missing && record !== null && (record.state === 'unavailable' || !record.name);
  const shown = !missing && !unavailable ? record : null;
  const identity = useConfirmedIdentity('principal', shown ? id : null);

  const copied = shown?.copied_at ? centralDateLabel(shown.copied_at) : null;
  const lobbyists = shown ? distinctLobbyists(shown.lobbyists.rows) : [];
  const spellings = shown ? principalSpellingLines(shown.lobbyists.rows) : [];

  return (
    <main id="main" className="f-page">
      <div className="f-content">
        {back && <BackLink to={back.to} name={back.name} />}
        {read.loading && !missing && <LoadingLine>{LOBBYING_RECORD_LOADING}</LoadingLine>}
        {missing && (
          <div className="lb-state">
            <Refused>{lobbyingRecordNotFound(match.params.id)}</Refused>
          </div>
        )}
        {(unavailable || (read.failed && !record)) && !missing && (
          <div className="lb-state">
            <Refused onRetry={read.retry} retrying={read.pending}>
              {FAILED}
            </Refused>
          </div>
        )}
        {shown && (
          <>
            <header className="lb-header">
              <div className="lb-tags">
                <span className="lb-chip">PRINCIPAL</span>
                <span className="lb-reg f-num">Entity ID {shown.entity_id}</span>
              </div>
              <h1 tabIndex={-1} className="f-page-title lb-title">
                {shown.name}
              </h1>
              <p className="lb-gloss">{COPY.gloss}</p>
            </header>
            {identity && <IdentityBox identity={identity} from={here} />}

            <div className="lb-main">
              <section aria-labelledby="lbp-spend" className="lbl-section">
                <h2 id="lbp-spend" className="f-section-title">
                  {COPY.spendingHeading}
                </h2>
                <p className="lb-intro">{COPY.spendingIntroduction}</p>
                {shown.spending.state === 'unavailable' ? (
                  <div className="lbl-box">
                    <Refused onRetry={read.retry} retrying={read.pending}>
                      {SPENDING_FAILED}
                    </Refused>
                  </div>
                ) : (
                  <Spending principal={shown} />
                )}
              </section>

              <section aria-labelledby="lbp-lobbyists" className="lbl-section">
                <h2 id="lbp-lobbyists" className="f-section-title">
                  {COPY.lobbyistsHeading}
                </h2>
                <p className="lb-intro f-num">{principalLobbyistsIntroduction(copied)}</p>
                {shown.lobbyists.state === 'unavailable' ? (
                  <div className="lbl-box">
                    <Refused onRetry={read.retry} retrying={read.pending}>
                      {LOBBYISTS_FAILED}
                    </Refused>
                  </div>
                ) : lobbyists.length === 0 ? (
                  <div className="f-empty-box lbl-box">{COPY.noLobbyists}</div>
                ) : (
                  <>
                    <ul className="lb-list">
                      {lobbyists.map((row) => (
                        <li key={row.registration_number}>
                          <RecordRow
                            name={row.name}
                            note={`Registration ${row.registration_number}`}
                            href={
                              isBuilt('lobbyist')
                                ? withFrom(
                                    hrefFor('lobbyist', { id: row.registration_number }),
                                    here,
                                  )
                                : null
                            }
                          />
                        </li>
                      ))}
                    </ul>
                    {spellings.map((line) => (
                      <p key={line} className="lb-note">
                        {line}
                      </p>
                    ))}
                  </>
                )}
              </section>
            </div>
          </>
        )}
      </div>
      {shown && (
        <SourcesAndUpdates>
          {copied && (
            <p className="f-sources-line f-num">
              Lobbying records copied {copied}. The copy date is when Alethical obtained the source,
              not the end date of every filing.
            </p>
          )}
          <OfficialLink href={PRINCIPAL_SOURCE_URL}>
            View the Board’s Lobbying Organizations Search Tool
          </OfficialLink>
        </SourcesAndUpdates>
      )}
    </main>
  );
}
