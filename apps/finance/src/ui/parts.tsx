import type { ReactNode } from 'react';

import { Link } from '../router';

/** The one arrow (RULE Design system §05): a 19px path, never a typed arrow. */
export function Arrow({ stroke = '#0B5C72', className = 'f-arrow' }: { stroke?: string; className?: string }) {
  return (
    <svg className={className} width="19" height="19" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M5 12 H19 M14 7 L19 12 L14 17"
        stroke={stroke}
        strokeWidth="2.27"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function Chevron({ direction = 'left' }: { direction?: 'left' | 'down' }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d={direction === 'left' ? 'M15 5 L8 12 L15 19' : 'M6 9 L12 15 L18 9'}
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/**
 * Words with the arrow bound to the last word, so the arrow never wraps alone
 * onto a line of its own.
 */
export function WithArrow({ children, stroke }: { children: string; stroke?: string }) {
  const words = children.trim().split(/\s+/);
  const last = words.pop() ?? '';
  return (
    <>
      {words.length > 0 && <span className="f-dest-words">{words.join(' ')} </span>}
      <span className="f-nowrap">
        <span>{last}</span>
        <Arrow stroke={stroke} className="f-arrow f-arrow-after" />
      </span>
    </>
  );
}

/** A destination link: accent words and the arrow after the last word. */
export function DestLink({ to, children }: { to: string; children: string }) {
  return (
    <Link to={to} className="f-dest">
      <WithArrow>{children}</WithArrow>
    </Link>
  );
}

/** "Back to {destination}": names the earlier page it opens. */
export function BackLink({ to, name }: { to: string; name: string }) {
  return (
    <Link to={to} className="f-back">
      <Chevron />
      <span>Back to {name}</span>
    </Link>
  );
}

export interface SourceGroup {
  source: string;
  items: ReactNode[];
}

/**
 * The one subdued bottom section for routine sources and their dates
 * (Design rule eug-135). A shared source is named once; each dataset keeps its
 * own copied or updated wording.
 */
export function SourcesAndUpdates({ groups }: { groups: SourceGroup[] }) {
  if (groups.length === 0) return null;
  return (
    <section className="f-sources" aria-labelledby="sources-heading">
      <h2 id="sources-heading">Sources and updates</h2>
      <dl>
        {groups.map((group) => (
          <div key={group.source} className="f-sources-row">
            <dt>{group.source}</dt>
            <dd>
              {group.items.map((item, index) => (
                <span key={index}>{item}</span>
              ))}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

/** Loading, said once and announced. */
export function LoadingLine({ children }: { children: string }) {
  return (
    <div className="f-status" role="status">
      <span className="f-spinner" aria-hidden="true" />
      {children}
    </div>
  );
}
