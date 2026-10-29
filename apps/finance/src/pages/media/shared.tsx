import { useEffect, useState, type ReactNode } from 'react';
import { formatDay } from '@alethical/shared/committeeMoneyShared';
import { apiPath, type Read } from '../../api/read';
import { useFinanceSession } from '../../auth/session';
import { REQUEST_TIMEOUT_MS } from '../../api/client';
import { Link, useLocation } from '../../router';
import { returnTarget, withFrom } from '../../returnContext';
import { hrefFor } from '../../routes';
import { Empty, LoadingRows, Refused, Updating } from '../../ui/controls';
import { Arrow, BackLink, SourcesAndUpdates } from '../../ui/parts';
import type { Connection, FileRow, Sources } from './types';
import './media.css';

export const mediaPath = (
  parts: (string | number)[],
  query: Record<string, string | number | null | undefined> = {},
) => apiPath(['finance', 'media-buys', ...parts], query);
export const day = (value?: string | null) => formatDay(value ?? null) ?? 'Unavailable';
export function Frame({
  title,
  eyebrow,
  children,
  sources,
}: {
  title: string;
  eyebrow?: string;
  children: ReactNode;
  sources?: Sources | null;
}) {
  const location = useLocation();
  const back = returnTarget(location.search);
  return (
    <main id="main" className="f-page mb-page">
      <div className="f-content">
        {back && <BackLink to={back.to} name={back.name} />}
        {eyebrow && <p className="f-label">{eyebrow}</p>}
        <h1 tabIndex={-1} className="f-page-title">
          {title}
        </h1>
        {children}
      </div>
      {sources && (
        <SourcesAndUpdates
          groups={sources.stations.map((s) => ({
            source: s.call_sign,
            items: [
              <a key="source" href={s.fcc_url} target="_blank" rel="noreferrer">
                FCC public inspection file
              </a>,
              `Station files copied ${day(s.last_file_copy)}`,
              `Folder listing read ${day(s.last_list_check)}`,
            ],
          }))}
        />
      )}
    </main>
  );
}
export function ReadState<T>({ read, noun = 'results' }: { read: Read<T>; noun?: string }) {
  return (
    <>
      {read.loading && <LoadingRows />}
      {read.updating && <Updating />}
      {read.failed && (
        <Refused onRetry={read.retry} retrying={read.pending}>
          We couldn’t load these {noun}. This is a problem on our side.
          {read.data ? ' Previous results are shown.' : ''}
        </Refused>
      )}
      {read.notFound && <Empty title="This record is no longer available" />}
    </>
  );
}
export function Pager({
  page,
  pages,
  onChange,
  busy = false,
}: {
  page: number;
  pages: number;
  onChange: (page: number) => void;
  busy?: boolean;
}) {
  if (pages < 2) return null;
  return (
    <nav className="mb-pager" aria-label="Pages">
      <button
        className="f-btn f-btn-secondary"
        disabled={busy || page <= 1}
        onClick={() => onChange(page - 1)}
      >
        Previous
      </button>
      <span className="f-num" aria-live="polite">
        Page {page} of {pages}
      </span>
      <button
        className="f-btn f-btn-secondary"
        disabled={busy || page >= pages}
        onClick={() => onChange(page + 1)}
      >
        Next
      </button>
    </nav>
  );
}
export function FileList({ files, here }: { files: FileRow[]; here: string }) {
  return files.length ? (
    <ul className="mb-list">
      {files.map((f) => (
        <li key={f.key}>
          <Link className="mb-row" to={withFrom(hrefFor('station-file', { key: f.key }), here)}>
            <span>
              <strong>{f.label || f.name}</strong>
              <small>
                {f.station} · {f.folder_label} · {f.version_count} saved{' '}
                {f.version_count === 1 ? 'version' : 'versions'}
                {f.agency_unchecked ? ' · Name source: Not checked' : ''}
              </small>
            </span>
            <span>
              Station upload
              <br />
              {day(f.uploaded_at)}
            </span>
            <Arrow />
          </Link>
        </li>
      ))}
    </ul>
  ) : (
    <Empty title="No files to show" />
  );
}
export function connectionPath(connection: Connection) {
  const t = connection.target;
  if (!t) return null;
  if (t.kind === 'file') return hrefFor('station-file', { key: t.id }, { version: t.version });
  if (t.kind === 'committee' || t.kind === 'candidate' || t.kind === 'principal')
    return hrefFor(t.kind, { id: t.id });
  return null;
}
/** Private originals require the account header. Never put a token in a URL or
 * keep an image after its source version or signed-in account changes. */
export function PageImage({
  fileKey,
  version,
  page,
}: {
  fileKey: string;
  version: string;
  page: number;
}) {
  const { apiBaseUrl, accessToken } = useFinanceSession();
  const [attempt, setAttempt] = useState(0);
  const key = `${accessToken}|${fileKey}|${version}|${page}`;
  const [image, setImage] = useState<{ key: string; url: string | null; failed: boolean } | null>(
    null,
  );
  useEffect(() => {
    const controller = new AbortController();
    let live = true;
    let objectUrl: string | null = null;
    const timer = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    void fetch(
      `${apiBaseUrl}/api/v1/${mediaPath(['files', fileKey, 'pages', page], { version })}`,
      {
        headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {},
        cache: 'no-store',
        signal: controller.signal,
      },
    )
      .then(async (r) => {
        if (!r.ok || !r.headers.get('content-type')?.startsWith('image/'))
          throw new Error('Image unavailable');
        const blob = await r.blob();
        if (!live) return;
        objectUrl = URL.createObjectURL(blob);
        setImage({ key, url: objectUrl, failed: false });
      })
      .catch(() => {
        if (live) setImage({ key, url: null, failed: true });
      })
      .finally(() => window.clearTimeout(timer));
    return () => {
      live = false;
      window.clearTimeout(timer);
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [key, apiBaseUrl, accessToken, fileKey, version, page, attempt]);
  const current = image?.key === key ? image : null;
  return (
    <div className="mb-image">
      {!current && <LoadingRows label="Loading page image" />}
      {current?.failed && (
        <Refused onRetry={() => setAttempt((n) => n + 1)}>
          We couldn’t load this page image. This is a problem on our side.
        </Refused>
      )}
      {current?.url && <img src={current.url} alt={`Original station file, page ${page}`} />}
    </div>
  );
}
