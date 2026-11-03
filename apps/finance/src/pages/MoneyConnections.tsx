import { useCallback, useEffect, useState } from 'react';
import { formatCount } from '@alethical/shared/moneyLanding';
import { apiPath, useRead } from '../api/read';
import { Link, navigate, useLocation } from '../router';
import { returnTarget, withFrom } from '../returnContext';
import { useAddressState } from '../ui/addressState';
import { useBand } from '../ui/band';
import { Dropdown, Empty, EvidencePanel, Tabs, type Evidence } from '../ui/controls';
import { BackLink } from '../ui/parts';
import { Pager, ReadState } from './media/shared';
import { ConnectionsMap } from './connections/Map';
import {
  edgeAmount,
  edgeEvidence,
  edgePeriod,
  nodeHref,
  nodeKind,
  RELATIONSHIPS,
  type ConnectionsPage,
  type GraphEdge,
  type GraphNode,
} from './connections/data';
import './connections/connections.css';

export const CONNECTIONS_PAGE_SIZE = 50;
export function MoneyConnections() {
  const location = useLocation(),
    here = location.pathname + location.search;
  const back = returnTarget(location.search);
  const band = useBand();
  // Choose a first view once. Explicit choices remain in the address on resize/return.
  const [initialView] = useState(() => (band === 'phone' ? 'Table' : 'Map'));
  const [state, setState] = useAddressState({
    q: '',
    year: '',
    rel: '',
    focus: '',
    page: '1',
    view: '',
  });
  const view = state.view === 'Map' || state.view === 'Table' ? state.view : initialView;
  const [typed, setTyped] = useState(state.q);
  useEffect(() => setTyped(state.q), [state.q]);
  const page = Math.max(1, Math.trunc(Number(state.page) || 1));
  const relation = state.rel in RELATIONSHIPS ? state.rel : '';
  const year = /^(19|20)\d{2}$|^2100$/.test(state.year) ? state.year : '';
  const read = useRead<ConnectionsPage>(
    apiPath(['finance', 'connections'], {
      q: state.q.trim().slice(0, 200),
      year,
      relationship: relation || 'all',
      focus: state.focus,
      limit: CONNECTIONS_PAGE_SIZE,
      offset: (page - 1) * CONNECTIONS_PAGE_SIZE,
    }),
    { keepPrevious: true, acceptData: (data) => data.state !== 'unavailable' },
  );
  const data = read.data;
  const [selection, setSelection] = useState({ node: '', edge: '' });
  const [evidence, setEvidence] = useState<Evidence | null>(null);
  const closeEvidence = useCallback(() => setEvidence(null), []);
  useEffect(() => {
    setSelection({ node: '', edge: '' });
    setEvidence(null);
  }, [data]);
  const nodes = new Map((data?.nodes ?? []).map((node) => [node.key, node]));
  const validEdges = data?.edges.filter((edge) => nodes.has(edge.from) && nodes.has(edge.to)) ?? [];
  const selectedNode = selection.edge ? undefined : nodes.get(selection.node || data?.focus || '');
  const selectedEdge = validEdges.find((edge) => edge.id === selection.edge);
  const selectedEdges = selectedNode
    ? validEdges.filter((edge) => edge.from === selectedNode.key || edge.to === selectedNode.key)
    : selectedEdge
      ? [selectedEdge]
      : [];
  const pages = Math.max(1, Math.ceil((data?.total ?? 0) / CONNECTIONS_PAGE_SIZE));
  function source(edge: GraphEdge) {
    const next = edgeEvidence(edge, nodes.get(edge.from)!, nodes.get(edge.to)!);
    if (edge.source.file_key && next.sourceHref) navigate(withFrom(next.sourceHref, here));
    else setEvidence(next);
  }
  function focus(key: string) {
    setSelection({ node: key, edge: '' });
    setState({ focus: key, page: '1' });
  }
  const countLine = data
    ? `${formatCount(data.offset + (validEdges.length ? 1 : 0))}–${formatCount(data.offset + validEdges.length)} of ${formatCount(data.total)} connections${data.state === 'partial' ? ' from available sources' : ''} · ${formatCount(data.nodes.filter((node) => node.kind === 'person' || node.kind === 'organization').length)} confirmed people and organizations · ${formatCount(data.nodes.filter((node) => node.kind === 'committee').length)} ${data.nodes.filter((node) => node.kind === 'committee').length === 1 ? 'committee' : 'committees'} · ${formatCount(data.nodes.filter((node) => node.unresolved).length)} printed names on this page`
    : '';
  const chosenHref = selectedNode && nodeHref(selectedNode);
  return (
    <main id="main" className="f-page">
      <div className="f-content mc-page">
        {back && <BackLink to={back.to} name={back.name} />}
        <h1 tabIndex={-1} className="f-page-title">
          Money connections
        </h1>
        <form
          className="mc-search"
          role="search"
          onSubmit={(e) => {
            e.preventDefault();
            setState({ q: typed.trim(), focus: '', page: '1' });
          }}
        >
          <label htmlFor="connections-q" className="f-visually-hidden">
            Find a person, organization or committee
          </label>
          <input
            className="f-field"
            id="connections-q"
            type="search"
            maxLength={200}
            autoComplete="off"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            placeholder={
              band === 'phone' ? 'Name or committee' : 'Find a person, organization or committee'
            }
          />
          <button className="f-btn">Search</button>
        </form>
        <div className="mc-controls">
          <div className="mc-filters">
            <Dropdown
              name="Year"
              value={year}
              options={[
                { value: '', label: 'All years' },
                ...[...new Set([...(year ? [Number(year)] : []), ...(data?.years ?? [])])]
                  .sort((a, b) => b - a)
                  .map((year) => ({
                    value: String(year),
                    label: String(year),
                  })),
              ]}
              onChange={(year) => setState({ year, focus: '', page: '1' })}
            />
            <Dropdown
              name="Relationship"
              value={relation}
              options={[
                { value: '', label: 'All relationships' },
                ...(data?.relationships ?? Object.keys(RELATIONSHIPS)).map((value) => ({
                  value,
                  label: RELATIONSHIPS[value] ?? value,
                })),
              ]}
              onChange={(rel) => setState({ rel, focus: '', page: '1' })}
            />
            <button
              className="f-btn f-btn-secondary"
              onClick={() => {
                setTyped('');
                setSelection({ node: '', edge: '' });
                setState({ q: '', year: '', rel: '', focus: '', page: '1' });
              }}
            >
              Reset view
            </button>
          </div>
          <Tabs
            label="View"
            value={view}
            tabs={[
              { value: 'Map', label: 'Map' },
              { value: 'Table', label: 'Table' },
            ]}
            onChange={(view) => setState({ view })}
          />
        </div>
        <section aria-label="Connections" className="mc-results" aria-busy={read.pending}>
          <ReadState read={read} noun="connections" />
          {data?.state === 'partial' && (
            <div className="mc-notice" role="status">
              Some sources could not be loaded: {data.unavailable_sources.join(', ')}. Connections
              from the available sources are shown.
              <button
                className="f-btn f-btn-secondary"
                onClick={read.retry}
                disabled={read.pending}
              >
                Try again
              </button>
            </div>
          )}
          {data && !validEdges.length && (
            <Empty title="No connections are held for this selection" />
          )}
          {data && validEdges.length > 0 && (
            <>
              {view === 'Map' ? (
                <div className="mc-layout">
                  <div className="mc-card">
                    <ConnectionsMap
                      nodes={data.nodes}
                      edges={validEdges}
                      selectedNode={selectedNode?.key ?? ''}
                      selectedEdge={selection.edge}
                      onNode={(node) => setSelection({ node, edge: '' })}
                      onEdge={(edge) => setSelection({ node: '', edge })}
                    />
                    <p className="mc-count" role="status">
                      {countLine}
                    </p>
                  </div>
                  <aside
                    className="mc-selection mc-card"
                    aria-label="Selection details"
                    aria-live="polite"
                  >
                    {!selectedNode && !selectedEdge ? (
                      <p>
                        Select a name or a line to see its connections. Every connection is also
                        listed in Table.
                      </p>
                    ) : (
                      <>
                        <div>
                          <span
                            className="mc-tag"
                            data-printed={selectedNode?.unresolved || undefined}
                            data-committee={selectedNode?.kind === 'committee' || undefined}
                          >
                            {selectedNode
                              ? nodeKind(selectedNode)
                              : RELATIONSHIPS[selectedEdge!.relationship]}
                          </span>
                          <h2>
                            {selectedNode?.label ??
                              `${nodes.get(selectedEdge!.from)!.label} to ${nodes.get(selectedEdge!.to)!.label}`}
                          </h2>
                          {chosenHref && (
                            <Link to={withFrom(chosenHref, here)}>
                              {selectedNode?.unresolved ? 'View records' : 'Open profile'}
                            </Link>
                          )}
                        </div>
                        <ul>
                          {selectedEdges.map((edge) => {
                            const other = nodes.get(
                              edge.from === selectedNode?.key ? edge.to : edge.from,
                            )!;
                            return (
                              <li key={edge.id}>
                                <span className="mc-note">
                                  {RELATIONSHIPS[edge.relationship]} ·{' '}
                                  {edge.from === selectedNode?.key ? 'to' : 'from'}
                                </span>
                                <strong>{other.label}</strong>
                                {edgeAmount(edge) && (
                                  <span className="mc-amount">{edgeAmount(edge)}</span>
                                )}
                                <span className="mc-note">{edgePeriod(edge)}</span>
                                <div className="mc-actions">
                                  <button
                                    className="mc-text-button"
                                    onClick={() => focus(other.key)}
                                  >
                                    Show connections
                                  </button>
                                  <button
                                    className="mc-text-button mc-source"
                                    onClick={() => source(edge)}
                                  >
                                    View source
                                  </button>
                                </div>
                              </li>
                            );
                          })}
                        </ul>
                      </>
                    )}
                  </aside>
                </div>
              ) : (
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
                          {['From', 'Relationship', 'To', 'Amount', 'Period', 'Source'].map(
                            (text) => (
                              <th key={text} scope="col">
                                {text}
                              </th>
                            ),
                          )}
                        </tr>
                      </thead>
                      <tbody>
                        {validEdges.map((edge) => (
                          <tr key={edge.id}>
                            <td>
                              <NodeName node={nodes.get(edge.from)!} here={here} />
                            </td>
                            <td>{RELATIONSHIPS[edge.relationship] ?? edge.relationship}</td>
                            <td>
                              <NodeName node={nodes.get(edge.to)!} here={here} />
                            </td>
                            <td
                              className="mc-money"
                              data-incomplete={edge.amount_state !== 'reported' || undefined}
                            >
                              {edgeAmount(edge) || (
                                <span className="f-visually-hidden">No amount</span>
                              )}
                            </td>
                            <td>{edgePeriod(edge)}</td>
                            <td>
                              <span className="mc-note">
                                {edge.source.dataset.replaceAll('_', ' ')}
                              </span>
                              <button
                                className="mc-text-button mc-source"
                                onClick={() => source(edge)}
                              >
                                View source
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <p className="mc-count" role="status">
                    {countLine}
                  </p>
                </>
              )}
              <Pager
                page={Math.floor(data.offset / CONNECTIONS_PAGE_SIZE) + 1}
                pages={pages}
                busy={read.pending}
                onChange={(page) => setState({ page: String(page) })}
              />
              <p className="mc-grounding">
                Each connection is one recorded relationship with its own period and source. A
                connection does not show that one payment funded another.
              </p>
            </>
          )}
        </section>
        <EvidencePanel evidence={evidence} onClose={closeEvidence} />
      </div>
    </main>
  );
}
function NodeName({ node, here }: { node: GraphNode; here: string }) {
  const to = nodeHref(node);
  return (
    <>
      {to ? <Link to={withFrom(to, here)}>{node.label}</Link> : <strong>{node.label}</strong>}
      <span className="mc-note">{nodeKind(node)}</span>
    </>
  );
}
