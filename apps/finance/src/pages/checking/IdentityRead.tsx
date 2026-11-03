import { useState } from 'react';
import { formatMoney } from '@alethical/shared/moneyFormat';
import { formatCount } from '@alethical/shared/moneyLanding';
import { apiPath, useRead } from '../../api/read';
import { Link, useLocation } from '../../router';
import { withFrom } from '../../returnContext';
import { hrefFor } from '../../routes';
import { useAddressState } from '../../ui/addressState';
import { Chips, Empty } from '../../ui/controls';
import { SourcesAndUpdates } from '../../ui/parts';
import { day, Pager, ReadState } from '../media/shared';
import { periodOf } from '../organization/data';
import './checking.css';

export type PrintedKind = 'donor_name' | 'payee_name' | 'independent_payee_name' | 'employer_name';
interface IdentitySource {
  snapshot_id: string;
  source_url: string | null;
  copied_at: string | null;
  file: string;
}
export interface IdentityName extends IdentitySource {
  record_kind: PrintedKind;
  record_key: string;
  name: string;
  records: number;
  confirmed: number;
  amount: string | null;
  amount_state: 'reported' | 'incomplete_amount' | 'incomplete_period';
  missing_amounts: number;
  undated_records: number;
  period_basis: 'dates' | 'years' | null;
  first_year: number | null;
  last_year: number | null;
  first_date: string | null;
  last_date: string | null;
}
interface NamesPage {
  rows: IdentityName[];
  page: number;
  page_size: number;
  total: number;
  pages: number;
  sources: Record<string, IdentitySource>;
}
export interface IdentityFingerprint {
  fingerprint: string;
  fields: Record<string, string | number | null>;
  rows: Array<{ row_number: number; year: number | null }>;
  confirmation: { id: string; identity: { id: string; name: string; kind: string } } | null;
  display?: {
    filer_name: string | null;
    filer_registration_number: string | null;
    filer_is_held: boolean;
    record_type: string | null;
    record_types?: string[];
  };
}
export interface IdentityRecordsPage {
  record_kind: PrintedKind;
  record_key: string;
  file: string;
  snapshot_id: string;
  records: number;
  confirmed: number;
  page: number;
  page_size: number;
  total_fingerprints: number;
  pages: number;
  years: number[];
  fingerprints: IdentityFingerprint[];
  identities: Array<{ id: string; name: string; kind: string; confirmed: number }>;
  no_longer_in_board_file: Array<unknown>;
  source_url?: string | null;
  copied_at?: string | null;
}
export const kindLabel = (kind: PrintedKind) =>
  kind === 'donor_name'
    ? 'Donor name'
    : kind === 'employer_name'
      ? 'Employer name'
      : kind === 'independent_payee_name'
        ? 'Payee name · Outside spending'
        : 'Payee name · Campaign payments';
export function identityNamePeriod(row: IdentityName) {
  if (row.period_basis === 'dates')
    return periodOf([row.first_date, row.last_date]) ?? 'Period unavailable';
  if (row.period_basis === 'years' && row.first_year !== null && row.last_year !== null)
    return row.first_year === row.last_year
      ? `Year ${row.first_year}`
      : `Years ${row.first_year}–${row.last_year}`;
  return 'Period not available for every record';
}
export function identityNameAmount(row: IdentityName) {
  return row.amount_state === 'reported' && row.period_basis
    ? (formatMoney(row.amount) ?? 'Amount unavailable')
    : 'Amount unavailable';
}
/** The read-only queue is ready independently of confirmation/merge/split forms.
 * The caller owns selection and its detail/form composition. */
export function IdentityNames({
  selected,
  onSelect,
}: {
  selected: { record_kind: PrintedKind; record_key: string } | null;
  onSelect: (row: IdentityName) => void;
}) {
  const [state, setState] = useAddressState({
    record_type: 'all',
    status: 'unconfirmed',
    queue_page: '1',
    q: '',
  });
  const type =
    state.record_type === 'donor' || state.record_type === 'payee' ? state.record_type : 'all';
  const status =
    state.status === 'confirmed' || state.status === 'all' ? state.status : 'unconfirmed';
  const page = Math.max(1, Math.trunc(Number(state.queue_page) || 1));
  const read = useRead<NamesPage>(
    apiPath(['finance', 'identities', 'queue'], {
      record_type: type,
      status,
      q: state.q.trim().slice(0, 200),
      page,
      page_size: 20,
    }),
    { keepPrevious: true },
  );
  return (
    <>
      <section className="ck-card ck-identity-queue" aria-labelledby="identity-queue-heading">
        <div className="ck-identity-head">
          <h2 id="identity-queue-heading">Names to review</h2>
          {read.data && (
            <p className="ck-note">
              {formatCount(read.data.total)} {read.data.total === 1 ? 'name' : 'names'} · Largest
              complete amounts first
            </p>
          )}
          <Chips
            label="Record type"
            value={type}
            options={[
              { value: 'all', label: 'All names' },
              { value: 'donor', label: 'Donor names' },
              { value: 'payee', label: 'Payee names' },
            ]}
            onChange={(record_type) => setState({ record_type, queue_page: '1' })}
          />
          <Chips
            label="Status"
            value={status}
            options={[
              { value: 'unconfirmed', label: 'Not confirmed' },
              { value: 'confirmed', label: 'Confirmed' },
              { value: 'all', label: 'All' },
            ]}
            onChange={(status) => setState({ status, queue_page: '1' })}
          />
        </div>
        <ReadState read={read} noun="names to review" />
        {read.data && !read.data.rows.length && <Empty title="No names match these choices" />}
        <ul className="ck-queue-list">
          {read.data?.rows.map((row) => (
            <li key={`${row.record_kind}|${row.record_key}`}>
              <button
                className="ck-queue-item ck-name-item"
                aria-current={
                  selected?.record_kind === row.record_kind &&
                  selected.record_key === row.record_key
                    ? true
                    : undefined
                }
                onClick={() => onSelect(row)}
              >
                <strong>{row.name}</strong>
                <span
                  className="ck-name-amount"
                  data-unavailable={row.amount_state !== 'reported' || undefined}
                >
                  {identityNameAmount(row)}
                </span>
                <span className="ck-name-period ck-note">
                  Money recorded, {identityNamePeriod(row)}
                </span>
                <span className="ck-name-period ck-note">
                  {kindLabel(row.record_kind)} · {formatCount(row.records)} records
                  {row.missing_amounts
                    ? ` · ${formatCount(row.missing_amounts)} ${row.missing_amounts === 1 ? 'amount' : 'amounts'} not given`
                    : ''}
                  {row.confirmed
                    ? ` · Confirmed for ${formatCount(row.confirmed)} of ${formatCount(row.records)}`
                    : ''}
                </span>
              </button>
            </li>
          ))}
        </ul>
        {read.data && (
          <Pager
            page={read.data.page}
            pages={read.data.pages}
            busy={read.pending}
            onChange={(page) => setState({ queue_page: String(page) })}
          />
        )}
      </section>
      {read.data && (
        <SourcesAndUpdates
          groups={Object.values(read.data.sources).map((source) => ({
            source: source.file.replaceAll('_', ' '),
            items: [
              ...(source.source_url
                ? [
                    <a key="source" href={source.source_url} target="_blank" rel="noreferrer">
                      Board source file
                    </a>,
                  ]
                : []),
              ...(source.copied_at ? [`Copied ${day(source.copied_at)}`] : []),
            ],
          }))}
        />
      )}
    </>
  );
}
/** One pinned page of complete fingerprints. Repeated source rows remain visible
 * as repeated records; a page is never presented as the whole printed name. */
export function IdentityRecords({
  name,
}: {
  name: Pick<IdentityName, 'record_kind' | 'record_key' | 'snapshot_id'>;
}) {
  return <Records key={`${name.record_kind}|${name.record_key}|${name.snapshot_id}`} name={name} />;
}
function Records({
  name,
}: {
  name: Pick<IdentityName, 'record_kind' | 'record_key' | 'snapshot_id'>;
}) {
  const location = useLocation(),
    here = location.pathname + location.search;
  const [page, setPage] = useState(1);
  const read = useRead<IdentityRecordsPage>(
    apiPath(['finance', 'identities', 'records'], {
      record_kind: name.record_kind,
      record_key: name.record_key,
      snapshot_id: name.snapshot_id,
      page,
      page_size: 20,
    }),
    { keepPrevious: true },
  );
  const data = read.data;
  return (
    <section className="ck-card ck-padded" aria-labelledby="identity-records-heading">
      <h2 id="identity-records-heading">Records under this name</h2>
      <ReadState read={read} noun="records under this name" />
      {data && (
        <>
          <p className="ck-note">
            {formatCount(data.records)} records · Confirmed for {formatCount(data.confirmed)} of{' '}
            {formatCount(data.records)}
          </p>
          {data.fingerprints.length === 0 && <Empty title="No records are held under this name" />}
          <div className="ck-records" role="table" aria-label="Records under this name">
            <div className="ck-record-row ck-record-head" role="row">
              <span role="columnheader">Date</span>
              <span role="columnheader">Filer</span>
              <span role="columnheader">Amount</span>
              <span role="columnheader">Status</span>
            </div>
            {data.fingerprints.map((record) => {
              const f = record.fields,
                registration =
                  record.display?.filer_registration_number ??
                  String(f.recipient_reg_num ?? f.committee_reg_num ?? f.spender_reg_num ?? '');
              const filer =
                record.display?.filer_name ??
                (registration ? `Registration ${registration}` : 'Filer not given');
              const date = String(f.receipt_date ?? f.transaction_date ?? '');
              return (
                <div key={record.fingerprint} className="ck-record-row" role="row">
                  <span role="cell">{date ? day(date) : 'Date not given'}</span>
                  <span role="cell">
                    {record.display?.filer_is_held && registration ? (
                      <Link to={withFrom(hrefFor('committee', { id: registration }), here)}>
                        {filer}
                      </Link>
                    ) : (
                      filer
                    )}
                    {(record.display?.record_type || record.display?.record_types?.length) && (
                      <span className="ck-note">
                        {record.display.record_type ?? record.display.record_types?.join(' · ')}
                      </span>
                    )}
                    {record.rows.length > 1 && (
                      <span className="ck-note">
                        {formatCount(record.rows.length)} identical records
                      </span>
                    )}
                  </span>
                  <span role="cell" className="ck-record-amount">
                    {formatMoney(f.amount == null ? null : String(f.amount)) ?? 'Amount not given'}
                    {record.rows.length > 1 && <span className="ck-note">per record</span>}
                  </span>
                  <span role="cell">
                    {record.confirmation ? (
                      <Link
                        to={withFrom(
                          hrefFor(
                            record.confirmation.identity.kind === 'person'
                              ? 'person'
                              : 'organization',
                            { id: record.confirmation.identity.id },
                          ),
                          here,
                        )}
                      >
                        Confirmed as {record.confirmation.identity.name}
                      </Link>
                    ) : (
                      'Not confirmed'
                    )}
                  </span>
                </div>
              );
            })}
          </div>
          <Pager page={data.page} pages={data.pages} busy={read.pending} onChange={setPage} />
          {data.no_longer_in_board_file.length > 0 && (
            <p className="ck-note">
              {formatCount(data.no_longer_in_board_file.length)} previously confirmed record groups
              are no longer in the Board’s current file
            </p>
          )}
        </>
      )}
    </section>
  );
}
