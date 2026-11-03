import { useState } from 'react';
import { useRead } from '../api/read';
import { useLocation } from '../router';
import { returnTarget } from '../returnContext';
import { hrefFor } from '../routes';
import { useAddressState } from '../ui/addressState';
import { hasDraft } from '../ui/drafts';
import { BackLink } from '../ui/parts';
import { Review } from './checkStation/Review';
import { draftKey } from './checkStation/model';
import { MenuButton } from './media/menu';
import { Pager, ReadState, day, mediaPath } from './media/shared';
import type { FileDetail, Queue, QueueRow } from './media/types';
import './checkStation/checkStation.css';

const SORTS = [
  { value: 'suggested', label: 'Suggested first' },
  { value: 'newest', label: 'Newest first' },
];
const PAGE_SIZE = 20;

/** The queue row's second line (Check TV Station Files drawing). */
export function queueNote(row: QueueRow): string {
  const count = row.suggestion_count;
  const suggestions =
    count === 0 ? 'no suggestions' : count === 1 ? '1 suggestion' : `${count} suggestions`;
  const reason = row.reasons
    .map((r) =>
      r.kind === 'agency_checked_elsewhere'
        ? 'Agency name checked on another file'
        : `Folder checked as relating to ${r.label}`,
    )
    .join(' · ');
  return [row.station, suggestions, `saved ${day(row.saved_at)}`, reason]
    .filter(Boolean)
    .join(' · ');
}

/**
 * Check TV station files (/media-buys/check): a queue of current versions, the
 * chosen file's page and machine-read text, suggestions, the fact and connection
 * forms, and the checks on this version. Every check is made on 1 exact version;
 * the address names the file, the version and the page.
 */
export function CheckStationFiles() {
  const location = useLocation();
  const [state, setState] = useAddressState({
    sort: 'suggested',
    queue_page: '1',
    file: '',
    version: '',
    page: '1',
    check: '',
    action: '',
  });
  const sort = state.sort === 'newest' ? 'newest' : 'suggested';
  const queuePage = Math.max(1, Math.trunc(Number(state.queue_page)) || 1);
  const queue = useRead<Queue>(
    mediaPath(['queue'], { sort, limit: PAGE_SIZE, offset: (queuePage - 1) * PAGE_SIZE }),
    { keepPrevious: true },
  );
  const rows = queue.data?.rows ?? [];
  const file = state.file || rows[0]?.key || '';
  // Drafts change as the reader types; the queue's "Unsaved draft" tags follow.
  const [, setDrafts] = useState(0);
  const [extra, setExtra] = useState<FileDetail | null>(null);
  const shownExtra =
    extra && extra.key === file && !rows.some((row) => row.key === file) ? extra : null;
  const back = returnTarget(location.search) ?? { to: hrefFor('media-buys'), name: 'Media buys' };
  return (
    <main id="main" className="f-page mb-page mb-record ck-page">
      <div className="f-content">
        <BackLink to={back.to} name={back.name} />
        <header className="mb-head">
          <h1 tabIndex={-1} className="f-page-title">
            Check TV station files
          </h1>
          <p className="mb-lead">Each check belongs to one exact source version</p>
        </header>
        <div className="ck-layout">
          <section aria-labelledby="queue-heading" className="ck-queue">
            <div className="ck-queue-head">
              <h2 id="queue-heading">
                Queue{' '}
                {queue.data && (
                  <span className="ck-count f-num">{queue.data.total.toLocaleString('en-US')}</span>
                )}
              </h2>
              <MenuButton
                id="sort-btn"
                value={sort}
                options={SORTS}
                listLabel="Order"
                align="right"
                onChange={(next) => setState({ sort: next, queue_page: '1' })}
              >
                {SORTS.find((option) => option.value === sort)?.label}
              </MenuButton>
            </div>
            <div className="ck-queue-state">
              <ReadState read={queue} noun="TV station files" />
            </div>
            <ul className="ck-queue-list">
              {shownExtra && (
                <QueueItem
                  current
                  name={shownExtra.name}
                  note={`${shownExtra.station} · saved ${day(
                    shownExtra.versions.find((v) => v.id === shownExtra.version_id)?.first_saved_at,
                  )}`}
                  draft={hasDraft(draftKey(shownExtra.key, shownExtra.version_id))}
                />
              )}
              {rows.map((row) => (
                <QueueItem
                  key={row.key}
                  current={row.key === file}
                  name={row.name}
                  note={queueNote(row)}
                  draft={hasDraft(draftKey(row.key, row.version_id))}
                  onPick={() =>
                    setState({
                      file: row.key,
                      version: row.version_id,
                      page: '1',
                      check: '',
                      action: '',
                    })
                  }
                />
              ))}
            </ul>
            {queue.data && (
              <div className="ck-queue-pager">
                <Pager
                  page={Math.floor(queue.data.offset / PAGE_SIZE) + 1}
                  pages={Math.ceil(queue.data.total / PAGE_SIZE)}
                  busy={queue.pending}
                  onChange={(next) => setState({ queue_page: String(next) })}
                />
              </div>
            )}
          </section>
          {file ? (
            <Review
              key={file}
              fileKey={file}
              askedVersion={state.version}
              page={Math.max(1, Math.trunc(Number(state.page)) || 1)}
              check={state.check}
              action={state.action}
              onAddress={setState}
              onDraftChange={() => setDrafts((n) => n + 1)}
              onLoaded={(detail) => setExtra(detail)}
            />
          ) : (
            queue.loading && <div className="ck-detail-loading" aria-hidden="true" />
          )}
        </div>
      </div>
    </main>
  );
}

function QueueItem({
  name,
  note,
  draft,
  current,
  onPick,
}: {
  name: string;
  note: string;
  draft: boolean;
  current: boolean;
  onPick?: () => void;
}) {
  const body = (
    <>
      <span className="ck-queue-name">{name}</span>
      <span className="ck-queue-note f-num">{note}</span>
      {draft && <span className="ck-draft-tag">Unsaved draft</span>}
    </>
  );
  return (
    <li>
      {current ? (
        <div className="ck-queue-item" aria-current="true">
          {body}
        </div>
      ) : (
        <button type="button" className="ck-queue-item" onClick={onPick}>
          {body}
        </button>
      )}
    </li>
  );
}
