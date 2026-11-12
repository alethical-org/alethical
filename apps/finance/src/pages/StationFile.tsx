import { useFinanceSession } from '../auth/session';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useRead } from '../api/read';
import { Link, useLocation } from '../router';
import { withFrom } from '../returnContext';
import { hrefFor, isBuilt, type RouteMatch } from '../routes';
import { useAddressState } from '../ui/addressState';
import { Refused } from '../ui/controls';
import { Arrow, WithArrow } from '../ui/parts';
import { StationEvidencePanel, type StationEvidence } from './media/evidence';
import { MenuButton } from './media/menu';
import {
  LoadingBox,
  MediaPage,
  NotHeld,
  PageImage,
  PageSteps,
  connectionLabel,
  connectionPath,
  day,
  fileHref,
  lastSegment,
  mediaPath,
  savedAt,
  versionLabel,
} from './media/shared';
import { NotCheckedIcon } from './StationRecords';
import type { Connection, Fact, FileDetail } from './media/types';

/** The document's width at 100% (8.5 in at 96 px per inch). */
const PAPER = 816;
const ZOOMS = ['fit', '1', '1.5', '2'] as const;
type Zoom = (typeof ZOOMS)[number];

/** Where Check TV station files opens for 1 check's action on this file. */
export function checkActionHref(key: string, version: string, check: string, action: string) {
  return hrefFor('check-station-files', {}, { file: key, version, check, action });
}

function CheckIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="9" stroke="#0E6A82" strokeWidth="2" />
      <path
        d="M8 12.5 L10.8 15.2 L16 9.5"
        stroke="#0E6A82"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ZoomIcon({ plus }: { plus: boolean }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d={plus ? 'M6 12 H18 M12 6 V18' : 'M6 12 H18'}
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** A TV station file: 1 exact saved version, its page images, and the checks made
 * on that version (TV Station File drawing; Rounds 22 to 26, 37, 41, 44). */
export function StationFile({ match }: { match: RouteMatch }) {
  const location = useLocation();
  const here = location.pathname + location.search;
  const key = match.params.key;
  const [state, setState] = useAddressState({ version: '', page: '1', new: '' });
  const read = useRead<FileDetail>(mediaPath(['files', key], { version: state.version }));
  // A link naming a version that is not held never opens another one silently:
  // the current version is read only to offer it.
  const missing = !!state.version && read.notFound;
  const current = useRead<FileDetail>(missing ? mediaPath(['files', key]) : null);
  const data = missing ? null : read.data;
  const head = data ?? (missing ? current.data : null);
  const [evidence, setEvidence] = useState<StationEvidence | null>(null);
  const close = useCallback(() => setEvidence(null), []);
  const [zoom, setZoom] = useState<Zoom>('fit');
  const [textOpen, setTextOpen] = useState(false);
  const [width, setWidth] = useState(0);
  const viewer = useRef<HTMLDivElement | null>(null);
  const observer = useRef<ResizeObserver | null>(null);
  const viewerRef = useCallback((element: HTMLDivElement | null) => {
    observer.current?.disconnect();
    viewer.current = element;
    if (element && typeof ResizeObserver !== 'undefined') {
      observer.current = new ResizeObserver(() => setWidth(element.clientWidth));
      observer.current.observe(element);
      setWidth(element.clientWidth);
    }
  }, []);
  useEffect(() => () => observer.current?.disconnect(), []);

  const pages = data?.page_count ?? 0;
  const page = Math.min(Math.max(1, pages), Math.max(1, Math.trunc(Number(state.page)) || 1));
  const version = data?.version_id ?? '';
  const selected = data?.versions.find((v) => v.id === version);
  const versionText = versionLabel(selected);
  const isCurrent = !!data && version === data.current_source_version;
  const checking = useFinanceSession().canEdit !== false && isBuilt('check-station-files');
  const newIds = state.new ? state.new.split(',') : [];
  const facts = data
    ? [...data.facts, ...data.dates].filter(
        (f) => f.status === 'checked' && f.version_id === version,
      )
    : [];
  const related = data
    ? data.connections.filter((c) => c.status === 'checked' && c.version_id === version)
    : [];
  const saved = newIds.filter(
    (id) => facts.some((f) => f.id === id) || related.some((c) => c.id === id),
  ).length;
  const pageText = (number: number) =>
    data?.pages.find((p) => p.number === number)?.text?.trim()
      ? data.pages.find((p) => p.number === number)!.text
      : null;

  function open(
    item: Fact | Connection,
    rows: { label: string; value: string }[],
    title: string,
    isFact: boolean,
  ) {
    if (!data) return;
    const cited = item.page ?? page;
    setState({ page: String(cited) });
    setEvidence({
      title,
      authority: `${data.station} public inspection file`,
      rows,
      quote: item.quote ?? undefined,
      page: item.page != null ? String(item.page) : undefined,
      checked: `Checked on ${day(item.checked_at)}`,
      machineText: item.page != null ? pageText(item.page) : null,
      actions:
        isCurrent && checking
          ? [
              ...(isFact
                ? [
                    {
                      label: 'Correct fact',
                      href: withFrom(checkActionHref(key, version, item.id, 'correct'), here),
                    },
                  ]
                : []),
              {
                label: 'Withdraw check',
                href: withFrom(checkActionHref(key, version, item.id, 'withdraw'), here),
              },
            ]
          : [],
    });
  }
  function viewFact(fact: Fact) {
    if (!data) return;
    open(
      fact,
      [
        { label: 'File', value: data.name },
        { label: 'Source version', value: versionText },
        { label: 'Station', value: data.station },
        { label: 'Fact', value: fact.kind },
        { label: 'Value', value: fact.value ?? '' },
        ...(fact.role ? [{ label: 'Printed role', value: fact.role }] : []),
      ],
      `${fact.kind}: ${fact.value ?? ''}`,
      true,
    );
  }
  function viewConnection(connection: Connection) {
    if (!data) return;
    const type = connectionLabel(connection.kind);
    const record = connection.label ?? '';
    open(
      connection,
      [
        { label: 'File', value: data.name },
        { label: 'Source version', value: versionText },
        { label: 'Connection', value: type },
        { label: 'Record', value: record },
        ...(connection.role ? [{ label: 'Role', value: connection.role }] : []),
      ],
      `${type}: ${record}`,
      false,
    );
  }

  const fallback = head
    ? { to: hrefFor('station-folder', { id: head.folder.key }), name: 'TV station folder' }
    : { to: hrefFor('media-buys'), name: 'Media buys' };
  const fit = width ? width / PAPER : 0;
  const zoomAt = ZOOMS.indexOf(zoom);
  const imageWidth = zoom === 'fit' ? '100%' : `${PAPER * Number(zoom)}px`;
  const fromHere = new URLSearchParams(location.search).get('from');
  const currentHref = head
    ? (() => {
        const href = fileHref(key, head.current_source_version);
        return fromHere ? withFrom(href, fromHere) : href;
      })()
    : '';

  return (
    <MediaPage fallback={fallback}>
      {(read.notFound && !state.version) || (missing && current.notFound) ? (
        <NotHeld title="This file is no longer available">
          No TV station file with this name is in the current copy. Open the TV station folder for
          the files held.
        </NotHeld>
      ) : null}
      {(read.loading || (missing && current.loading)) && <LoadingBox />}
      {((read.failed && !read.data) || (missing && current.failed)) && (
        <div className="mb-section-body">
          <Refused
            onRetry={missing ? current.retry : read.retry}
            retrying={missing ? current.pending : read.pending}
          >
            Couldn’t load TV station file
          </Refused>
        </div>
      )}
      {head && (
        <>
          <header className="mb-file-head">
            <div>
              <span className="mb-badge">TV STATION FILE</span>
              <h1 tabIndex={-1} className="mb-title mb-title-file">
                {head.name}
              </h1>
              <dl className="mb-meta">
                <div>
                  <dt>Station</dt>
                  <dd>
                    <Link to={withFrom(hrefFor('station', { id: head.station }), here)}>
                      {head.station}
                    </Link>
                  </dd>
                </div>
                <div>
                  <dt>Folder</dt>
                  <dd>
                    <Link to={withFrom(hrefFor('station-folder', { id: head.folder.key }), here)}>
                      {[head.year, head.category, lastSegment(head.folder.label)]
                        .filter((part) => part !== null && part !== '')
                        .join(' · ')}
                    </Link>
                  </dd>
                </div>
                <div>
                  <dt>Station upload</dt>
                  <dd className="mb-strong" data-missing={!head.uploaded_at || undefined}>
                    {head.uploaded_at ? day(head.uploaded_at) : 'Upload date unavailable'}
                  </dd>
                </div>
              </dl>
            </div>
            {data && isCurrent && checking && (
              <Link
                id="check-link"
                className="f-btn mb-check-link"
                to={withFrom(
                  hrefFor(
                    'check-station-files',
                    {},
                    { file: key, version, page: page > 1 ? String(page) : null },
                  ),
                  here,
                )}
              >
                <span>
                  <WithArrow stroke="#fff">Check this file</WithArrow>
                </span>
              </Link>
            )}
          </header>
          {missing && (
            <div role="status" className="mb-notice">
              <span>This version is not held</span>
              <Link className="f-dest" to={currentHref}>
                <span>
                  <WithArrow>Open the current version</WithArrow>
                </span>
              </Link>
            </div>
          )}
          {data && (
            <div className="mb-file-grid">
              <section aria-label="Document" className="mb-doc">
                <div role="toolbar" aria-label="Document controls" className="mb-toolbar">
                  <MenuButton
                    value={version}
                    listLabel="Saved versions, newest first, Central Time"
                    align="right"
                    options={data.versions.map((v) => ({
                      value: v.id,
                      label: versionLabel(v),
                      note:
                        v.id === data.current_source_version
                          ? 'Current successful copy'
                          : 'Earlier contents',
                    }))}
                    onChange={(next) => {
                      setEvidence(null);
                      setState({ version: next, page: '1', new: '' });
                    }}
                  >
                    <span className="mb-version-label">
                      <span>Saved versions:</span>
                      <span>{savedAt(selected?.first_saved_at)}</span>
                    </span>
                  </MenuButton>
                  {pages > 0 && (
                    <div className="mb-toolbar-tools">
                      <PageSteps
                        page={page}
                        pages={pages}
                        onChange={(next) => setState({ page: String(next) })}
                      />
                      <div role="group" aria-label="Zoom" className="mb-steps">
                        <button
                          type="button"
                          className="mb-icon-btn"
                          aria-label="Zoom out"
                          disabled={zoomAt === 0}
                          onClick={() => setZoom(ZOOMS[Math.max(0, zoomAt - 1)])}
                        >
                          <ZoomIcon plus={false} />
                        </button>
                        <output aria-live="polite" className="mb-zoom-label f-num">
                          {zoom === 'fit'
                            ? `Fit ${Math.round((fit || 1) * 100)}%`
                            : `${Number(zoom) * 100}%`}
                        </output>
                        <button
                          type="button"
                          className="mb-icon-btn"
                          aria-label="Zoom in"
                          disabled={zoomAt === ZOOMS.length - 1}
                          onClick={() => setZoom(ZOOMS[Math.min(ZOOMS.length - 1, zoomAt + 1)])}
                        >
                          <ZoomIcon plus />
                        </button>
                      </div>
                    </div>
                  )}
                </div>
                {pages > 0 ? (
                  <div
                    ref={viewerRef}
                    className="mb-viewer"
                    tabIndex={zoom === 'fit' ? -1 : 0}
                    aria-label="Page image; scroll sideways to see the whole page"
                  >
                    <PageImage
                      fileKey={key}
                      version={version}
                      page={page}
                      alt={`Page ${page} of ${pages} of the original TV station file ${data.name}`}
                      failure={{
                        text: 'Couldn’t load page image. This is a problem on our side.',
                        retry: 'Try again',
                        inside: true,
                      }}
                      imageStyle={{ width: imageWidth, maxWidth: 'none' }}
                    />
                  </div>
                ) : (
                  <p className="mb-no-pages">Page images are unavailable</p>
                )}
              </section>
              <div className="mb-side">
                <section aria-labelledby="facts-heading" className="mb-card">
                  <h2 id="facts-heading" tabIndex={-1}>
                    Checked facts
                  </h2>
                  <p className="mb-version-line">
                    For the version {versionText.charAt(0).toLowerCase() + versionText.slice(1)}
                  </p>
                  <div role="status" className="f-visually-hidden">
                    {saved === 1 ? '1 check saved' : saved > 1 ? `${saved} checks saved` : ''}
                  </div>
                  {facts.length === 0 ? (
                    <div className="mb-dashed">No checked facts for this version</div>
                  ) : (
                    <dl className="mb-facts">
                      {facts.map((fact) => (
                        <div
                          key={fact.id}
                          className="mb-fact"
                          data-new={newIds.includes(fact.id) || undefined}
                        >
                          <dt>{fact.kind}</dt>
                          <dd>{fact.value}</dd>
                          <span className="mb-fact-checked">
                            <CheckIcon />
                            <span>
                              Checked on {day(fact.checked_at)} · Page {fact.page ?? 'Unavailable'}
                            </span>
                          </span>
                          <button
                            type="button"
                            id={`vf-${fact.id}`}
                            className="mb-text-btn"
                            onClick={() => viewFact(fact)}
                          >
                            View evidence
                          </button>
                        </div>
                      ))}
                    </dl>
                  )}
                </section>
                <section aria-labelledby="related-heading" className="mb-card">
                  <h2 id="related-heading">Related records</h2>
                  {related.length === 0 ? (
                    <div className="mb-dashed mb-dashed-tight">
                      No checked connections for this version
                    </div>
                  ) : (
                    <ul className="mb-related">
                      {related.map((connection) => {
                        const to = connectionPath(connection);
                        const note = `Checked as ${connectionLabel(connection.kind).toLowerCase()}${
                          connection.role ? ` · ${connection.role}` : ''
                        } · this version · Checked on ${day(connection.checked_at)}`;
                        const label = connection.label ?? connectionLabel(connection.kind);
                        return (
                          <li
                            key={connection.id}
                            data-new={newIds.includes(connection.id) || undefined}
                          >
                            {to ? (
                              <Link className="mb-link-row" to={withFrom(to, here)}>
                                <span>
                                  <span className="mb-link-name">{label}</span>
                                  <span className="mb-link-note">{note}</span>
                                </span>
                                <Arrow />
                              </Link>
                            ) : (
                              <div className="mb-plain-row">
                                <span>
                                  <span className="mb-link-name">{label}</span>
                                  <span className="mb-link-note">{note}</span>
                                </span>
                              </div>
                            )}
                            <button
                              type="button"
                              id={`vr-${connection.id}`}
                              className="mb-text-btn"
                              onClick={() => viewConnection(connection)}
                            >
                              View evidence
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </section>
                <section aria-labelledby="text-heading" className="mb-card">
                  <div className="mb-text-head">
                    <div>
                      <h2 id="text-heading">Machine-read text</h2>
                      <span className="mb-not-checked">
                        <NotCheckedIcon />
                        Not checked
                      </span>
                    </div>
                    <button
                      type="button"
                      className="f-btn f-btn-secondary mb-toggle"
                      aria-expanded={textOpen}
                      onClick={() => setTextOpen((was) => !was)}
                    >
                      {textOpen ? 'Hide text' : 'Show text'}
                      <svg
                        width="16"
                        height="16"
                        viewBox="0 0 24 24"
                        fill="none"
                        aria-hidden="true"
                        className={textOpen ? 'mb-caret-up' : undefined}
                      >
                        <path
                          d="M6 9 L12 15 L18 9"
                          stroke="currentColor"
                          strokeWidth="2.2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                    </button>
                  </div>
                  {textOpen && (
                    <>
                      <p className="mb-text-meta">
                        {versionText} · Page {page} of {Math.max(1, pages)} · reading errors are
                        possible; this text helps you search but is not a checked account
                      </p>
                      <pre className="mb-text">
                        {pageText(page) ?? 'Machine-read text not held for this page'}
                      </pre>
                    </>
                  )}
                </section>
              </div>
            </div>
          )}
        </>
      )}
      <StationEvidencePanel evidence={evidence} onClose={close} />
    </MediaPage>
  );
}
