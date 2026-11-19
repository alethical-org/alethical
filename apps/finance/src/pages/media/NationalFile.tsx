import { useEffect, useState } from 'react';
import { useRead } from '../../api/read';
import { useFinanceSession } from '../../auth/session';
import { navigate, useLocation } from '../../router';
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
  const path = ['national-files', fileKey];
  const read = useRead<NationalDetail>(mediaPath(path, { version }));
  const data = read.data;
  const [textOpen, setTextOpen] = useState(false);
  const address = useLocation();
  const showingPdf = address.searchParams.get('original') === '1';
  const text = useRead<OriginalText>(
    textOpen && data ? mediaPath([...path, 'text'], { version: data.content_hash }) : null,
  );

  function toggleOriginal() {
    const params = new URLSearchParams(address.search);
    params.delete('original');
    const fileAddress = address.pathname + (params.size ? '?' + params : '');
    if (!showingPdf) {
      params.set('original', '1');
      // This entry remembers its parent through a reload or session refresh.
      navigate(address.pathname + '?' + params, { state: { nationalOriginalFrom: fileAddress } });
    } else if (window.history.state?.nationalOriginalFrom === fileAddress) {
      window.history.back();
    } else {
      // A copied viewer address can return to its file without leaving Finance.
      navigate(fileAddress, { replace: true });
    }
  }

  return (
    <MediaPage fallback={{ to: hrefFor('media-buys'), name: 'Media buys' }}>
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
                aria-expanded={showingPdf}
                onClick={toggleOriginal}
              >
                {showingPdf ? 'Close PDF' : 'Open original PDF'}
              </button>
              {showingPdf && (
                <OriginalPdf
                  key={data.content_hash}
                  route={mediaPath([...path, 'original'], { version: data.content_hash })}
                  title={data.title}
                  version={data.content_hash}
                />
              )}
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

function OriginalPdf({ route, title, version }: { route: string; title: string; version: string }) {
  const { apiBaseUrl, accessToken, retry } = useFinanceSession();
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const request = new AbortController();
    let active = true;
    let heldUrl: string | undefined;
    const timer = window.setTimeout(() => request.abort(), 120_000);
    async function fetchOriginal() {
      if (!active) return;
      try {
        const response = await fetch(`${apiBaseUrl}/api/v1/${route}`, {
          headers: { Authorization: `Bearer ${accessToken}` },
          cache: 'no-store',
          redirect: 'error',
          signal: request.signal,
        });
        if (!active) return;
        if (response.status === 401 || response.status === 403) retry();
        if (!response.ok || response.headers.get('content-type') !== 'application/pdf')
          throw new Error('PDF unavailable');
        const pdf = await response.blob();
        if (!active) return;
        heldUrl = URL.createObjectURL(pdf);
        setUrl(heldUrl);
      } catch {
        if (active) setFailed(true);
      } finally {
        window.clearTimeout(timer);
      }
    }
    queueMicrotask(() => void fetchOriginal());
    return () => {
      active = false;
      request.abort();
      window.clearTimeout(timer);
      if (heldUrl) URL.revokeObjectURL(heldUrl);
    };
  }, [apiBaseUrl, accessToken, route, retry, attempt]);

  if (failed)
    return (
      <>
        <p role="alert">Couldn’t open the original PDF</p>
        <button
          type="button"
          className="f-btn"
          onClick={() => {
            setFailed(false);
            setAttempt((value) => value + 1);
          }}
        >
          Try opening PDF again
        </button>
      </>
    );
  if (!url) return <p role="status">Opening PDF…</p>;
  const stem = Array.from(title.replace(/\.pdf$/i, '').replace(/[^\p{L}\p{M}\p{N} ()_.,-]+/gu, '-'))
    .slice(0, 60)
    .join('')
    .replace(/^[ .-]+|[ .-]+$/g, '');
  return (
    <>
      <a
        className="f-btn mb-pdf-save"
        href={url}
        download={`${stem || 'fcc-' + version.slice(0, 16)}.pdf`}
      >
        Save PDF
      </a>
      <iframe className="mb-pdf-frame" src={url} title={`Original PDF: ${title}`} />
    </>
  );
}
