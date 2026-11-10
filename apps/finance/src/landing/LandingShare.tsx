import { useRef, useState } from 'react';

const PUBLIC_LANDING_URL = 'https://alethicalfinance.com/';

export function LandingShare() {
  const share = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const inFlight = useRef(false);
  const [result, setResult] = useState({ message: '', attempt: 0 });

  async function copy() {
    if (inFlight.current) return;
    inFlight.current = true;
    let ok = false;
    try {
      await navigator.clipboard.writeText(PUBLIC_LANDING_URL);
      ok = true;
    } catch {
      // Some browsers expose Clipboard but deny it. Try the browser's selection
      // fallback in this click and remove the temporary field even if it fails.
      const field = document.createElement('textarea');
      field.value = PUBLIC_LANDING_URL;
      field.readOnly = true;
      field.tabIndex = -1;
      field.className = 'lp-copy-buffer';
      field.setAttribute('aria-label', 'Link to copy');
      const restoreFocus = document.activeElement === button.current;
      try {
        if (share.current) {
          share.current.append(field);
          field.select();
          ok = document.execCommand('copy');
        }
      } catch {
        ok = false;
      } finally {
        const focusedField = document.activeElement === field;
        field.remove();
        if (restoreFocus && focusedField) button.current?.focus({ preventScroll: true });
      }
    } finally {
      inFlight.current = false;
      setResult(({ attempt }) => ({
        message: ok ? 'Link copied' : 'Couldn’t copy the link. Try again.',
        attempt: attempt + 1,
      }));
    }
  }

  return (
    <div className="lp-share lp-wrap" ref={share}>
      <button type="button" className="lp-signin" onClick={() => void copy()} ref={button}>
        Share Alethical Finance
      </button>
      <p
        className="lp-share-result"
        role="status"
        aria-atomic="true"
        data-copied={result.message === 'Link copied'}
      >
        <span key={result.attempt}>{result.message}</span>
      </p>
    </div>
  );
}
