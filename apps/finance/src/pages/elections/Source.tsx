import { useCallback, useState } from 'react';

import { useLocation } from '../../router';
import { hrefFor, type RouteMatch } from '../../routes';
import { DestLink } from '../../ui/parts';
import { NotFound } from '../Status';
import { RetainedEvidence } from './Evidence';
import { retainedSourceSelection } from './sourceRoute';
import './comparison.css';

/** A portable export link enters the ordinary Finance sign-in/access flow.
 * Only the existing evidence loader receives the private API path. */
export function ElectionSource({ match }: { match: RouteMatch }) {
  const location = useLocation();
  const selection = retainedSourceSelection(
    match,
    location.search,
    window.location.hash,
  );
  const [closedPath, setClosedPath] = useState<string | null>(null);
  const path = selection?.attachment ?? null;
  const close = useCallback(() => setClosedPath(path), [path]);
  if (!selection) return <NotFound />;
  return (
    <main id="main" className="f-page">
      <DestLink to={hrefFor('home')}>Finance Home</DestLink>
      <h1 tabIndex={-1} className="f-page-title">
        Original source
      </h1>
      <button
        className="f-btn f-btn-secondary"
        onClick={() => setClosedPath(null)}
      >
        View source
      </button>
      {closedPath !== path && (
        <RetainedEvidence
          key={path}
          selection={{
            attachment: selection.attachment,
            evidence: {
              title: 'Original source',
              authority: 'Retained copy',
              checked: null,
              rows: [{ label: 'Source reference', value: selection.source }],
            },
          }}
          onClose={close}
        />
      )}
    </main>
  );
}
