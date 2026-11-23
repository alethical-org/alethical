import type { ReactNode } from 'react';

import { Logo } from '../parts/Logo';
import { Link } from '../router';

/**
 * The sign-in family's page: the ALETHICAL.AI logo on the dark ground above a
 * white card (Access and Investor Access drawings, 23 Nov 2026). The logo links
 * to the landing page, except on a page that already is the landing address or
 * is finishing a sign-in, where it is the plain logo.
 */
export function AccessPage({
  children,
  linked = true,
  label,
}: {
  children: ReactNode;
  linked?: boolean;
  label?: string;
}) {
  const logo = <Logo markSize={28} className="access-wordmark" />;
  return (
    <main className="access-page" id="main" aria-label={label}>
      {linked ? (
        <Link to="/" className="access-logo" aria-label="Alethical.AI">
          {logo}
        </Link>
      ) : (
        <div className="access-logo" role="img" aria-label="Alethical.AI">
          {logo}
        </div>
      )}
      <section className="access-card">{children}</section>
    </main>
  );
}
