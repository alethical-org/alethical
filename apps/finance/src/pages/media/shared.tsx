import { RECORDS_CHANGED } from '../../api/versionedRead';
import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { formatDay } from '@alethical/shared/committeeMoneyShared';
import { apiPath, type Read } from '../../api/read';
import { useFinanceSession } from '../../auth/session';
import { REQUEST_TIMEOUT_MS } from '../../api/client';
import { useLocation } from '../../router';
import { returnTarget } from '../../returnContext';
import { hrefFor, isBuilt } from '../../routes';
import { Empty, LoadingRows, Refused, Updating } from '../../ui/controls';
import { BackLink, LoadingLine } from '../../ui/parts';
import type { Connection, Source, Version } from './types';
import './media.css';

export const mediaPath = (
  parts: (string | number)[],
  query: Record<string, string | number | null | undefined> = {},
) => apiPath(['finance', 'media-buys', ...parts], query);

const FCC_DAY = /^(\d{2})\/(\d{2})\/(\d{4})\b/;

/** A date as the drawings print it ("Mar 5, 2026"), or "Unavailable". Station upload
 * dates arrive in the FCC's own form ("09/02/2026 11:46 AM"); only the date is kept. */
export const day = (value?: string | null) => {
  const fcc = value ? FCC_DAY.exec(value) : null;
  const iso = fcc ? `${fcc[3]}-${fcc[1]}-${fcc[2]}` : (value ?? null);
  return formatDay(iso) ?? 'Unavailable';
};

/** "Mar 5, 2026, 09:14 CT": when Alethical first saved a version, in Central Time. */
export function savedAt(value: string | null | undefined): string {
  if (!value) return 'Unavailable';
  const at = new Date(value);
  if (Number.isNaN(at.getTime())) return 'Unavailable';
  const date = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Chicago',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(at);
  const time = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Chicago',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(at);
  return `${date}, ${time} CT`;
}

/** "First saved Mar 5, 2026, 09:14 CT": a version's name everywhere it is shown. */
export function versionLabel(version: Version | undefined | null): string {
  return version ? `First saved ${savedAt(version.first_saved_at)}` : '';
}

/** The last part of a folder path ("Political File / 2026 / Local / X" → "X"). */
export function lastSegment(label: string | null | undefined): string {
  return (label ?? '').split(' / ').pop() ?? '';
}

export function plural(count: number, one: string, many: string): string {
  return `${count.toLocaleString('en-US')} ${count === 1 ? one : many}`;
}

/** Checked fact fields in the order the fact menu lists them (Design checkFields):
 * stored field, menu label. */
export const FACT_FIELDS: ReadonlyArray<readonly [string, string]> = [
  ['agency_name', 'Agency name'],
  ['organization_address', 'Organization address'],
  ['document_kind', 'Document kind'],
  ['advertiser', 'Advertiser'],
  ['payer', 'Payer'],
  ['order_number', 'Order number'],
  ['invoice_number', 'Invoice number'],
  ['gross_amount', 'Gross amount'],
  ['net_amount', 'Net amount'],
  ['commission_rate', 'Commission rate'],
  ['commission_amount', 'Commission amount'],
  ['invoice_date', 'Invoice date'],
  ['start_date', 'Start date'],
  ['end_date', 'End date'],
  ['total_order_amount', 'Total order amount'],
  ['paid_amount', 'Paid amount'],
  ['credit_amount', 'Credit amount'],
  ['officer_name', 'Officer name'],
  ['officer_role', 'Officer role'],
  ['principal', 'Principal'],
  ['issue', 'Issue'],
  ['scheduled_airing', 'Scheduled airing'],
  ['billing_recipient', 'Billing recipient'],
  ['requested_by', 'Requested by'],
];
export function fieldLabel(field: string): string {
  return FACT_FIELDS.find(([key]) => key === field)?.[1] ?? '';
}
/** The label the server prints for a checked field (tv_ads._fact_kind), so a
 * saved fact can be matched to its field. */
const PRINTED_KIND: Record<string, string> = {
  billing_recipient: 'Bill to',
  requested_by: 'Requested by',
};
export function serverKind(field: string): string {
  const words = field.replaceAll('_', ' ');
  return PRINTED_KIND[field] ?? words.charAt(0).toUpperCase() + words.slice(1);
}
export function fieldOfKind(kind: string): string {
  return FACT_FIELDS.find(([field]) => serverKind(field) === kind)?.[0] ?? '';
}

/** Connection types (Design connectionTypes): the server's kind, the label. */
export const CONNECTION_TYPES: ReadonlyArray<readonly [string, string]> = [
  ['committee', 'Committee'],
  ['candidate', 'Candidate'],
  ['principal', 'Lobbying principal'],
  ['election', 'Election'],
  ['issue', 'Issue'],
  ['related_document', 'Related TV station file'],
  ['expense', 'Reported campaign expense'],
];
export function connectionLabel(kind: string): string {
  return CONNECTION_TYPES.find(([key]) => key === kind)?.[1] ?? kind.replaceAll('_', ' ');
}

/** A TV station file's address: its key, the exact version and the page. */
export function fileHref(key: string, version?: string | null, page?: number | null) {
  return hrefFor(
    'station-file',
    { key },
    { version: version ?? null, page: page && page > 1 ? String(page) : null },
  );
}

/** Where a checked connection's record opens in Finance, or null for none. */
export function connectionPath(connection: Connection): string | null {
  const target = connection.target;
  if (!target || connection.status !== 'checked') return null;
  if (target.kind === 'file') return fileHref(target.id, target.version);
  if (target.kind === 'committee' || target.kind === 'candidate' || target.kind === 'principal')
    return isBuilt(target.kind) ? hrefFor(target.kind, { id: target.id }) : null;
  return null;
}

/** "TV station files copied {date}" lines: 1 line when every station shares a
 * date, else 1 line per date naming its stations. */
export function copiedLines(stations: Source[]): string[] {
  const byDate = new Map<string, string[]>();
  for (const station of stations) {
    const date = day(station.last_file_copy);
    byDate.set(date, [...(byDate.get(date) ?? []), station.call_sign]);
  }
  if (byDate.size <= 1) return [...byDate.keys()].map((date) => `TV station files copied ${date}`);
  return [...byDate].map(([date, names]) => `${names.join(', ')}: TV station files copied ${date}`);
}

/** The page frame: the return link (from the earlier page, else the given
 * default) above the page's own content. */
export function MediaPage({
  fallback,
  children,
  footer,
}: {
  fallback: { to: string; name: string };
  children: ReactNode;
  footer?: ReactNode;
}) {
  const location = useLocation();
  const back = returnTarget(location.search) ?? fallback;
  return (
    <main id="main" className="f-page mb-page mb-record">
      <div className="f-content">
        <BackLink to={back.to} name={back.name} />
        {children}
      </div>
      {footer}
    </main>
  );
}

/** A record the server does not hold: its own heading and next step. */
export function NotHeld({ title, children }: { title: string; children: string }) {
  return (
    <section className="mb-not-held">
      <h1 tabIndex={-1}>{title}</h1>
      <p>{children}</p>
    </section>
  );
}

export function LoadingBox() {
  return (
    <div className="mb-loading">
      <LoadingLine>Loading…</LoadingLine>
    </div>
  );
}

export function ReadState<T>({ read, noun = 'results' }: { read: Read<T>; noun?: string }) {
  return (
    <>
      {read.loading && <LoadingRows />}
      {read.updating && <Updating />}
      {read.failed && (
        <Refused onRetry={read.retry} retrying={read.pending}>
          {read.changed
            ? RECORDS_CHANGED
            : `We couldn’t load these ${noun}${noun === 'results' ? '. This is a problem on our side.' : read.data ? '.' : ''}${read.data ? ' Previous results are shown.' : ''}`}
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
        type="button"
        className="f-btn f-btn-secondary"
        aria-disabled={busy || page <= 1 || undefined}
        onClick={() => !busy && page > 1 && onChange(page - 1)}
      >
        Previous
      </button>
      <span className="f-num" aria-live="polite">
        Page {page} of {pages}
      </span>
      <button
        type="button"
        className="f-btn f-btn-secondary"
        aria-disabled={busy || page >= pages || undefined}
        onClick={() => !busy && page < pages && onChange(page + 1)}
      >
        Next
      </button>
    </nav>
  );
}

/** Previous and next page buttons around "Page n of N". */
export function PageSteps({
  page,
  pages,
  onChange,
}: {
  page: number;
  pages: number;
  onChange: (page: number) => void;
}) {
  return (
    <div role="group" aria-label="Page" className="mb-steps">
      <button
        type="button"
        className="mb-icon-btn"
        aria-label="Previous page"
        disabled={page <= 1}
        onClick={() => onChange(page - 1)}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path
            d="M15 5 L8 12 L15 19"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
      <output aria-live="polite" className="mb-steps-label f-num">
        Page {page} of {pages}
      </output>
      <button
        type="button"
        className="mb-icon-btn"
        aria-label="Next page"
        disabled={page >= pages}
        onClick={() => onChange(page + 1)}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path
            d="M9 5 L16 12 L9 19"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
    </div>
  );
}

/** The original page image, read with the account header. Never put a token in
 * a URL or keep an image after its source version or signed-in account changes. */
export function PageImage({
  fileKey,
  version,
  page,
  alt,
  failure,
  imageStyle,
}: {
  fileKey: string;
  version: string;
  page: number;
  alt: string;
  /** The failure's words, its retry button's label, and whether the button sits
   * inside the alert (TV station file) or under it (Check TV station files). */
  failure: { text: string; retry: string; inside?: boolean };
  imageStyle?: CSSProperties;
}) {
  const { apiBaseUrl, accessToken } = useFinanceSession();
  const [attempt, setAttempt] = useState(0);
  const key = `${apiBaseUrl}|${accessToken}|${fileKey}|${version}|${page}|${attempt}`;
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
      .then(async (response) => {
        if (!response.ok || !response.headers.get('content-type')?.startsWith('image/'))
          throw new Error('Image unavailable');
        const blob = await response.blob();
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
  }, [key, apiBaseUrl, accessToken, fileKey, version, page]);
  const current = image?.key === key ? image : null;
  if (current?.failed && failure.inside)
    return (
      <div className="mb-image-failed">
        <Refused onRetry={() => setAttempt((value) => value + 1)}>{failure.text}</Refused>
      </div>
    );
  if (current?.failed)
    return (
      <div className="mb-image-failed">
        <Refused>{failure.text}</Refused>
        <button
          type="button"
          className="f-btn f-btn-secondary f-btn-small"
          onClick={() => setAttempt((value) => value + 1)}
        >
          {failure.retry}
        </button>
      </div>
    );
  return (
    <div className="mb-image" role={current?.url ? undefined : 'img'} aria-label={alt}>
      {!current && <span className="f-visually-hidden">Loading page image</span>}
      {current?.url && (
        <img
          key={key}
          src={current.url}
          alt={alt}
          style={imageStyle}
          onError={() => {
            setImage((value) => (value?.key === key ? { key, url: null, failed: true } : value));
          }}
        />
      )}
    </div>
  );
}
