import { useState, type ReactNode } from 'react';
import { formatCount } from '@alethical/shared/moneyLanding';
import { useRead } from '../../api/read';
import { Link, useLocation } from '../../router';
import { withFrom } from '../../returnContext';
import { hrefFor } from '../../routes';
import { useAddressState } from '../../ui/addressState';
import { Dropdown, Empty } from '../../ui/controls';
import { factLabel } from '../StationFile';
import { day, Frame, mediaPath, PageImage, Pager, ReadState } from '../media/shared';
import type { FileDetail, FileRow, Sources } from '../media/types';
import './checking.css';

export interface QueueFile extends FileRow {
  saved_at: string;
  suggestion_count: number;
  reasons: Array<{ kind: 'agency_checked_elsewhere' | 'folder_committee_checked'; label: string }>;
}
interface StationQueue {
  rows: QueueFile[];
  total: number;
  limit: number;
  offset: number;
  has_more: boolean;
  sort: string;
}
export interface FactSuggestion {
  field: string;
  machine_field: string;
  value: string;
  page: number;
  pages: number[];
  quote: string;
  in_source_text: boolean;
  already_checked: boolean;
}
interface Suggestions {
  key: string;
  version_id: string;
  extraction_version: string;
  facts: FactSuggestion[];
}
export interface PreparedFact {
  file_key: string;
  version_id: string;
  suggestion: FactSuggestion;
}

/** Approved read sections. The route stays unavailable until the required check form
 * has its drawing. The form owner supplies the last section; this module never writes. */
export function StationCheckRead({
  renderForm,
}: {
  renderForm: (file: FileDetail, prepared: PreparedFact | null) => ReactNode;
}) {
  const [state, setState] = useAddressState({
    sort: 'suggested',
    queue_page: '1',
    file: '',
    version: '',
    page: '1',
  });
  const sort = state.sort === 'newest' ? 'newest' : 'suggested';
  const queuePage = Math.max(1, Math.trunc(Number(state.queue_page) || 1));
  const queue = useRead<StationQueue>(
    mediaPath(['queue'], { sort, limit: 20, offset: (queuePage - 1) * 20 }),
    { keepPrevious: true },
  );
  const sources = useRead<Sources>(mediaPath(['sources']));
  const chosen =
    queue.data?.rows.find((row) => row.key === state.file) ??
    (!state.file ? queue.data?.rows[0] : undefined);
  const file = state.file || chosen?.key || '';
  const version = state.version || chosen?.version_id || '';
  return (
    <Frame title="Check station files" sources={sources.data}>
      <p className="ck-lead">Each check belongs to one exact source version</p>
      <div className="ck-station-layout">
        <section className="ck-card ck-queue" aria-labelledby="station-queue-heading">
          <div className="ck-queue-head">
            <h2 id="station-queue-heading">
              Queue {queue.data && <span className="f-num">{formatCount(queue.data.total)}</span>}
            </h2>
            <Dropdown
              name="Order"
              value={sort}
              options={[
                { value: 'suggested', label: 'Suggested first' },
                { value: 'newest', label: 'Newest first' },
              ]}
              onChange={(sort) => setState({ sort, queue_page: '1' })}
            />
          </div>
          <ReadState read={queue} noun="station files to check" />
          {queue.data && !queue.data.rows.length && (
            <Empty title="No station files match these choices" />
          )}
          <ul className="ck-queue-list">
            {queue.data?.rows.map((row) => {
              const current = file === row.key;
              const Tag = current ? 'div' : 'button';
              return (
                <li key={row.key}>
                  <Tag
                    className="ck-queue-item"
                    aria-current={file === row.key ? true : undefined}
                    onClick={
                      current
                        ? undefined
                        : () => setState({ file: row.key, version: row.version_id, page: '1' })
                    }
                  >
                    <strong>{row.name}</strong>
                    <span className="ck-note">
                      {row.station} · {formatCount(row.suggestion_count)}{' '}
                      {row.suggestion_count === 1 ? 'suggestion' : 'suggestions'} · saved{' '}
                      {day(row.saved_at)}
                      {row.reasons.map((reason) => ` · ${reason.label}`).join('')}
                    </span>
                  </Tag>
                </li>
              );
            })}
          </ul>
          {queue.data && (
            <Pager
              page={Math.floor(queue.data.offset / 20) + 1}
              pages={Math.ceil(queue.data.total / 20)}
              busy={queue.pending}
              onChange={(page) => setState({ queue_page: String(page) })}
            />
          )}
        </section>
        {file && (
          <StationReview
            key={`${file}|${version}`}
            fileKey={file}
            version={version}
            page={Math.max(1, Math.trunc(Number(state.page) || 1))}
            setPage={(page) => setState({ page: String(page) })}
            renderForm={renderForm}
          />
        )}
      </div>
    </Frame>
  );
}
function StationReview({
  fileKey,
  version,
  page,
  setPage,
  renderForm,
}: {
  fileKey: string;
  version: string;
  page: number;
  setPage: (page: number) => void;
  renderForm: (file: FileDetail, prepared: PreparedFact | null) => ReactNode;
}) {
  const location = useLocation(),
    here = location.pathname + location.search;
  const read = useRead<FileDetail>(mediaPath(['files', fileKey], { version }));
  const file = read.data;
  const suggestions = useRead<Suggestions>(
    file ? mediaPath(['files', fileKey, 'suggestions'], { version: file.version_id }) : null,
    { acceptData: (data) => data.key === fileKey && data.version_id === file?.version_id },
  );
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [showDismissed, setShowDismissed] = useState(false);
  const [prepared, setPrepared] = useState<PreparedFact | null>(null);
  const keyOf = (suggestion: FactSuggestion) =>
    JSON.stringify([suggestion.field, suggestion.value, suggestion.page, suggestion.quote]);
  const all = suggestions.data?.facts.filter((s) => !s.already_checked) ?? [];
  const shown = all.filter((s) => showDismissed || !dismissed.has(keyOf(s)));
  const current = Math.min(page, file?.page_count || 1);
  return (
    <div className="ck-station-detail">
      <ReadState read={read} noun="station file" />
      {file && (
        <>
          <section className="ck-card ck-padded">
            <div className="ck-detail-head">
              <div>
                <h2>{file.name}</h2>
                <p className="ck-note">
                  {file.station} · {file.year ?? 'Year unavailable'} · {file.folder.label} · Source
                  version {file.version_id}
                </p>
              </div>
              <Link
                to={withFrom(
                  hrefFor(
                    'station-file',
                    { key: file.key },
                    { version: file.version_id, page: String(current) },
                  ),
                  here,
                )}
              >
                Open file
              </Link>
            </div>
            <div className="ck-review-columns">
              <div>
                {file.page_count ? (
                  <PageImage fileKey={file.key} version={file.version_id} page={current} />
                ) : (
                  <p>Page images are unavailable</p>
                )}
              </div>
              <div>
                <Pager page={current} pages={file.page_count} onChange={setPage} />
                <p className="f-label">Machine-read text · Not checked</p>
                <pre className="ck-machine-text">
                  {file.pages.find((p) => p.number === current)?.text ||
                    'Machine-read text is not held for this file'}
                </pre>
              </div>
            </div>
          </section>
          <section className="ck-card ck-padded" aria-labelledby="suggestions-heading">
            <div className="ck-detail-head">
              <h2 id="suggestions-heading">
                Suggestions{' '}
                {suggestions.data && (
                  <span className="f-num">
                    {all.filter((s) => !dismissed.has(keyOf(s))).length}
                  </span>
                )}
              </h2>
              <button
                className="f-btn f-btn-secondary"
                aria-pressed={showDismissed}
                onClick={() => setShowDismissed(!showDismissed)}
              >
                Show dismissed
              </button>
            </div>
            <p className="ck-note">
              Each suggestion names a fact read from this version. Using one fills the check form
              below; it is not a check until saved with its quote and page.
            </p>
            <ReadState read={suggestions} noun="suggestions" />
            {suggestions.data && shown.length === 0 && (
              <Empty title="No suggestions waiting for this version" />
            )}
            <ul className="ck-suggestions">
              {shown.map((s) => {
                const key = keyOf(s),
                  isDismissed = dismissed.has(key);
                return (
                  <li key={key} data-dismissed={isDismissed || undefined}>
                    <div>
                      <span className="ck-note">{factLabel(s.field)}</span>
                      <strong>{s.value}</strong>
                      <span className="ck-note">
                        Page {s.page} · {isDismissed ? 'Dismissed' : 'Not checked'}
                      </span>
                    </div>
                    <div className="ck-suggestion-actions">
                      {isDismissed ? (
                        <button
                          className="f-btn f-btn-secondary"
                          onClick={() =>
                            setDismissed(new Set([...dismissed].filter((item) => item !== key)))
                          }
                        >
                          Restore
                        </button>
                      ) : (
                        <>
                          <button
                            className="f-btn"
                            aria-label={`Use suggestion: ${factLabel(s.field)} ${s.value}`}
                            onClick={() => {
                              setPrepared({
                                file_key: file.key,
                                version_id: file.version_id,
                                suggestion: s,
                              });
                              setPage(s.page);
                            }}
                          >
                            Use suggestion
                          </button>
                          <button
                            className="f-btn f-btn-secondary"
                            aria-label={`Dismiss suggestion: ${factLabel(s.field)} ${s.value}`}
                            onClick={() => setDismissed(new Set([...dismissed, key]))}
                          >
                            Dismiss
                          </button>
                        </>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
          {renderForm(file, prepared)}
        </>
      )}
    </div>
  );
}
