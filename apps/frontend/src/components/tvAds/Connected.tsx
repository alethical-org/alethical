import React, { useCallback, useState } from 'react';
import { useAuth } from '../../providers/AuthProvider';
import { queryString, tvHref, uploaded, type BrowseResult, type ConnectionResult } from './api';
import { useTVAdAccess } from './useTVAdAccess';
import {
  AdminMarker,
  Arrow,
  Busy,
  Failure,
  FileRows,
  Kind,
  TVSession,
  tvStyles,
  useTVRead,
} from './pieces';
import { highlight } from './Landing';

export interface CardProps {
  kind: 'committee' | 'candidate' | 'principal' | 'election' | 'race' | 'name';
  target: string;
  name?: string;
  searchOnly?: boolean;
  scopeLabel?: string;
  hideEmpty?: boolean;
}
/** No space, loading title, or request to a TV read endpoint before fresh permission. */
export function TVAdConnectionCard(props: CardProps) {
  const access = useTVAdAccess();
  const { accessToken, user } = useAuth();
  const [denied, setDenied] = useState(false);
  const reject = useCallback(() => setDenied(true), []);
  if (access.state !== 'allowed' || !accessToken || denied) return null;
  return (
    <TVSession.Provider
      key={`${user?.id}:${accessToken}`}
      value={{ token: accessToken, denied: reject }}
    >
      <ConnectionCard key={`${props.kind}:${props.target}`} {...props} />
    </TVSession.Provider>
  );
}
function ConnectionCard({ kind, target, name, searchOnly, scopeLabel, hideEmpty }: CardProps) {
  const read = useTVRead<ConnectionResult>(
    `/connections${queryString({ kind, target })}`,
    !searchOnly,
  );
  const [all, setAll] = useState(
    () =>
      typeof window !== 'undefined' &&
      new URLSearchParams(window.location.search).get('tvads') === 'all',
  );
  const toggle = () => {
    const next = !all;
    setAll(next);
    const url = new URL(window.location.href);
    if (next) url.searchParams.set('tvads', 'all');
    else url.searchParams.delete('tvads');
    window.history.replaceState(
      window.history.state,
      '',
      `${url.pathname}${url.search}${url.hash}`,
    );
  };
  const groups = read.data?.groups || [{ label: '', files: read.data?.files || [] }];
  const count = groups.reduce((sum, group) => sum + group.files.length, 0);
  if (hideEmpty && !read.loading && !read.error && !count) return null;
  return (
    <div className="tv" style={{ padding: 0, marginTop: 24 }}>
      <style>{tvStyles}</style>
      <section className="tv-card">
        <div className="tv-inline">
          <h2 style={{ margin: 0 }}>TV ad records</h2>
          <AdminMarker />
        </div>
        {scopeLabel && (
          <p className="tv-small" style={{ marginBottom: 16 }}>
            {scopeLabel}
          </p>
        )}
        {searchOnly ? (
          <NameSearch name={name || target} />
        ) : read.loading && !read.data ? (
          <Busy label="Loading TV ad records" />
        ) : read.error ? (
          <Failure retry={read.retry} />
        ) : read.data?.agency_key && kind === 'name' ? (
          <a className="tv-block-link" href={tvHref('agency', read.data.agency_key)}>
            This exact name also appears on {read.data.exact_name_count} station files
            <Arrow />
          </a>
        ) : count ? (
          <>
            {groups.map((group, index) => (
              <div key={`${group.label}-${index}`}>
                {group.label && <h3 style={{ margin: '18px 0 12px' }}>{group.label}</h3>}
                <FileRows files={all ? group.files : group.files.slice(0, 3)} />
              </div>
            ))}
            {groups.some((group) => group.files.length > 3) && (
              <button className="tv-link-button" aria-expanded={all} onClick={toggle}>
                {all ? 'Show fewer' : `Show all ${count}`}
              </button>
            )}
          </>
        ) : name ? (
          <NameSearch name={name} />
        ) : (
          <p className="tv-small">No checked connections to TV ad records</p>
        )}
      </section>
    </div>
  );
}
function NameSearch({ name }: { name: string }) {
  return (
    <>
      <a className="tv-block-link" href={`/money/ads${queryString({ q: name })}`}>
        Search TV ad records for this name
        <Arrow />
      </a>
      <p className="tv-small">A matching name alone does not establish identity</p>
    </>
  );
}

export function TVAdSearchGroup({ query }: { query: string }) {
  const access = useTVAdAccess();
  const { user, accessToken } = useAuth();
  const [denied, setDenied] = useState(false);
  const reject = useCallback(() => setDenied(true), []);
  if (access.state !== 'allowed' || !accessToken || denied || !query.trim()) return null;
  return (
    <TVSession.Provider
      key={`${user?.id}:${accessToken}`}
      value={{ token: accessToken, denied: reject }}
    >
      <div className="tv" style={{ padding: 0 }}>
        <style>{tvStyles}</style>
        <SearchGroup query={query} />
      </div>
    </TVSession.Provider>
  );
}
function SearchGroup({ query }: { query: string }) {
  const read = useTVRead<BrowseResult>(
    `/browse${queryString({ tab: 'folders', q: query, page: 1 })}`,
  );
  const data = read.data;
  const matching = data?.q === query;
  return (
    <section className="tv-card">
      <div className="tv-inline">
        <h2 style={{ margin: 0 }}>TV ad records</h2>
        <AdminMarker />
      </div>
      {read.loading && !data ? <Busy /> : null}
      {!!read.error && <Failure retry={read.retry}>We couldn’t search TV ad records</Failure>}
      {data && (
        <>
          {(!matching || read.loading) && (
            <p className="tv-small" role="status">
              Still showing the earlier results for “{data.q}”
            </p>
          )}
          <p className="tv-result-count">
            {data.capped ? 'MORE THAN 500' : data.total.toLocaleString('en-US')} FILES
          </p>
          {data.rows.length ? (
            <div className="tv-rows">
              {data.rows.slice(0, 3).map((file) => (
                <a
                  key={file.key}
                  className="tv-row"
                  href={tvHref('file', file.key, {
                    q: data.q,
                    version: file.version_id,
                    copy: file.copy_id,
                    from: `/money/ads${queryString({ q: data.q })}`,
                  })}
                >
                  <div className="tv-row-main">
                    <p className="tv-eyebrow">
                      {file.station} · {file.year} ·{' '}
                      {file.category
                        ? `STATION CATEGORY: ${file.category}`
                        : 'CATEGORY NOT IDENTIFIED'}
                    </p>
                    <strong>{file.label}</strong>
                    <Kind value={file.kind} />
                    <p className="tv-small">{uploaded(file.uploaded_at)}</p>
                    {file.excerpt && (
                      <p>
                        <b>{file.match_label}: </b>
                        {highlight(file.excerpt, data.q)}
                      </p>
                    )}
                    {file.text_match && (
                      <p className="tv-small" style={{ color: '#7a5a12' }}>
                        Not checked
                      </p>
                    )}
                  </div>
                  <Arrow />
                </a>
              ))}
            </div>
          ) : (
            <p>No TV ad records found for “{data.q}”</p>
          )}
          <p className="tv-small" style={{ marginTop: 16 }}>
            Station files matching this name, not confirmed identities
          </p>
          <a className="tv-block-link" href={`/money/ads${queryString({ q: data.q })}`}>
            Search all TV ad records
            <Arrow />
          </a>
        </>
      )}
    </section>
  );
}
