import { useCallback, useState } from 'react';
import { useRead } from '../api/read';
import { Link, useLocation } from '../router';
import { withFrom } from '../returnContext';
import { hrefFor, type RouteMatch } from '../routes';
import { useAddressState } from '../ui/addressState';
import { Dropdown, EvidencePanel, type Evidence } from '../ui/controls';
import { Frame, PageImage, Pager, ReadState, connectionPath, day, mediaPath } from './media/shared';
import type { Connection, Fact, FileDetail, Sources } from './media/types';

const LABELS: Record<string, string> = {
  advertiser: 'Advertiser',
  agency_name: 'Agency name',
  organization_address: 'Organization address',
  amount: 'Amount',
  invoice_date: 'Invoice date',
  airing_start: 'Scheduled airing starts',
  airing_end: 'Scheduled airing ends',
  invoice_number: 'Invoice number',
  contract_number: 'Contract number',
  candidate: 'Candidate',
  election: 'Election',
  order_date: 'Order date',
  document_kind: 'Document kind',
  payer: 'Payer',
};
export function factLabel(kind: string) {
  return LABELS[kind] ?? kind.replaceAll('_', ' ');
}
export function StationFile({ match }: { match: RouteMatch }) {
  const location = useLocation();
  const here = location.pathname + location.search;
  const [state, setState] = useAddressState({ version: '', page: '1' });
  const read = useRead<FileDetail>(
    mediaPath(['files', match.params.key], { version: state.version }),
  );
  const sources = useRead<Sources>(mediaPath(['sources']));
  const data = read.data;
  const [evidence, setEvidence] = useState<Evidence | null>(null);
  const close = useCallback(() => setEvidence(null), []);
  const page = Math.min(data?.page_count || 1, Math.max(1, Number(state.page) || 1));
  const version = data?.version_id ?? '';
  const selected = data?.versions.find((v) => v.id === version);
  const facts = data ? [...data.facts, ...data.dates].filter((f) => f.version_id === version) : [];
  const connections = data?.connections.filter((c) => c.version_id === version) ?? [];
  function showEvidence(item: Fact | Connection) {
    setEvidence({
      title: 'Station-file evidence',
      authority: data?.station ?? 'TV station file',
      rows: [
        { label: 'File', value: data?.name ?? '' },
        { label: 'Source version', value: item.version_id },
        { label: 'Page', value: String(item.page ?? 'Unavailable') },
      ],
      quote: item.quote ?? undefined,
      checked:
        item.status === 'withdrawn'
          ? `Withdrawn on ${day(item.withdrawn_at)}`
          : `Checked on ${day(item.checked_at)}`,
      sourceHref: hrefFor(
        'station-file',
        { key: match.params.key },
        { version: item.version_id, page: item.page ? String(item.page) : null },
      ),
      sourceLabel: 'View page image',
    });
  }
  return (
    <Frame title={data?.name ?? 'Station file'} eyebrow="Station file" sources={sources.data}>
      <ReadState read={read} noun="station-file details" />
      {data && (
        <>
          <dl className="mb-meta">
            <div>
              <dt>Station</dt>
              <dd>{data.station}</dd>
            </div>
            <div>
              <dt>Folder</dt>
              <dd>
                <Link to={withFrom(hrefFor('station-folder', { id: data.folder.key }), here)}>
                  {data.folder.label}
                </Link>
              </dd>
            </div>
            <div>
              <dt>Station upload</dt>
              <dd>{day(selected?.uploaded_at ?? data.uploaded_at)}</dd>
            </div>
            <div>
              <dt>First saved</dt>
              <dd>{day(selected?.first_saved_at)}</dd>
            </div>
          </dl>
          <Dropdown
            name="Saved versions"
            value={version}
            options={data.versions.map((v) => ({
              value: v.id,
              label: `Saved ${day(v.first_saved_at)}${v.id === data.current_source_version ? ' · Current source' : ''}`,
            }))}
            onChange={(v) => {
              setEvidence(null);
              setState({ version: v, page: '1' });
            }}
          />
          <div className="mb-two">
            <section aria-label="Page image">
              <h2 className="f-label">Page image</h2>
              {data.page_count > 0 ? (
                <>
                  <PageImage fileKey={data.key} version={version} page={page} />
                  <Pager
                    page={page}
                    pages={data.page_count}
                    onChange={(p) => setState({ page: String(p) })}
                  />
                  <p className="mb-note">
                    Page {page} of {data.page_count} · Saved {day(selected?.first_saved_at)}
                  </p>
                </>
              ) : (
                <p>Page images are unavailable</p>
              )}
            </section>
            <div>
              <section className="mb-card">
                <h2>Checked facts</h2>
                <p className="mb-note">
                  A check applies only to the file version it cites. Selected version: saved{' '}
                  {day(selected?.first_saved_at)}
                </p>
                {facts.length ? (
                  <ul className="mb-facts">
                    {facts.map((f) => (
                      <li key={f.id}>
                        <strong>{factLabel(f.kind)}</strong>
                        <p>
                          {f.value}
                          {f.qualifier ? ` · ${f.qualifier}` : ''}
                          {f.role ? ` · ${f.role}` : ''}
                        </p>
                        <p className="mb-note">
                          {f.status === 'withdrawn'
                            ? `Withdrawn on ${day(f.withdrawn_at)}`
                            : `Checked on ${day(f.checked_at)}`}{' '}
                          · Page {f.page ?? 'Unavailable'}
                        </p>
                        <button className="f-btn f-btn-secondary" onClick={() => showEvidence(f)}>
                          View evidence
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p>No checked facts for this version</p>
                )}
              </section>
              <section className="mb-card">
                <h2>Related records</h2>
                {connections.length ? (
                  <ul className="mb-facts">
                    {connections.map((c) => {
                      const to = connectionPath(c);
                      return (
                        <li key={c.id}>
                          {to && c.status === 'checked' ? (
                            <Link to={withFrom(to, here)}>{c.label}</Link>
                          ) : (
                            <strong>{c.label}</strong>
                          )}
                          <p>{c.role}</p>
                          <p className="mb-note">
                            {c.status === 'withdrawn'
                              ? `Withdrawn on ${day(c.withdrawn_at)}`
                              : `Checked on ${day(c.checked_at)}`}
                          </p>
                          <button className="f-btn f-btn-secondary" onClick={() => showEvidence(c)}>
                            View evidence
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                ) : (
                  <p>No checked connections for this version</p>
                )}
                <p className="mb-note">
                  A checked connection names its role and carries its own quoted evidence. A
                  candidate merely named on a document is kept separate from a candidate checked as
                  the advertiser or payer.
                </p>
              </section>
            </div>
          </div>
          <section className="mb-card mb-section">
            <h2>Machine-read text</h2>
            <p className="mb-note">Not checked</p>
            <details>
              <summary className="mb-evidence">Show machine-read text</summary>
              <p className="mb-note">
                Saved {day(selected?.first_saved_at)} · Page {page} of {data.page_count} · reading
                errors are possible; this text helps you search but is not a checked account
              </p>
              <pre className="mb-text">
                {data.pages.find((p) => p.number === page)?.text ||
                  'Machine-read text is not held in this copy'}
              </pre>
            </details>
          </section>
        </>
      )}
      <EvidencePanel evidence={evidence} onClose={close} />
    </Frame>
  );
}
