import { useCallback, useEffect, useState } from 'react';
import { apiPath, useRead } from '../api/read';
import { Link, navigate, useLocation } from '../router';
import { returnTarget, withFrom } from '../returnContext';
import { useAddressState } from '../ui/addressState';
import { useBand } from '../ui/band';
import { Dropdown, EvidencePanel, Refused, Tabs, Updating, type Evidence } from '../ui/controls';
import { BackLink, WithArrow } from '../ui/parts';
import { useView } from '../ui/view';
import { ConnectionsMap } from './connections/Map';
import {
  combinePages,
  committeeEdgeHref,
  countLine,
  edgeAmount,
  edgeEvidence,
  edgePeriod,
  loadedLine,
  moreLabel,
  nodeHref,
  nodeKind,
  nodeSub,
  PAGE_SIZE,
  RELATIONSHIPS,
  sourceLabel,
  type ConnectionsPage,
  type GraphEdge,
  type GraphNode,
} from './connections/data';
import './connections/connections.css';

const RELATION_KEYS = Object.keys(RELATIONSHIPS);

/** A node's page as opened from 1 relationship: a committee opens on the tab,
 * year and name that hold this relationship's records. */
function linkFor(node: GraphNode, edge: GraphEdge, other: GraphNode) {
  return node.kind === 'committee' ? committeeEdgeHref(edge, node, other) : nodeHref(node);
}

/** The words of a selected name's link (drawing: "Open profile", or "View
 * payments" for a printed name). A printed agency name has no drawn words. */
function nodeLinkLabel(node: GraphNode) {
  if (!node.unresolved) return 'Open profile';
  return node.role === 'agency' ? null : 'View payments';
}

/**
 * Money connections (Money Connections drawing; Rounds 27 Oct, 34, 36, 37,
 * 38, 41, 43). Direct recorded relationships, 100 per page, with "Show {n}
 * more connections"; Map (the default at every band) and Table read the same
 * loaded set. Nothing here adds money across relationships.
 */
export function MoneyConnections() {
  const location = useLocation(),
    here = location.pathname + location.search;
  const back = returnTarget(location.search);
  const band = useBand();
  const [address, setAddress] = useAddressState({
    q: '',
    year: '',
    rel: '',
    focus: '',
    edge: '',
  });
  const [view, setView] = useView('view');
  const [typed, setTyped] = useState(address.q);
  useEffect(() => setTyped(address.q), [address.q]);
  const q = address.q.trim().slice(0, 200);
  const year =
    /^\d{4}$/.test(address.year) && +address.year >= 1900 && +address.year <= 2200
      ? address.year
      : '';
  const relation = RELATION_KEYS.includes(address.rel) ? address.rel : '';
  const focus = address.focus;
  const scope = JSON.stringify([q, year, relation, focus]);
  const [wanted, setWanted] = useState({ scope, count: 1 });
  const count = wanted.scope === scope ? wanted.count : 1;
  const offset = (count - 1) * PAGE_SIZE;
  const read = useRead<ConnectionsPage>(
    apiPath(['finance', 'connections'], {
      q,
      year,
      relationship: relation || 'all',
      focus,
      limit: PAGE_SIZE,
      offset,
    }),
    { keepPrevious: true, acceptData: (data) => data.state !== 'unavailable' },
  );
  // The pages held for 1 scope. A new scope keeps the last scope's set on screen
  // until its own first page arrives, then replaces it (keepPrevious).
  const [held, setHeld] = useState<{ scope: string; pages: ConnectionsPage[] } | null>(null);
  const arrived =
    read.data && !read.loading && !read.updating && !read.failed && read.data.offset === offset
      ? read.data
      : null;
  useEffect(() => {
    if (!arrived) return;
    setHeld((prev) => {
      const pages = prev && prev.scope === scope ? prev.pages.slice(0, count - 1) : [];
      if (pages.length !== count - 1) return prev;
      return { scope, pages: [...pages, arrived] };
    });
  }, [arrived, scope, count]);
  const current = held?.scope === scope;
  const shown = held ? combinePages(held.pages) : null;
  const last = held?.pages.at(-1) ?? null;
  const loaded = last ? last.offset + last.edges.length : 0;
  const remaining = current && last ? Math.max(0, last.total - loaded) : 0;
  const nodes = shown?.nodes ?? new Map<string, GraphNode>();
  const edges = shown?.edges ?? [];

  const [evidence, setEvidence] = useState<Evidence | null>(null);
  const closeEvidence = useCallback(() => setEvidence(null), []);
  const selectedNode = focus ? nodes.get(focus) : undefined;
  const selectedEdge = !selectedNode ? edges.find((edge) => edge.id === address.edge) : undefined;

  /** This page's address with a relationship selected, so a return restores it. */
  function hereWith(edgeId: string) {
    const params = new URLSearchParams(location.search);
    params.set('edge', edgeId);
    params.delete('focus');
    return `${location.pathname}?${params.toString()}`;
  }
  function openSource(edge: GraphEdge) {
    const next = edgeEvidence(edge, nodes.get(edge.from)!, nodes.get(edge.to)!);
    if (edge.source.file_key && next.sourceHref) navigate(withFrom(next.sourceHref, here));
    else setEvidence(next);
  }
  const pickNode = (key: string) => setAddress({ focus: key, edge: '' });
  const pickEdge = (id: string) => setAddress({ edge: id, focus: '' });

  const firstLoad = !held;
  const failedFirst = firstLoad && read.failed;
  const empty = current && edges.length === 0;
  const mapView = view === 'chart';
  const summary = countLine(edges, nodes);

  // The selection panel's content (drawing: selected name, or selected line).
  let selection: {
    kind: string;
    tone: 'committee' | 'printed' | 'plain';
    title: string;
    sub: string;
    href: string | null;
    hrefLabel: string | null;
    rows: Array<{ edge: GraphEdge; dir: string; other: GraphNode }>;
  } | null = null;
  if (selectedNode) {
    const label = nodeLinkLabel(selectedNode);
    const href = label ? nodeHref(selectedNode) : null;
    selection = {
      kind: nodeKind(selectedNode),
      tone: selectedNode.unresolved
        ? 'printed'
        : selectedNode.kind === 'committee'
          ? 'committee'
          : 'plain',
      title: selectedNode.label,
      sub: nodeSub(selectedNode),
      href: href && withFrom(href, here),
      hrefLabel: href ? label : null,
      rows: edges
        .filter((edge) => edge.from === selectedNode.key || edge.to === selectedNode.key)
        .map((edge) => {
          const out = edge.from === selectedNode.key;
          return {
            edge,
            dir: `${RELATIONSHIPS[edge.relationship] ?? edge.relationship} · ${out ? 'to' : 'from'}`,
            other: nodes.get(out ? edge.to : edge.from)!,
          };
        }),
    };
  } else if (selectedEdge) {
    const from = nodes.get(selectedEdge.from)!,
      to = nodes.get(selectedEdge.to)!;
    const href = linkFor(to, selectedEdge, from);
    selection = {
      kind: RELATIONSHIPS[selectedEdge.relationship] ?? selectedEdge.relationship,
      tone: 'plain',
      title: `${from.label} to ${to.label}`,
      sub: sourceLabel(selectedEdge.source.dataset),
      href: href && withFrom(href, hereWith(selectedEdge.id)),
      hrefLabel: href ? (to.kind === 'committee' ? 'Open committee' : 'Open record') : null,
      rows: [
        {
          edge: selectedEdge,
          dir: RELATIONSHIPS[selectedEdge.relationship] ?? selectedEdge.relationship,
          other: to,
        },
      ],
    };
  }

  const yearOptions = [
    ...new Set([...(year ? [Number(year)] : []), ...(last?.years ?? read.data?.years ?? [])]),
  ].sort((a, b) => b - a);

  return (
    <main id="main" className="f-page">
      <div className="f-content mc-page">
        {back && <BackLink to={back.to} name={back.name} />}
        <h1 tabIndex={-1} className="f-page-title mc-title">
          Money connections
        </h1>
        <form
          className="mc-search"
          role="search"
          onSubmit={(e) => {
            e.preventDefault();
            setAddress({ q: typed.trim(), focus: '', edge: '' });
          }}
        >
          <label htmlFor="conn-q" className="f-visually-hidden">
            Find a person, organization or committee
          </label>
          <input
            className="f-field"
            id="conn-q"
            type="search"
            maxLength={200}
            autoComplete="off"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            placeholder={
              band === 'phone' ? 'Name or committee' : 'Find a person, organization or committee'
            }
          />
          <button type="submit" className="f-btn">
            Search
          </button>
        </form>
        <div className="mc-controls">
          <div className="mc-filters">
            <Dropdown
              name="Year"
              value={year}
              options={[
                { value: '', label: 'All years' },
                ...yearOptions.map((value) => ({ value: String(value), label: String(value) })),
              ]}
              onChange={(value) => setAddress({ year: value, focus: '', edge: '' })}
            />
            <Dropdown
              name="Relationship"
              value={relation}
              options={[
                { value: '', label: 'All relationships' },
                ...RELATION_KEYS.map((value) => ({ value, label: RELATIONSHIPS[value] })),
              ]}
              onChange={(value) => setAddress({ rel: value, focus: '', edge: '' })}
            />
            <button
              type="button"
              className="f-btn f-btn-secondary"
              onClick={() => {
                setTyped('');
                setAddress({ q: '', year: '', rel: '', focus: '', edge: '' });
              }}
            >
              Reset view
            </button>
          </div>
          <Tabs
            label="View"
            value={view}
            tabs={[
              { value: 'chart', label: 'Map' },
              { value: 'table', label: 'Table' },
            ]}
            onChange={setView}
          />
        </div>

        <section aria-label="Connections" className="mc-results" aria-busy={read.pending}>
          {firstLoad && !read.failed && (
            <div role="status" aria-busy="true" className="mc-loading">
              <span className="f-spinner" aria-hidden="true" />
              Loading connections…
            </div>
          )}
          {failedFirst && (
            <Refused onRetry={read.retry} retrying={read.pending}>
              We couldn’t load these connections
            </Refused>
          )}
          {held && !current && read.updating && <Updating />}
          {held && !current && read.failed && (
            <Refused onRetry={read.retry} retrying={read.pending}>
              We couldn’t update these results
            </Refused>
          )}
          {held && (
            <div className="mc-loaded">
              {empty && (
                <div className="f-empty-box">
                  {focus
                    ? 'This record is not held in the connections'
                    : 'No connections held for this selection'}
                </div>
              )}
              {edges.length > 0 && mapView && (
                <div className="mc-layout" data-band={band}>
                  <div className="mc-card mc-map-card">
                    <ConnectionsMap
                      nodes={[...new Set(edges.flatMap((e) => [e.from, e.to]))].map((key) =>
                        nodes.get(key)!,
                      )}
                      edges={edges}
                      selectedNode={selectedNode?.key ?? ''}
                      selectedEdge={selectedEdge?.id ?? ''}
                      onNode={pickNode}
                      onEdge={pickEdge}
                    />
                    <p className="mc-count" role="status">
                      {summary}
                    </p>
                  </div>
                  <aside
                    className="mc-selection mc-card"
                    aria-label="Selection details"
                    aria-live="polite"
                  >
                    {!selection ? (
                      <p className="mc-hint">
                        Select a name or a line to see its connections. Every connection is also
                        listed in Table.
                      </p>
                    ) : (
                      <>
                        <div className="mc-chosen">
                          <span className="mc-tag" data-tone={selection.tone}>
                            {selection.kind}
                          </span>
                          <div className="mc-chosen-title">{selection.title}</div>
                          {selection.sub && <div className="mc-note">{selection.sub}</div>}
                          {selection.href && selection.hrefLabel && (
                            <Link to={selection.href} className="f-dest mc-open">
                              <WithArrow>{selection.hrefLabel}</WithArrow>
                            </Link>
                          )}
                        </div>
                        <ul className="mc-chosen-list">
                          {selection.rows.map(({ edge, dir, other }) => {
                            const amount = edgeAmount(edge);
                            return (
                              <li key={edge.id}>
                                <span className="mc-note">{dir}</span>
                                <span className="mc-other">{other.label}</span>
                                {amount && (
                                  <span
                                    className="mc-amount"
                                    data-withheld={edge.amount_state !== 'reported' || undefined}
                                  >
                                    {amount}
                                  </span>
                                )}
                                <span className="mc-note f-num">{edgePeriod(edge)}</span>
                                <span className="mc-actions">
                                  <button
                                    type="button"
                                    className="mc-text-button"
                                    onClick={() => pickNode(other.key)}
                                  >
                                    Show connections
                                  </button>
                                  <button
                                    type="button"
                                    className="mc-text-button mc-source"
                                    onClick={() => openSource(edge)}
                                  >
                                    View source
                                  </button>
                                </span>
                              </li>
                            );
                          })}
                        </ul>
                      </>
                    )}
                  </aside>
                </div>
              )}
              {edges.length > 0 && !mapView && (
                <>
                  <div
                    className="mc-table-wrap mc-card"
                    tabIndex={0}
                    role="region"
                    aria-label="Money connections table"
                  >
                    <table className="mc-table">
                      <caption className="f-visually-hidden">Money connections</caption>
                      <thead>
                        <tr>
                          <th scope="col">FROM</th>
                          <th scope="col">RELATIONSHIP</th>
                          <th scope="col">TO</th>
                          <th scope="col" className="mc-right">
                            AMOUNT
                          </th>
                          <th scope="col">PERIOD</th>
                          <th scope="col">SOURCE</th>
                        </tr>
                      </thead>
                      <tbody>
                        {edges.map((edge) => {
                          const from = nodes.get(edge.from)!,
                            to = nodes.get(edge.to)!;
                          const amount = edgeAmount(edge, { heading: true });
                          return (
                            <tr key={edge.id} data-selected={edge.id === address.edge || undefined}>
                              <td>
                                <NodeCell
                                  node={from}
                                  href={linkFor(from, edge, to)}
                                  from={hereWith(edge.id)}
                                  onOpen={() => setAddress({ edge: edge.id, focus: '' })}
                                />
                              </td>
                              <td className="mc-muted">
                                {RELATIONSHIPS[edge.relationship] ?? edge.relationship}
                              </td>
                              <td>
                                <NodeCell
                                  node={to}
                                  href={linkFor(to, edge, from)}
                                  from={hereWith(edge.id)}
                                  onOpen={() => setAddress({ edge: edge.id, focus: '' })}
                                />
                              </td>
                              <td
                                className="mc-money"
                                data-withheld={
                                  (amount && edge.amount_state !== 'reported') || undefined
                                }
                              >
                                {amount || <span className="f-visually-hidden">No amount</span>}
                              </td>
                              <td className="mc-muted f-num">{edgePeriod(edge)}</td>
                              <td className="mc-muted">
                                <span className="mc-block">{sourceLabel(edge.source.dataset)}</span>
                                <button
                                  type="button"
                                  className="mc-text-button mc-source"
                                  onClick={() => openSource(edge)}
                                >
                                  View source
                                </button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                  <p className="mc-count mc-count-after" role="status">
                    {summary}
                  </p>
                </>
              )}
              {edges.length > 0 && (
                <p className="mc-grounding">
                  Each connection is one recorded relationship with its own period and source. A
                  connection does not show that one payment funded another.
                </p>
              )}
            </div>
          )}
        </section>
        {held && current && (
          <div className="mc-notices">
            {shown && shown.unavailable.length > 0 && (
              <div role="status" className="mc-notice mc-notice-partial">
                <span>
                  Some sources are unavailable ·{' '}
                  {shown.unavailable.map((source) => sourceLabel(source)).join(', ')}
                </span>
                <button
                  type="button"
                  className="f-btn f-btn-secondary f-btn-small"
                  aria-disabled={read.pending || undefined}
                  onClick={() => !read.pending && read.retry()}
                >
                  Try again
                </button>
              </div>
            )}
            {count > 1 && read.failed && (
              <div role="alert" className="mc-notice mc-notice-failed">
                <span>Some connections could not be loaded</span>
                <button
                  type="button"
                  className="f-btn f-btn-secondary f-btn-small"
                  aria-disabled={read.pending || undefined}
                  onClick={() => !read.pending && read.retry()}
                >
                  Try again
                </button>
              </div>
            )}
            {(remaining > 0 || loadedLine(loaded, last?.total ?? 0)) && (
              <div className="mc-more">
                {remaining > 0 && !(count > 1 && read.failed) && (
                  <button
                    type="button"
                    className="f-btn f-btn-secondary f-btn-small"
                    aria-disabled={read.pending || undefined}
                    aria-busy={read.pending || undefined}
                    onClick={() =>
                      !read.pending && setWanted({ scope, count: held.pages.length + 1 })
                    }
                  >
                    {read.pending && <span className="f-spinner" aria-hidden="true" />}
                    {moreLabel(remaining)}
                  </button>
                )}
                {loadedLine(loaded, last?.total ?? 0) && (
                  <span className="mc-loaded-line">{loadedLine(loaded, last?.total ?? 0)}</span>
                )}
              </div>
            )}
          </div>
        )}
        <EvidencePanel evidence={evidence} onClose={closeEvidence} />
      </div>
    </main>
  );
}

function NodeCell({
  node,
  href,
  from,
  onOpen,
}: {
  node: GraphNode;
  href: string | null;
  from: string;
  onOpen: () => void;
}) {
  const sub = nodeSub(node);
  return (
    <>
      {href ? (
        <Link to={withFrom(href, from)} className="mc-name-link" onClick={onOpen}>
          {node.label}
        </Link>
      ) : (
        <span className="mc-name">{node.label}</span>
      )}
      {sub && <span className="mc-sub">{sub}</span>}
    </>
  );
}
