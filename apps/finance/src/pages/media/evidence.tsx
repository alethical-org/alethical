import { useEffect, useRef, type KeyboardEvent } from 'react';
import { Link } from '../../router';
import type { Evidence } from '../../ui/controls';

export interface EvidenceAction {
  label: string;
  /** A link (to Check TV station files) or, without one, a button. */
  href?: string;
  onClick?: () => void;
}

/** Source evidence for a check on a TV station file: the shared panel's rows,
 * quote and checked line, plus that page's machine-read text with the saved quote
 * marked where it appears exactly, and the check's actions (Evidence Panel drawing;
 * Current decisions, 30 Oct 2026). */
export interface StationEvidence extends Evidence {
  /** The cited page's machine-read text; null when the page has none. */
  machineText: string | null;
  actions: EvidenceAction[];
}

/** The quote split around its first exact appearance in the page text. */
export function markQuote(text: string, quote: string) {
  const at = quote ? text.indexOf(quote) : -1;
  if (at < 0) return null;
  return { before: text.slice(0, at), mark: quote, after: text.slice(at + quote.length) };
}

/**
 * The drawing's panel: a drawer at the right, a bottom sheet on phone. Focus moves
 * into it and back to the opener; Tab stays inside; Escape and the scrim close it;
 * the rest of the page is inert meanwhile. Nothing is marked on the image.
 */
export function StationEvidencePanel({
  evidence,
  onClose,
}: {
  evidence: StationEvidence | null;
  onClose: () => void;
}) {
  const panel = useRef<HTMLElement>(null);
  const close = useRef<HTMLButtonElement>(null);
  const opener = useRef<Element | null>(null);
  const open = evidence !== null;
  const latestClose = useRef(onClose);
  latestClose.current = onClose;

  useEffect(() => {
    if (!open) return;
    opener.current = document.activeElement;
    const inerted: Element[] = [];
    let node: Element | null = panel.current?.parentElement ?? null;
    while (node && node !== document.body) {
      for (const sibling of node.parentElement ? [...node.parentElement.children] : []) {
        if (sibling !== node && !sibling.hasAttribute('inert')) {
          sibling.setAttribute('inert', '');
          inerted.push(sibling);
        }
      }
      node = node.parentElement;
    }
    close.current?.focus();
    function onKey(event: globalThis.KeyboardEvent) {
      if (event.key === 'Escape') latestClose.current();
    }
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      for (const element of inerted) element.removeAttribute('inert');
      (opener.current as HTMLElement | null)?.focus?.({ preventScroll: true });
    };
  }, [open]);

  if (!evidence) return null;
  const checked = evidence.checked ?? 'Not checked';
  const text = evidence.machineText;
  const marked = text ? markQuote(text, evidence.quote ?? '') : null;
  const trap = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key !== 'Tab' || !panel.current) return;
    const focusable = [
      ...panel.current.querySelectorAll<HTMLElement>(
        'a[href],button:not([disabled]),[tabindex]:not([tabindex="-1"])',
      ),
    ];
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };
  return (
    <div className="f-evidence-layer">
      <div className="f-evidence-scrim" aria-hidden="true" onClick={onClose} />
      <section
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby="evidence-title"
        className="f-evidence"
        onKeyDown={trap}
      >
        <div className="f-evidence-head">
          <div className="f-evidence-heading">
            <div className="f-label">SOURCE EVIDENCE</div>
            <h2 id="evidence-title">{evidence.title}</h2>
            <div className="f-evidence-authority">{evidence.authority}</div>
          </div>
          <button
            ref={close}
            type="button"
            aria-label="Close source evidence"
            className="f-evidence-close"
            onClick={onClose}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path
                d="M6 6 L18 18 M18 6 L6 18"
                stroke="currentColor"
                strokeWidth="2.2"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </div>
        <div className="f-evidence-body">
          <dl>
            {evidence.rows.map((row) => (
              <div key={row.label} className="f-sources-row">
                <dt>{row.label}</dt>
                <dd>{row.value}</dd>
              </div>
            ))}
          </dl>
          {evidence.quote && (
            <figure className="f-evidence-quote">
              <figcaption>
                <span className="f-evidence-quote-label">QUOTE</span>
                {evidence.page && (
                  <>
                    {' · '}
                    <strong>Page {evidence.page}</strong>
                  </>
                )}
              </figcaption>
              <blockquote data-italic>{evidence.quote}</blockquote>
            </figure>
          )}
          {text ? (
            <section aria-label="Machine-read text" className="mb-ev-machine">
              <div className="mb-ev-machine-head">
                <span className="f-evidence-quote-label">MACHINE-READ TEXT · NOT CHECKED</span>
                {evidence.page && <span className="f-num">Page {evidence.page}</span>}
              </div>
              <pre>
                {marked ? (
                  <>
                    {marked.before}
                    <mark>{marked.mark}</mark>
                    {marked.after}
                  </>
                ) : (
                  text
                )}
              </pre>
              {!marked && evidence.quote && (
                <p className="mb-ev-note">
                  The checked quote isn’t found exactly in this page’s machine-read text
                </p>
              )}
            </section>
          ) : (
            evidence.quote && (
              <p className="mb-ev-note mb-ev-gap">
                Machine-read text is not available for this page
              </p>
            )
          )}
          <div className="f-evidence-checked">
            {checked !== 'Not checked' && (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <circle cx="12" cy="12" r="9" stroke="#0E6A82" strokeWidth="2" />
                <path
                  d="M8 12.5 L10.8 15.2 L16 9.5"
                  stroke="#0E6A82"
                  strokeWidth="2.2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            )}
            <span>{checked}</span>
          </div>
          {evidence.actions.length > 0 && (
            <div className="mb-ev-actions">
              {evidence.actions.map((action) =>
                action.href ? (
                  <Link
                    key={action.label}
                    to={action.href}
                    onClick={action.onClick}
                    className="f-btn f-btn-secondary mb-ev-action"
                  >
                    {action.label}
                  </Link>
                ) : (
                  <button
                    key={action.label}
                    type="button"
                    className="f-btn f-btn-secondary mb-ev-action"
                    onClick={action.onClick}
                  >
                    {action.label}
                  </button>
                ),
              )}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
