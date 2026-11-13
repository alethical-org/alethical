import { RECORDS_CHANGED, useVersionedRead } from '../../api/versionedRead';
import { useEffect } from 'react';

import { apiPath } from '../../api/read';
import { useAddressState } from '../../ui/addressState';
import { Chips, Refused, Updating } from '../../ui/controls';
import { LoadingLine } from '../../ui/parts';
import { hasDraft } from '../../ui/drafts';
import { Pager } from '../media/shared';
import { draftPrefix, plural, queueAmount, queueKind, queuePeriod } from './words';
import type { QueuePage, QueueRow } from './types';

const PAGE_SIZE = 20;

/** Names to review: exact printed names by money recorded under them, each payment
 * file its own row (finance_identity_directory.queue). */
export function Queue({
  selected,
  onSelect,
  onLoaded,
  version,
}: {
  selected: { kind: string; key: string } | null;
  onSelect: (row: QueueRow) => void;
  onLoaded: (page: QueuePage) => void;
  /** Rises after a saved change, so counts are read again. */
  version: number;
}) {
  const [state, setState] = useAddressState({
    record_type: 'all',
    status: 'unconfirmed',
    queue_page: '1',
  });
  const type =
    state.record_type === 'donor' ||
    state.record_type === 'payee' ||
    state.record_type === 'employer'
      ? state.record_type
      : 'all';
  const status =
    state.status === 'confirmed' || state.status === 'all' ? state.status : 'unconfirmed';
  const page = Math.max(1, Math.trunc(Number(state.queue_page) || 1));
  const read = useVersionedRead<QueuePage>(
    apiPath(['finance', 'identities', 'queue'], {
      record_type: type,
      status,
      page,
      page_size: PAGE_SIZE,
    }),
    { page, onRestart: () => setState({ queue_page: '1' }), refresh: version },
  );
  useEffect(() => {
    if (read.data) onLoaded(read.data);
  }, [read.data, onLoaded]);
  const data = read.data;
  return (
    <section className="ci-queue ci-card" aria-labelledby="queue-h">
      <div className="ci-queue-head">
        <div className="ci-queue-title">
          <h2 id="queue-h">Names to review</h2>
          <span className="f-num ci-muted">
            {data
              ? `${plural(data.total, 'name', 'names')} · most money recorded under the name first`
              : ''}
          </span>
        </div>
        <Chips
          label="Record type"
          value={type}
          options={[
            { value: 'all', label: 'All names' },
            { value: 'donor', label: 'Donor names' },
            { value: 'payee', label: 'Payee names' },
            { value: 'employer', label: 'Employer names' },
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
      {read.loading && (
        <div className="ci-pad">
          <LoadingLine>Loading names to review…</LoadingLine>
        </div>
      )}
      {read.updating && (
        <div className="ci-pad">
          <Updating />
        </div>
      )}
      {read.failed && (
        <div className="ci-pad">
          <Refused onRetry={read.retry} retrying={read.pending}>
            {read.changed
              ? RECORDS_CHANGED
              : `Couldn’t load the names to review. This is a problem on our side.${data ? ' Previous results are shown.' : ''}`}
          </Refused>
        </div>
      )}
      {data && data.rows.length === 0 && (
        <p className="ci-queue-empty">No names match these choices</p>
      )}
      {data && data.rows.length > 0 && (
        <ul className="ci-queue-list">
          {data.rows.map((row) => {
            const current = selected?.kind === row.record_kind && selected.key === row.record_key;
            const periodLabel = queuePeriod(row);
            return (
              <li key={`${row.record_kind}|${row.record_key}`}>
                <button
                  type="button"
                  className="ci-queue-item"
                  aria-current={current || undefined}
                  onClick={() => !current && onSelect(row)}
                >
                  <span className="ci-queue-name">{row.name}</span>
                  <span
                    className="ci-queue-money f-num"
                    data-withheld={row.amount_state !== 'reported' || undefined}
                  >
                    {queueAmount(row)}
                  </span>
                  {periodLabel && (
                    <span className="ci-queue-line f-num">Money recorded, {periodLabel}</span>
                  )}
                  <span className="ci-queue-line f-num">
                    {queueKind(row.record_kind)} · {plural(row.records, 'record', 'records')}
                    {row.missing_amounts
                      ? ` · ${plural(row.missing_amounts, 'amount', 'amounts')} not given`
                      : ''}
                    {row.confirmed ? ` · Confirmed for ${row.confirmed} of ${row.records}` : ''}
                    {row.confirmed && (row.identity_count ?? 0) > 1
                      ? ` · ${row.identity_count} identities`
                      : ''}
                  </span>
                  {hasDraft(draftPrefix(row.record_kind, row.record_key)) && (
                    <span className="ci-queue-draft">Unsaved draft</span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {data && data.pages > 1 && (
        <div className="ci-pad">
          <Pager
            page={data.page}
            pages={data.pages}
            busy={read.pending}
            onChange={(next) => setState({ queue_page: String(next) })}
          />
        </div>
      )}
    </section>
  );
}
