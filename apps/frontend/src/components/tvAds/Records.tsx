import { PRINTED_NAME_NOTICE, PRINTED_NAME_PAYMENTS, RETRY_EXPLANATION } from './copy';
import React, { useContext, useEffect, useRef, useState } from 'react';
import { useResponsive } from '../../hooks/useResponsive';
import { ApiError } from '../../data/api';
import {
  centralDate,
  isAccessFailure,
  orderStationCategories,
  queryString,
  readTVImage,
  STATION_CATEGORY_ORDER,
  tvHref,
  uploaded,
  type AgencyDetail,
  type Connection,
  type Fact,
  type FileDetail,
  type FolderDetail,
  type StationDetail,
  type ExpenseDetail,
} from './api';
import {
  Arrow,
  Busy,
  Checked,
  ChoiceMenu,
  External,
  Failure,
  FileRows,
  Internal,
  Kind,
  Metric,
  TVSession,
  useTVRead,
} from './pieces';
import { highlight } from './Landing';

export function TVFile({
  fileKey,
  version,
  params,
  onParams,
  notFound,
}: {
  fileKey: string;
  version?: string;
  params: Record<string, unknown>;
  onParams: (params: Record<string, string | undefined>) => void;
  notFound: () => void;
}) {
  const request = useTVRead<FileDetail>(
    `/files/${encodeURIComponent(fileKey)}${queryString({ version, copy: params.copy })}`,
  );
  const file = request.data;
  useEffect(() => {
    if (request.error instanceof ApiError && request.error.status === 404) notFound();
  }, [request.error, notFound]);
  // A different version must never show the previous version while loading.
  if (request.loading || request.error)
    return (
      <>
        <h1 className="tv-record-title">{file?.name || 'Station file'}</h1>
        {request.error ? (
          <Failure retry={request.retry} detail="This is a problem on our side">
            We couldn’t load this file right now
          </Failure>
        ) : (
          <Busy label="Loading saved record" />
        )}
      </>
    );
  if (!file) return null;
  if (file.copy_status === 'withdrawn')
    return (
      <>
        <h1>This copy is no longer shown</h1>
        {file.withdrawn_at && <p>Its approval was withdrawn on {centralDate(file.withdrawn_at)}</p>}
        <NewestCopy file={file} />
      </>
    );
  if (!file.name)
    return (
      <>
        <h1>Record unavailable</h1>
        <p className="tv-notice tv-neutral-notice">An approved copy is not ready</p>
      </>
    );
  return (
    <FileContents
      key={`${fileKey}:${file.version_id}:${file.copy_id}`}
      file={file}
      params={params}
      onParams={onParams}
      onWithdrawn={() => {
        onParams({ copy: file.copy_id || undefined, version: file.version_id });
        request.clearRefresh();
      }}
    />
  );
}
export function TVExpense({ expenseId, notFound }: { expenseId: string; notFound: () => void }) {
  const read = useTVRead<ExpenseDetail>(`/expenses/${encodeURIComponent(expenseId)}`);
  useEffect(() => {
    if (read.error instanceof ApiError && read.error.status === 404) notFound();
  }, [read.error, notFound]);
  if (read.loading) return <Busy label="Loading retained expense evidence" />;
  if (read.error) return <Failure retry={read.retry} />;
  const data = read.data;
  if (!data) return null;
  return (
    <>
      <h1 className="tv-record-title">{data.label}</h1>
      <p className="tv-lead">From Alethical’s saved copy of the Campaign Finance Board records</p>
      <p className="tv-small">
        {data.dataset}
        {data.source_date ? ` · ${centralDate(data.source_date)}` : ''}
      </p>
      {data.source_changed && (
        <p className="tv-notice tv-error">
          The committee’s filing changed; this connection was checked against the saved filing shown
          here
        </p>
      )}
      <section className="tv-card" style={{ marginTop: 28 }}>
        <h2>Reported expense</h2>
        <dl className="tv-dates">
          {data.fields.map((field, index) => (
            <React.Fragment key={`${field.label}-${index}`}>
              <dt>{field.label}</dt>
              <dd>{field.value}</dd>
            </React.Fragment>
          ))}
        </dl>
        <p className="tv-small">A reported expense is not proof that an invoice was paid</p>
      </section>
      <section className="tv-section">
        <h2>Station record used for this connection</h2>
        <a
          className="tv-block-link"
          href={tvHref('file', data.file.key, {
            version: data.file.version_id,
            copy: data.file.copy_id,
            page: data.evidence.page,
          })}
        >
          {data.file.name} · page {data.evidence.page}
          <Arrow />
        </a>
        <q className="tv-quote">{data.evidence.quote}</q>
      </section>
    </>
  );
}
function NewestCopy({ file }: { file: FileDetail }) {
  const newest = file.versions.find(
    (item) => item.id === file.newest_approved_version && item.status === 'approved',
  );
  return newest ? (
    <a className="tv-block-link" href={tvHref('file', file.key, { version: newest.id })}>
      Show the newest approved copy
      <Arrow />
    </a>
  ) : (
    <p className="tv-notice tv-neutral-notice">An approved copy is not ready</p>
  );
}
function FileContents({
  file,
  params,
  onParams,
  onWithdrawn,
}: {
  file: FileDetail;
  params: Record<string, unknown>;
  onParams: (params: Record<string, string | undefined>) => void;
  onWithdrawn: () => void;
}) {
  const { isMobile, isDesktop } = useResponsive();
  const [page, setPage] = useState(
    Math.max(1, Math.min(file.page_count || 1, Number(params.page) || 1)),
  );
  const [textOpen, setTextOpen] = useState(params.text === 'open');
  const [history, setHistory] = useState(typeof params.history === 'string' ? params.history : '');
  const [query, setQuery] = useState(typeof params.q === 'string' ? params.q : '');
  const viewer = useRef<HTMLDivElement>(null);
  const item = file.pages?.find((entry) => entry.number === page);
  const newest = file.versions.find(
    (entry) => entry.id === file.newest_approved_version && entry.status === 'approved',
  );
  const pendingNewer =
    file.source_changed &&
    file.current_source_version !== file.version_id &&
    file.versions.some(
      (entry) => entry.id === file.current_source_version && entry.status === 'pending',
    );
  const choosePage = (number: number) => {
    setPage(number);
    onParams({ page: number > 1 ? String(number) : undefined });
  };
  const evidence = (number?: number, sourceVersion?: string) => {
    if (!number) return;
    if (sourceVersion && sourceVersion !== file.version_id) {
      window.location.assign(tvHref('file', file.key, { version: sourceVersion, page: number }));
      return;
    }
    choosePage(number);
    viewer.current?.focus();
    viewer.current?.scrollIntoView?.({ block: 'nearest' });
  };
  const facts = file.facts || [];
  const dates = file.dates || [];
  const dateValue = (fact: Fact) => (
    <FactValue
      key={fact.id}
      fact={fact}
      evidence={evidence}
      historyOpen={history === fact.id}
      onHistory={() => {
        const next = history === fact.id ? '' : fact.id;
        setHistory(next);
        onParams({ history: next || undefined });
      }}
    />
  );
  return (
    <>
      <div className="tv-eyebrow">
        <a href={tvHref('station', file.station || '')}>{file.station}</a> · {file.year} ·{' '}
        {file.category ? `STATION CATEGORY: ${file.category}` : 'CATEGORY NOT IDENTIFIED'}
      </div>
      <h1 className="tv-record-title">{file.name}</h1>
      <div className="tv-file-meta">
        <Kind value={file.kind} />
        <p className="tv-small">{uploaded(file.uploaded_at)}</p>
        {file.folder && (
          <a href={tvHref('folder', file.folder.key)}>
            Folder “{file.folder.label}”<Arrow />
          </a>
        )}
      </div>
      <div className="tv-inline" style={{ margin: '12px 0 24px', gap: '6px 22px' }}>
        {file.versions.length > 1 && (
          <div className="tv-versions">
            <ChoiceMenu
              label="Saved versions, newest first, Central Time"
              labelInMenu
              menuWidth={420}
              triggerLabel={`${file.versions.length - 1} other saved ${file.versions.length === 2 ? 'version' : 'versions'}`}
              value={file.version_id || ''}
              choices={file.versions.map((entry) => {
                const saved = `First saved ${centralDate(entry.first_saved_at, true)}`;
                const status =
                  entry.status === 'archive'
                    ? 'Original station file'
                    : entry.status === 'pending'
                      ? 'Not shown yet: awaiting approval'
                      : entry.status === 'withdrawn'
                        ? 'Not shown: its approval was withdrawn'
                        : entry.id === file.version_id
                          ? ''
                          : 'An older approved copy';
                return {
                  value: entry.id,
                  label: `${saved} · ${uploaded(entry.uploaded_at)}${status ? ` · ${status}` : ''}`,
                  content: (
                    <>
                      <span className="tv-version-saved">{saved}</span>
                      <span className="tv-version-detail">{uploaded(entry.uploaded_at)}</span>
                      {status && <span className="tv-version-detail">{status}</span>}
                    </>
                  ),
                  disabled: entry.status !== 'approved' && entry.status !== 'archive',
                };
              })}
              onChange={(id) => onParams({ version: id, copy: undefined, page: undefined })}
            />
          </div>
        )}
        {file.fcc_available === false ? (
          <span className="tv-small">The FCC no longer serves this file; our copy is kept</span>
        ) : (
          file.fcc_url && (
            <External href={file.fcc_url} suffix={`for this ${file.station} file`}>
              This file on the FCC website
            </External>
          )
        )}
      </div>
      {file.copy_status !== 'archive' && newest && newest.id !== file.version_id && (
        <div className="tv-notice tv-error">
          <div>
            <span>An older approved copy</span>
            {file.source_changed && (
              <p className="tv-small">
                The station file changed after this copy was saved; this page shows the saved copy
              </p>
            )}
            {file.fcc_url && file.fcc_available !== false && (
              <p className="tv-small">
                The FCC website may now show a newer version of this file than this copy
              </p>
            )}
          </div>
          <NewestCopy file={file} />
        </div>
      )}
      {pendingNewer && newest?.id === file.version_id && (
        <p className="tv-notice">
          A newer version is saved and awaiting approval: this is the newest approved copy
        </p>
      )}
      {!(file.copy_status !== 'archive' && newest && newest.id !== file.version_id) &&
        ((newest && newest.id !== file.version_id) || pendingNewer) &&
        file.fcc_url &&
        file.fcc_available !== false && (
          <p className="tv-small" style={{ marginBottom: 16 }}>
            The FCC website may now show a newer version of this file than this copy
          </p>
        )}
      {file.source_changed &&
        !(file.copy_status !== 'archive' && newest && newest.id !== file.version_id) && (
          <p className="tv-small" style={{ marginBottom: 24 }}>
            The station file changed after this copy was saved; this page shows the saved copy
          </p>
        )}
      {file.copy_status !== 'approved' && file.copy_status !== 'archive' ? (
        <p className="tv-notice tv-neutral-notice">
          We hold this file; its approved copy is not ready
          {file.fcc_url ? ', and the FCC’s own copy is linked above' : ''}
        </p>
      ) : (
        <>
          <div className="tv-file-grid">
            <div className="tv-file-viewer">
              <Viewer
                refEl={viewer}
                file={file}
                page={page}
                setPage={choosePage}
                onWithdrawn={onWithdrawn}
              />
              <p className="tv-small tv-viewer-caption">
                {file.copy_status === 'archive'
                  ? 'Original station file · Not checked or approved for publication'
                  : 'Blank boxes cover personal details we do not publish'}
              </p>
            </div>
            <aside className="tv-file-side">
              <section className={`tv-card${facts.length ? '' : ' tv-empty-facts'}`}>
                <h2>{facts.length ? 'Checked' : 'No facts have been checked yet'}</h2>
                {facts.map(dateValue)}
              </section>
              {dates.length > 0 && (
                <section className="tv-card">
                  <h2>Dates</h2>
                  {dates.map(dateValue)}
                </section>
              )}
            </aside>
            <section className="tv-file-text">
              <div className="tv-inline" style={{ justifyContent: 'space-between' }}>
                <div>
                  <h2 style={{ marginBottom: 4 }}>Machine-read text</h2>
                  <span className="tv-small">Not checked</span>
                </div>
                {!isDesktop && (
                  <button
                    className="tv-button tv-secondary"
                    aria-expanded={textOpen}
                    onClick={() => {
                      setTextOpen(!textOpen);
                      onParams({ text: !textOpen ? 'open' : undefined });
                    }}
                  >
                    {textOpen ? 'Hide text' : 'Show text'}
                  </button>
                )}
              </div>
              {(isDesktop || textOpen) && (
                <>
                  <p className="tv-small">
                    Page {page} of {file.page_count}
                  </p>
                  {query && (
                    <div className="tv-inline">
                      <p className="tv-small">Highlighting “{query}”</p>
                      <button
                        className="tv-link-button"
                        onClick={() => {
                          setQuery('');
                          onParams({ q: undefined });
                        }}
                      >
                        Clear highlighting
                      </button>
                    </div>
                  )}
                  {item?.text_status === 'failed' || item?.text_status === 'partial' ? (
                    <p className="tv-notice tv-neutral-notice">
                      This page’s text could not be {item.text_status === 'partial' ? 'fully ' : ''}
                      read by machine
                    </p>
                  ) : null}
                  {item?.text_status === 'pending' && (
                    <p className="tv-notice tv-neutral-notice">This page’s text is not ready</p>
                  )}
                  {item?.text && (
                    <div className="tv-text" style={{ marginTop: 16 }}>
                      {highlight(item.text, query)}
                    </div>
                  )}
                </>
              )}
            </section>
          </div>
          <div className="tv-file-lower">
            <section className="tv-card">
              <h2>Checked connections</h2>
              {file.connections?.length ? (
                file.connections.map((connection) => (
                  <ConnectionItem key={connection.id} value={connection} evidence={evidence} />
                ))
              ) : (
                <>
                  <p>None to a Minnesota committee</p>
                  {facts
                    .filter(
                      (fact) =>
                        fact.status === 'checked' &&
                        fact.value &&
                        /advertiser|payer/i.test(fact.kind),
                    )
                    .map((fact) => (
                      <div key={fact.id}>
                        <h3 className="tv-fact-label">{fact.kind}, as printed</h3>
                        <p>{fact.value}</p>
                        <a
                          className="tv-block-link"
                          href={`/money/payments${queryString({ name: fact.value, role: 'vendor' })}`}
                        >
                          {PRINTED_NAME_PAYMENTS}
                          <Arrow />
                        </a>
                      </div>
                    ))}
                </>
              )}
            </section>
            <div className="tv-file-related">
              {!!file.related?.length && (
                <section className="tv-card">
                  <h2>Related documents</h2>
                  {file.related.map((related) => (
                    <div className="tv-fact" key={related.key}>
                      <Kind value={related.kind} />
                      <a
                        className="tv-block-link"
                        href={tvHref('file', related.key, {
                          version: related.version_id,
                          copy: related.copy_id,
                        })}
                      >
                        {related.name}
                        <Arrow />
                      </a>
                      <p>{related.reference}</p>
                      <Checked date={related.checked_at} />
                      {related.source_changed && (
                        <p className="tv-small">
                          The station file changed; this is the saved copy used for the check
                        </p>
                      )}
                    </div>
                  ))}
                </section>
              )}
              <section className="tv-card">
                <h2>Other files in this folder</h2>
                {file.other_files?.length ? (
                  <FileRows files={file.other_files} folderContext={file} />
                ) : (
                  <p className="tv-small">No other files to show</p>
                )}
              </section>
            </div>
            <section className="tv-card tv-file-limits">
              <h2>Limits of this record</h2>
              <ul className="tv-plain-list">
                {kindLimits(file.kind).map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            </section>
          </div>
        </>
      )}
    </>
  );
}
export function kindLimits(kind?: string | null) {
  const specific: Record<string, string> = {
    Order: 'An order books airtime',
    Invoice: 'An invoice bills airtime',
    Credit: 'A credit reverses part of a bill',
    Agreement: 'An agreement states who asked for the airtime, as the form prints it',
  };
  return [
    ...(kind && specific[kind] ? [specific[kind]] : []),
    'The station is where the file was filed, not necessarily where the ad aired',
    'A document’s title alone does not establish that an ad aired or a bill was paid',
  ];
}
function FactValue({
  fact,
  evidence,
  historyOpen,
  onHistory,
}: {
  fact: Fact;
  evidence: (page?: number, version?: string) => void;
  historyOpen: boolean;
  onHistory: () => void;
}) {
  return (
    <div className="tv-fact">
      <h3 className="tv-fact-label">{fact.kind}</h3>
      {fact.status === 'withdrawn' ? (
        <p className="tv-small">
          This fact was withdrawn{fact.withdrawn_at ? ` on ${centralDate(fact.withdrawn_at)}` : ''}
        </p>
      ) : (
        <>
          <div className="tv-fact-value">{fact.value}</div>
          {fact.qualifier && <p>{fact.qualifier}</p>}
          {fact.quote && <q className="tv-quote">{fact.quote}</q>}
          {fact.page && (
            <button className="tv-link-button" onClick={() => evidence(fact.page, fact.version_id)}>
              page {fact.page}
            </button>
          )}
          <Checked date={fact.checked_at} />
          {!!fact.history?.length && (
            <>
              <button
                className="tv-link-button tv-history"
                aria-expanded={historyOpen}
                onClick={onHistory}
              >
                History
              </button>
              {historyOpen &&
                fact.history.map((old, index) => (
                  <p className="tv-small" key={index}>
                    {old.value} · Corrected on {centralDate(old.corrected_at)}
                  </p>
                ))}
            </>
          )}
        </>
      )}
    </div>
  );
}
function ConnectionItem({
  value,
  evidence,
}: {
  value: Connection;
  evidence: (page?: number, version?: string) => void;
}) {
  if (value.status === 'withdrawn')
    return (
      <p className="tv-small tv-fact">
        This connection was withdrawn
        {value.withdrawn_at ? ` on ${centralDate(value.withdrawn_at)}` : ''}
      </p>
    );
  return (
    <div className="tv-fact">
      <h3 className="tv-fact-label">
        {(
          {
            committee: 'Campaign committee',
            candidate: 'Candidate',
            election: 'Election',
            expense: 'Reported expense',
            principal: 'Lobbying principal',
            related_document: 'Related document',
            issue: 'Issue',
          } as Record<string, string>
        )[value.kind] || value.kind}
      </h3>
      <Internal href={value.href}>{value.label}</Internal>
      {value.role && <p>{value.role}</p>}
      {value.quote && <q className="tv-quote">{value.quote}</q>}
      {value.page && (
        <button className="tv-link-button" onClick={() => evidence(value.page, value.version_id)}>
          page {value.page}
        </button>
      )}
      {value.reported_amount !== undefined && <p>Reported expense: {value.reported_amount}</p>}
      {value.reported_date && <p>Reported date: {centralDate(value.reported_date)}</p>}
      <Checked date={value.checked_at} />
      {value.source_changed && (
        <p className="tv-notice tv-error">
          The committee’s filing changed; this connection was checked against the saved filing shown
          here
        </p>
      )}
      {value.evidence_label && (
        <p>
          <Internal href={value.href}>{value.evidence_label}</Internal>
        </p>
      )}
    </div>
  );
}

function Viewer({
  file,
  page,
  setPage,
  refEl,
  onWithdrawn,
}: {
  file: FileDetail;
  page: number;
  setPage: (page: number) => void;
  refEl: React.RefObject<HTMLDivElement | null>;
  onWithdrawn: () => void;
}) {
  const { token, denied } = useContext(TVSession);
  const { isMobile } = useResponsive();
  const [zoom, setZoom] = useState(100);
  const [image, setImage] = useState<{ path: string; url?: string; error?: boolean }>({ path: '' });
  const [attempt, setAttempt] = useState(0);
  const withdraw = useRef(onWithdrawn);
  withdraw.current = onWithdrawn;
  const item = file.pages?.find((entry) => entry.number === page);
  const path = item?.image_path || '';
  const steps = isMobile ? [75, 100, 150, 200, 300, 400] : [75, 100, 125, 150, 175, 200];
  useEffect(() => {
    if (!steps.includes(zoom)) setZoom(100);
  }, [isMobile]);
  useEffect(() => {
    const controller = new AbortController();
    let objectUrl: string | undefined;
    setImage({ path });
    if (path)
      void readTVImage(token, path, controller.signal).then(
        (blob) => {
          if (controller.signal.aborted) return;
          objectUrl = URL.createObjectURL(blob);
          setImage({ path, url: objectUrl });
        },
        (error: unknown) => {
          if (controller.signal.aborted) return;
          if (isAccessFailure(error)) {
            denied();
            return;
          }
          if (error instanceof ApiError && error.status === 410) {
            withdraw.current();
            return;
          }
          setImage({ path, error: true });
        },
      );
    return () => {
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [token, path, attempt, denied]);
  const ready = image.path === path && !!image.url;
  const zoomIndex = steps.indexOf(zoom);
  const button = (
    label: string,
    content: React.ReactNode,
    disabled: boolean,
    action: () => void,
  ) => (
    <button aria-label={label} aria-disabled={disabled} onClick={() => !disabled && action()}>
      {content}
    </button>
  );
  return (
    <div className="tv-viewer">
      <div
        ref={refEl}
        tabIndex={0}
        role="region"
        aria-label="Page images"
        className="tv-viewer-scroll"
      >
        {!path ? (
          <div className="tv-viewer-message">
            <p>We don’t have an image of this page yet</p>
            {file.fcc_url && <p className="tv-small">The FCC’s own copy is linked above</p>}
          </div>
        ) : image.error && image.path === path ? (
          <Failure retry={() => setAttempt((n) => n + 1)} detail={RETRY_EXPLANATION}>
            We couldn’t load this page image
          </Failure>
        ) : ready ? (
          <img
            className="tv-viewer-image"
            src={image.url}
            alt={
              file.copy_status === 'archive'
                ? `Page ${page} of ${file.page_count} of the original station file ${file.name}`
                : `Page ${page} of ${file.page_count} of the approved copy of ${file.name}, with personal details blanked`
            }
            style={{ width: `${zoom}%` }}
          />
        ) : (
          <Busy label={`Loading page ${page} of ${file.page_count}`} />
        )}
      </div>
      {isMobile && zoom !== 100 && (
        <button className="tv-button tv-secondary tv-fit-phone" onClick={() => setZoom(100)}>
          Fit width
        </button>
      )}
      <div className="tv-toolbar" role="group" aria-label="Document controls">
        {button('Previous page', <ViewerIcon path="M15 5 L8 12 L15 19" />, page <= 1, () =>
          setPage(page - 1),
        )}
        <output aria-live="polite">
          {page} / {file.page_count}
        </output>
        {button(
          'Next page',
          <ViewerIcon path="M9 5 L16 12 L9 19" />,
          page >= (file.page_count || 1),
          () => setPage(page + 1),
        )}
        <span className="tv-toolbar-divider" aria-hidden="true" />
        {button('Zoom out', <ViewerIcon path="M5 12 H19" />, !ready || zoomIndex <= 0, () =>
          setZoom(steps[zoomIndex - 1]),
        )}
        {!isMobile && <output>{zoom}%</output>}
        {button(
          'Zoom in',
          <ViewerIcon path="M12 5 V19 M5 12 H19" />,
          !ready || zoomIndex >= steps.length - 1,
          () => setZoom(steps[zoomIndex + 1]),
        )}
        {!isMobile && (
          <>
            <span className="tv-toolbar-divider" aria-hidden="true" />
            {button(
              'Fit width',
              <ViewerIcon size={20} path="M3 12 H21 M7 8 L3 12 L7 16 M17 8 L21 12 L17 16" />,
              !ready,
              () => setZoom(100),
            )}
          </>
        )}
      </div>
      <span className="tv-sr" role="status">
        Zoom {zoom}%
      </span>
    </div>
  );
}

function ViewerIcon({ path, size = 18 }: { path: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d={path}
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function TVFolder({ recordKey, notFound }: { recordKey: string; notFound: () => void }) {
  const read = useTVRead<FolderDetail>(`/folders/${encodeURIComponent(recordKey)}`, true, false);
  useEffect(() => {
    if (read.error instanceof ApiError && read.error.status === 404) notFound();
  }, [read.error, notFound]);
  const data = read.data;
  const feedback = read.error ? (
    <Failure retry={read.retry} detail={RETRY_EXPLANATION}>
      We couldn’t load this folder right now
    </Failure>
  ) : read.loading ? (
    data ? (
      <p role="status">Updating records</p>
    ) : (
      <Busy label="Loading this folder’s files" />
    )
  ) : null;
  if (!data)
    return (
      <>
        <h1 className="tv-record-title">Station folder</h1>
        {feedback}
      </>
    );
  return (
    <>
      <p className="tv-eyebrow">
        {data.year} ·{' '}
        {data.category ? `STATION CATEGORY: ${data.category}` : 'CATEGORY NOT IDENTIFIED'}
      </p>
      <h1 className="tv-record-title">
        {data.station}’s folder named “{data.label}”
      </h1>
      <External href={data.fcc_url} suffix={`for this ${data.station} folder`}>
        This folder on the FCC website
      </External>
      <div className="tv-notice tv-folder-relationship">
        {data.relationship ? (
          <div>
            <p>
              This folder was checked as relating to{' '}
              <Internal href={data.relationship.href}>{data.relationship.label}</Internal> on{' '}
              {centralDate(data.relationship.checked_at)}
            </p>
            <p className="tv-small">Each file carries its own checked connections</p>
          </div>
        ) : (
          <p>No checked connection to a Minnesota committee</p>
        )}
      </div>
      {feedback}
      {!!data.files.length && (
        <p className="tv-folder-count">
          {data.files.length} {data.files.length === 1 ? 'file' : 'files'}
        </p>
      )}
      {data.files.length ? (
        <table
          className="tv-table tv-folder-table tv-folder-records"
          aria-busy={read.loading}
          style={{ opacity: read.loading ? 0.85 : 1 }}
        >
          <thead>
            <tr>
              <th>FILE</th>
              <th>KIND</th>
              <th>SCHEDULED AIRING</th>
              <th>UPLOADED BY THE STATION</th>
              <th>VERSIONS</th>
            </tr>
          </thead>
          <tbody>
            {data.files.map((file) => (
              <tr key={file.key}>
                <td>
                  <a
                    href={tvHref('file', file.key, {
                      version: file.version_id,
                      copy: file.copy_id,
                    })}
                  >
                    {file.name}
                  </a>
                </td>
                <td data-label="Kind">
                  <Kind value={file.kind} />
                </td>
                <td data-label="Scheduled airing">
                  {file.airing_periods.length
                    ? file.airing_periods.map((period) => <div key={period}>{period}</div>)
                    : 'Not checked'}
                </td>
                <td data-label="Uploaded by the station">
                  {file.uploaded_at ? centralDate(file.uploaded_at) : 'Upload date unavailable'}
                </td>
                <td className="tv-folder-versions">
                  {file.version_count}
                  <span className="tv-phone-only">
                    {' '}
                    {file.version_count === 1 ? 'version' : 'versions'}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="tv-notice tv-neutral-notice">No files to show in this folder</p>
      )}
    </>
  );
}
export function TVAgency({ recordKey, notFound }: { recordKey: string; notFound: () => void }) {
  const read = useTVRead<AgencyDetail>(`/agencies/${encodeURIComponent(recordKey)}`, true, false);
  useEffect(() => {
    if (read.error instanceof ApiError && read.error.status === 404) notFound();
  }, [read.error, notFound]);
  const data = read.data;
  const feedback = read.error ? (
    <Failure retry={read.retry} detail={RETRY_EXPLANATION}>
      We couldn’t load the files for this name right now
    </Failure>
  ) : read.loading ? (
    data ? (
      <p role="status">Updating records</p>
    ) : (
      <Busy label="Loading the files that print this name" />
    )
  ) : null;
  if (!data)
    return (
      <>
        <h1 className="tv-record-title">Printed agency name</h1>
        {feedback}
      </>
    );
  return (
    <>
      <h1 className="tv-record-title">Station files printing the agency name “{data.name}”</h1>
      <p className="tv-agency-intro">{PRINTED_NAME_NOTICE}</p>
      {data.unchecked && (
        <p className="tv-small">Includes machine-read agency names marked Not checked</p>
      )}
      {data.payments_href && (
        <p className="tv-agency-payments" style={{ marginTop: 18 }}>
          <Internal href={data.payments_href}>{PRINTED_NAME_PAYMENTS}</Internal>
        </p>
      )}
      {feedback}
      <div
        className="tv-agency-grid"
        aria-busy={read.loading}
        style={{ marginTop: 32, opacity: read.loading ? 0.85 : 1 }}
      >
        {!data.groups.some((group) => group.files.length > 0) && (
          <p className="tv-notice tv-neutral-notice">No files to show for this name</p>
        )}
        {[...new Set(data.groups.map((group) => group.station))].map((station) => (
          <section className="tv-card tv-agency-card" key={station}>
            <div className="tv-agency-card-heading">
              <h2>{station}</h2>
              <span>UPLOADED BY THE STATION</span>
            </div>
            {data.groups
              .filter((group) => group.station === station)
              .map((group) => (
                <div key={group.year}>
                  <h3 className="tv-agency-year">{group.year}</h3>
                  <div className="tv-file-rows tv-rows">
                    {group.files.map((file) => (
                      <a
                        className="tv-row tv-agency-file"
                        key={file.key}
                        href={tvHref('file', file.key, {
                          version: file.version_id,
                          copy: file.copy_id,
                        })}
                      >
                        <div className="tv-row-main">
                          <div className="tv-inline">
                            <Kind value={file.kind} />
                            <strong>{file.name}</strong>
                          </div>
                          <p className="tv-small">
                            {file.category
                              ? `Station category: ${file.category}`
                              : 'Category not identified'}
                            {file.agency_unchecked && ' · Agency name: Not checked'}
                          </p>
                          {file.role && <p className="tv-small">{file.role}</p>}
                          {file.source_changed && (
                            <p className="tv-small">
                              The station file changed; this is the saved copy used for the check
                            </p>
                          )}
                        </div>
                        <span className="tv-small tv-agency-upload">
                          {file.uploaded_at
                            ? centralDate(file.uploaded_at)
                            : 'Upload date unavailable'}
                        </span>
                      </a>
                    ))}
                  </div>
                </div>
              ))}
          </section>
        ))}
      </div>
      <section className="tv-section tv-agency-addresses">
        <h2>Addresses as printed</h2>
        {data.addresses.length ? (
          <div className="tv-address-grid">
            {data.addresses.map((address) => (
              <div className="tv-address" key={address.address}>
                <strong>{address.address}</strong>
                {address.role && <p className="tv-small">Role as printed: {address.role}</p>}
                {address.evidence.map((source) => (
                  <div key={`${source.file_key}-${source.page}`}>
                    <a
                      className="tv-block-link"
                      href={tvHref('file', source.file_key, {
                        version: source.version_id,
                        copy: source.copy_id,
                        page: source.page,
                      })}
                    >
                      {source.file_name}
                      <Arrow />
                    </a>
                    <p className="tv-small">
                      {uploaded(source.uploaded_at)} · page {source.page} · Checked on{' '}
                      {centralDate(source.checked_at)}
                    </p>
                  </div>
                ))}
              </div>
            ))}
          </div>
        ) : (
          <p className="tv-notice tv-neutral-notice">No address has been checked yet</p>
        )}
      </section>
    </>
  );
}
export function TVStation({ recordKey, notFound }: { recordKey: string; notFound: () => void }) {
  const { isMobile } = useResponsive();
  const read = useTVRead<StationDetail>(`/stations/${encodeURIComponent(recordKey)}`);
  useEffect(() => {
    if (read.error instanceof ApiError && read.error.status === 404) notFound();
  }, [read.error, notFound]);
  if (read.loading || read.error)
    return (
      <>
        <h1>{read.data?.call_sign || 'Station'}</h1>
        {read.error ? (
          <Failure retry={read.retry} detail="This is a problem on our side">
            We couldn’t load this station right now
          </Failure>
        ) : (
          <Busy label="Loading station records" />
        )}
      </>
    );
  const data = read.data;
  if (!data) return null;
  // Keep the familiar category order without turning absent counts into invented zeros.
  const knownCategories = [...STATION_CATEGORY_ORDER, ''];
  const categories = [
    ...knownCategories,
    ...orderStationCategories(
      data.years
        .flatMap((year) => year.categories.map((category) => category.name))
        .filter((name) => !knownCategories.includes(name)),
    ),
  ];
  const categoryLabel = (category: string) => category.trim() || 'Not identified';
  return (
    <>
      <h1>{data.call_sign}</h1>
      <div className="tv-metrics tv-station-metrics">
        <Metric label="Station files held" value={data.counts.station_files_held} />
        <Metric label="Station folders" value={data.folder_count} />
        <Metric label="Files with an approved copy" value={data.counts.files_with_approved_copy} />
      </div>
      <div className="tv-inline tv-small tv-station-meta">
        <span>Last successful file copy: {centralDate(data.last_file_copy)}</span>
        <span>Facility ID {data.facility_id}</span>
        <External href={data.fcc_url} suffix={`for ${data.call_sign}`}>
          Public records on the FCC website
        </External>
      </div>
      <p className="tv-small tv-station-copy-note">
        The copy date does not mean every listed file has been copied
      </p>
      <section className="tv-section tv-station-years">
        <h2>Years and categories held</h2>
        {isMobile ? (
          <div className="tv-station-year-cards">
            {!data.years.length && (
              <p className="tv-notice tv-neutral-notice">No folders held for this station</p>
            )}
            {data.years.map((year) => (
              <a
                className="tv-station-year-card"
                key={year.year}
                href={`/money/ads${queryString({ tab: 'folders', station: data.call_sign, year: year.year })}`}
              >
                <div className="tv-station-year-heading">
                  <strong>{year.year}</strong>
                  <span>
                    {year.file_count} {year.file_count === 1 ? 'file' : 'files'}
                  </span>
                </div>
                {categories.map((category) => {
                  const count = year.categories.find((entry) => entry.name === category)?.count;
                  return (
                    <div
                      className="tv-station-category"
                      key={category}
                      data-label={categoryLabel(category)}
                    >
                      <span>{category.trim() || 'Category not identified'}</span>
                      <span>
                        {count === undefined
                          ? 'Unavailable'
                          : `${count} ${count === 1 ? 'folder' : 'folders'}`}
                      </span>
                    </div>
                  );
                })}
              </a>
            ))}
          </div>
        ) : (
          <div className="tv-station-table-wrap">
            <table className="tv-table tv-station-table">
              <thead>
                <tr>
                  <th rowSpan={2}>FOLDER YEAR</th>
                  <th
                    colSpan={categories.length}
                    scope="colgroup"
                    className="tv-station-category-group"
                  >
                    FOLDERS BY STATION CATEGORY
                  </th>
                  <th rowSpan={2}>FILES</th>
                </tr>
                <tr>
                  {categories.map((category) => (
                    <th key={category} scope="col">
                      {categoryLabel(category)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {!data.years.length && (
                  <tr>
                    <td colSpan={categories.length + 2} className="tv-station-empty">
                      No folders held for this station
                    </td>
                  </tr>
                )}
                {data.years.map((year) => (
                  <tr key={year.year}>
                    <td>
                      <a
                        href={`/money/ads${queryString({ tab: 'folders', station: data.call_sign, year: year.year })}`}
                      >
                        {year.year}
                        <span className="tv-sr"> folders at {data.call_sign}</span>
                      </a>
                    </td>
                    {categories.map((category) => (
                      <td key={category} data-label={categoryLabel(category)}>
                        {year.categories.find((entry) => entry.name === category)?.count ??
                          'Unavailable'}
                      </td>
                    ))}
                    <td>{year.file_count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      <section className="tv-section tv-source-gaps">
        <h2>Source gaps</h2>
        <div className="tv-metrics">
          <Metric
            label="Files whose text could not be fully read"
            value={data.counts.text_read_failures}
          />
          <Metric
            label="Files we couldn’t download from the FCC"
            value={data.counts.download_failures}
          />
        </div>
        <p className="tv-small">A file can be in both of these, or in neither</p>
        <div className="tv-count-divider" />
        <Metric label="Folders we couldn’t list" value={data.folder_failures} />
        <p className="tv-small" style={{ marginTop: 24 }}>
          Stations must keep these files for at least 2 years, so older files may be gone from the
          FCC
        </p>
      </section>
    </>
  );
}
