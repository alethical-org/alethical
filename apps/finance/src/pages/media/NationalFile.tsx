import { useEffect, useRef, useState } from 'react';
import { useRead } from '../../api/read';
import { useFinanceSession } from '../../auth/session';
import { useLocation } from '../../router';
import { hrefFor } from '../../routes';
import { MediaPage, ReadState, mediaPath } from './shared';

interface NationalDetail {
  title: string;
  service: string;
  station_name: string;
  state: string | null;
  folder_path: string;
  file_id: string;
  has_text: boolean;
  content_hash: string;
  page_count: number | null;
  source_url: string | null;
}

interface OriginalText {
  pages: Array<{ page: number; text: string; method: string }>;
}

const services: Record<string, string> = {
  TV: 'TV',
  FM: 'FM radio',
  AM: 'AM radio',
  CABLE: 'Cable',
  DBS: 'Satellite TV',
  SDARS: 'Satellite radio',
};

export function NationalFile({ fileKey }: { fileKey: string }) {
  const { search } = useLocation();
  const version = new URLSearchParams(search).get('version');
  const session = useFinanceSession();
  // Drop the pending open operation and any visible text when the file, saved
  // version or signed-in account changes.
  return (
    <NationalDetailView
      key={JSON.stringify([fileKey, version, session.accessToken])}
      fileKey={fileKey}
      version={version}
    />
  );
}

function NationalDetailView({ fileKey, version }: { fileKey: string; version: string | null }) {
  const session = useFinanceSession();
  const path = ['national-files', fileKey];
  const read = useRead<NationalDetail>(mediaPath(path, { version }));
  const data = read.data;
  const [textOpen, setTextOpen] = useState(false);
  const [opening, setOpening] = useState<'ready' | 'busy' | 'error'>('ready');
  const controller = useRef<AbortController | null>(null);
  useEffect(
    () => () => {
      controller.current?.abort();
      controller.current = null;
    },
    [],
  );
  const text = useRead<OriginalText>(
    textOpen && data ? mediaPath([...path, 'text'], { version: data.content_hash }) : null,
  );

  async function openOriginal() {
    if (!data || controller.current) return;
    const request = new AbortController();
    controller.current = request;
    setOpening('busy');
    const timer = window.setTimeout(() => request.abort(), 120_000);
    try {
      const route = mediaPath([...path, 'original'], { version: data.content_hash });
      const response = await fetch(`${session.apiBaseUrl}/api/v1/${route}`, {
        headers: { Authorization: `Bearer ${session.accessToken}` },
        cache: 'no-store',
        redirect: 'error',
        signal: request.signal,
      });
      if (response.status === 401 || response.status === 403) session.retry();
      if (!response.ok || response.headers.get('content-type') !== 'application/pdf')
        throw new Error('PDF unavailable');
      const pdf = await response.blob();
      if (request.signal.aborted) return;
      const url = URL.createObjectURL(pdf);
      setOpening('ready');
      window.location.assign(url);
      // The browser owns the open document after navigation.
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch {
      if (controller.current === request) setOpening('error');
    } finally {
      clearTimeout(timer);
      if (controller.current === request) controller.current = null;
    }
  }
  return (
    <MediaPage
      fallback={{
        to: hrefFor('media-buys', {}, { tab: 'national' }),
        name: 'National FCC files',
      }}
    >
      <ReadState read={read} noun="files" />
      {data && (
        <>
          <header className="mb-file-head">
            <div>
              <span className="mb-badge">National FCC file</span>
              <h1 tabIndex={-1} className="mb-title mb-title-file">
                {data.title}
              </h1>
              <dl className="mb-meta">
                <div>
                  <dt>Provider</dt>
                  <dd>{data.station_name}</dd>
                </div>
                <div>
                  <dt>Service</dt>
                  <dd>{services[data.service] ?? data.service}</dd>
                </div>
                {data.state && (
                  <div>
                    <dt>State</dt>
                    <dd>{data.state}</dd>
                  </div>
                )}
                <div>
                  <dt>FCC folder</dt>
                  <dd>{data.folder_path}</dd>
                </div>
                {data.page_count != null && (
                  <div>
                    <dt>Pages</dt>
                    <dd>{data.page_count}</dd>
                  </div>
                )}
              </dl>
            </div>
          </header>
          <section className="mb-section">
            <h2>Original document</h2>
            <div className="mb-section-body">
              <button
                type="button"
                className="f-btn"
                aria-disabled={opening === 'busy'}
                onClick={() => void openOriginal()}
              >
                {opening === 'busy'
                  ? 'Opening…'
                  : opening === 'error'
                    ? 'Try opening PDF again'
                    : 'Open original PDF'}
              </button>
              {opening === 'error' && <p role="alert">Couldn’t open the original PDF</p>}
              {data.source_url && (
                <p>
                  <a href={data.source_url}>View the FCC source</a>
                </p>
              )}
            </div>
          </section>
          {data.has_text && (
            <section className="mb-section">
              <h2>Document text</h2>
              <div className="mb-section-body">
                <button
                  type="button"
                  className="f-btn f-btn-secondary"
                  aria-expanded={textOpen}
                  onClick={() => setTextOpen(!textOpen)}
                >
                  {textOpen ? 'Hide text' : 'Show text'}
                </button>
                {textOpen && (
                  <>
                    <p>Not checked against the original</p>
                    <ReadState read={text} noun="pages" />
                    {text.data?.pages.map((p) => (
                      <section key={p.page}>
                        <h3>Page {p.page}</h3>
                        <p className="mb-national-text">
                          {p.text || 'No readable text on this page'}
                        </p>
                      </section>
                    ))}
                  </>
                )}
              </div>
            </section>
          )}
        </>
      )}
    </MediaPage>
  );
}
