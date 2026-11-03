import {
  lobbyingPrincipalCopy as COPY,
  LOBBYING_RECORD_LOADING,
  PRINCIPAL_SOURCE_URL,
  principalSpellingLines,
  spendingRowsHaveMissingAmounts,
} from '@alethical/shared/lobbyingRecordCopy';
import type {
  LobbyingPrincipal,
  LobbyingPrincipalLobbyist,
  LobbyingSpendingRow,
} from '@alethical/shared/lobbyingTypes';
import { formatMoney } from '../ui/money';
import { centralDateLabel } from '@alethical/shared/moneyLanding';

import { apiPath, useRead } from '../api/read';
import { useLocation } from '../router';
import { returnTarget, withFrom } from '../returnContext';
import { hrefFor, isBuilt, type RouteMatch } from '../routes';
import { useBand } from '../ui/band';
import { Refused } from '../ui/controls';
import { BackLink, LoadingLine, SourcesAndUpdates } from '../ui/parts';
import { BarList, useView, ViewSwitch, type BarRow } from '../ui/view';
import {
  IdentityBox,
  notFoundLine,
  OfficialLink,
  RecordRow,
  recordNumber,
  useConfirmedIdentity,
} from './lobbying/parts';
import { MediaBuysCard } from './media/MediaBuysCard';
import './lobbying.css';

const FAILED =
  'We couldn’t load the Board’s lobbying record. This says nothing about what was reported.';
const SPENDING_SCOPE = 'Each row is 1 calendar year of this principal’s reported lobbying spending';
const CHART_TITLE = 'Total reported spending, by year';
const GAP = 'No spending report held';
const MORE_THAN_ONE = 'Amount unavailable: more than one report';
const LOBBYISTS_NOTE = 'It does not show who represented it in earlier spending years';
/** The notes under the chart or table, 1 group: every item ends with a period
 * because some have 2 sentences (eug-31). */
const NOTES = {
  due: 'Reports are due the following March.',
  value: 'Reported amounts may be rounded. $0 is the value in the Board’s file.',
  missing: '“Not reported” means the file leaves the value blank.',
  oldKinds:
    'Before 2024, most spending outside the Public Utilities Commission was reported under General rather than divided among Legislative, Administrative and Metropolitan.',
  kinds:
    'PUC means Public Utilities Commission. Legislative covers lawmaking; Administrative covers state agency rulemaking. Metropolitan is the Board’s label for lobbying metropolitan governmental units.',
};

/** The lobbyists section's scope line: whose list, and the copy it comes from. */
export function lobbyistsScope(copied: string | null): string {
  return copied
    ? `The lobbyist list shows who was registered for this principal in records copied ${copied}`
    : 'The lobbyist list shows who was registered for this principal in the copied records';
}

/**
 * The chart's rows (Rounds 31 and 34): the reported total only, 1 row per year from
 * the newest held year to the oldest; a year between them with no held row is a
 * dashed gap, never zero. A blank total prints "Not reported" with no bar; a year
 * with more than 1 filed row has no single total to draw.
 */
export function spendingBars(rows: readonly LobbyingSpendingRow[]): BarRow[] {
  const byYear = new Map<number, LobbyingSpendingRow[]>();
  for (const row of rows) {
    if (row.year === null) continue;
    byYear.set(row.year, [...(byYear.get(row.year) ?? []), row]);
  }
  const years = [...byYear.keys()];
  if (years.length === 0) return [];
  const newest = Math.max(...years);
  const oldest = Math.min(...years);
  const bars: BarRow[] = [];
  for (let year = newest; year >= oldest; year -= 1) {
    const held = byYear.get(year);
    if (!held) {
      bars.push({ key: String(year), label: String(year), amount: null, value: GAP, gap: true });
    } else if (held.length > 1) {
      bars.push({ key: String(year), label: String(year), amount: null, value: MORE_THAN_ONE });
    } else {
      const total = held[0].total_spent;
      const amount = total === null ? null : Number(total);
      bars.push({
        key: String(year),
        label: String(year),
        amount: amount !== null && Number.isFinite(amount) ? amount : null,
        value: spendingFigure(total),
      });
    }
  }
  return bars;
}
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
  const [view, setView] = useView('spendView');
  return (
    <>
      <div className="f-view-row lbp-view-row">
        <ViewSwitch value={view} onChange={setView} />
      </div>
      {view === 'chart' ? (
        <div className="f-chart lbp-chart">
          <h3>{CHART_TITLE}</h3>
          <BarList label={CHART_TITLE} rows={spendingBars(rows)} labelWidth="56px" />
        </div>
      ) : (
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
      )}
      <ul className="lbp-notes">
        <li>{NOTES.due}</li>
        <li>{NOTES.value}</li>
        {spendingRowsHaveMissingAmounts(rows) && <li>{NOTES.missing}</li>}
        <li>{NOTES.oldKinds}</li>
        <li>{NOTES.kinds}</li>
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
            <Refused>{notFoundLine(match.params.id)}</Refused>
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
                <p className="f-scope">{SPENDING_SCOPE}</p>
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
                <p className="f-scope f-num">{lobbyistsScope(copied)}</p>
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
                    <p className="lb-note lb-note-flush">{LOBBYISTS_NOTE}</p>
                    {spellings.map((line) => (
                      <p key={line} className="lbp-spelling">
                        {line}
                      </p>
                    ))}
                  </>
                )}
              </section>
            </div>
            <div className="mb-buys-after">
              <MediaBuysCard
                kind="principal"
                target={String(shown.entity_id)}
                name={shown.name ?? ''}
              />
            </div>
          </>
        )}
      </div>
      {shown && (
        <SourcesAndUpdates>
          <p className="f-sources-line">
            Lobbying spending figures come from the Minnesota Campaign Finance and Public Disclosure
            Board.
          </p>
          {copied && (
            <p className="f-sources-line lb-sources-gap f-num">
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
