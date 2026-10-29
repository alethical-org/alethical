import { apiPath, useRead } from '../../api/read';
import { Link } from '../../router';
import { withFrom } from '../../returnContext';
import { hrefFor, isBuilt } from '../../routes';
import { Arrow, WithArrow } from '../../ui/parts';

/** Shared pieces of the Lobbying, Lobbyist and Principal pages (lb-, lbl-, lbp-). */

/** A lobbyist's registration number or a principal's entity ID from the address:
 * digits only, never 0. Anything else is an address Finance does not have. */
export function recordNumber(raw: string | undefined): string | null {
  return raw && /^[1-9]\d{0,17}$/.test(raw) ? raw : null;
}

/** An official page outside Finance, opened in a new tab. */
export function OfficialLink({ href, children }: { href: string; children: string }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className="f-dest f-sources-link">
      <span>
        <WithArrow>{children}</WithArrow>
      </span>
      <span className="f-visually-hidden"> (opens in a new tab)</span>
    </a>
  );
}

export interface ConfirmedIdentity {
  id: string;
  kind: string;
  name: string;
}

/**
 * The identity a lobbyist's registration number or a principal's entity ID stands
 * for today, from Finance's identity confirmations. Never inferred: no answer, a
 * refusal or a failed read all show no identity.
 */
export function useConfirmedIdentity(
  kind: 'lobbyist' | 'principal',
  key: string | null,
): ConfirmedIdentity | null {
  const read = useRead<{ identity?: ConfirmedIdentity | null } | null>(
    key
      ? apiPath(['finance', 'identities', 'lookup'], { record_kind: kind, record_key: key })
      : null,
  );
  const identity = read.data?.identity;
  return identity && identity.id && identity.name ? identity : null;
}

/** "CONFIRMED IDENTITY" with the identity's name, and "Open profile" when its
 * profile page is built. */
export function IdentityBox({ identity, from }: { identity: ConfirmedIdentity; from: string }) {
  const route = identity.kind === 'organization' ? 'organization' : 'person';
  const href = isBuilt(route) ? withFrom(hrefFor(route, { id: identity.id }), from) : null;
  return (
    <section aria-label="Confirmed identity" className="lb-identity">
      <span className="lb-identity-text">
        <span className="f-label lb-identity-label">CONFIRMED IDENTITY</span>
        <span className="lb-identity-name">{identity.name}</span>
        {href && (
          <span className="lb-identity-note">
            {route === 'organization' ? 'Organization profile' : 'Person profile'}
          </span>
        )}
      </span>
      {href && (
        <Link to={href} className="f-dest lb-identity-open">
          <span>
            <WithArrow>Open profile</WithArrow>
          </span>
        </Link>
      )}
    </section>
  );
}

/** One row of a record list: a link with the name, a note and the arrow, or plain
 * text with an end note when there is no page to open. */
export function RecordRow({
  name,
  note,
  href,
  end,
}: {
  name: string;
  note: string;
  href: string | null;
  end?: string;
}) {
  const text = (
    <span className="lb-row-text">
      <span className="lb-row-name">{name}</span>
      <span className="lb-row-note f-num">{note}</span>
    </span>
  );
  return href ? (
    <Link to={href} className="lb-row lb-row-link">
      {text}
      <Arrow />
    </Link>
  ) : (
    <div className="lb-row">
      {text}
      {end && <span className="lb-row-end">{end}</span>}
    </div>
  );
}
