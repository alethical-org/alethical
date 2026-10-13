import React, {
  useCallback,
  createContext,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { readTV, isAccessFailure, centralDate, uploaded, tvHref, type FileRow } from './api';

export const TVSession = createContext({ token: '', denied: () => {} });
export function useTVRead<T>(path: string, enabled = true) {
  const { token, denied } = useContext(TVSession);
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<{ path: string; data?: T; error?: unknown; loading: boolean }>(
    { path, loading: true },
  );
  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    setState((old) => ({ path, data: old.data, loading: true }));
    void readTV<T>(token, path, controller.signal).then(
      (data) => {
        if (!controller.signal.aborted) setState({ path, data, loading: false });
      },
      (error: unknown) => {
        if (controller.signal.aborted) return;
        if (isAccessFailure(error)) {
          denied();
          return;
        }
        setState((old) => ({ path, data: old.data, error, loading: false }));
      },
    );
    return () => controller.abort();
  }, [token, path, attempt, enabled, denied]);
  const clearRefresh = useCallback(() => {
    setState((old) => ({ path: old.path, loading: true }));
    setAttempt((n) => n + 1);
  }, []);
  return {
    ...state,
    loading: state.path !== path || state.loading,
    retry: () => setAttempt((n) => n + 1),
    clearRefresh,
  };
}

export function Arrow() {
  return (
    <svg
      className="tv-arrow"
      width="19"
      height="19"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M5 12 H19 M14 7 L19 12 L14 17"
        stroke="currentColor"
        strokeWidth="2.27"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
export function AdminMarker() {
  return <span className="tv-admin">Administrators only</span>;
}
export function Kind({ value }: { value?: string | null }) {
  return (
    <span className={`tv-kind${value ? '' : ' tv-unchecked'}`}>{value || 'Kind not checked'}</span>
  );
}
export function External({
  href,
  children,
  suffix,
}: {
  href: string;
  children: ReactNode;
  suffix: string;
}) {
  let safe = false;
  try {
    const url = new URL(href);
    safe = url.protocol === 'https:' && url.hostname === 'publicfiles.fcc.gov';
  } catch {
    /* no unsafe external link */
  }
  return safe ? (
    <a href={href} target="_blank" rel="noopener noreferrer">
      {children}
      <Arrow />
      <span className="tv-sr"> {suffix} (opens in a new tab)</span>
    </a>
  ) : null;
}
export function Internal({ href, children }: { href?: string; children: ReactNode }) {
  return href?.startsWith('/') && !href.startsWith('//') && !href.includes('\\') ? (
    <a href={href}>
      {children}
      <Arrow />
    </a>
  ) : (
    <>{children}</>
  );
}
export function Busy({ label = 'Loading records' }: { label?: string }) {
  return (
    <div role="status" className="tv-loading">
      <span className="tv-sr">{label}</span>
      {[1, 2, 3].map((n) => (
        <div key={n} className="tv-skeleton" />
      ))}
    </div>
  );
}
export function Failure({
  children = 'We couldn’t load these records',
  retry,
}: {
  children?: ReactNode;
  retry: () => void;
}) {
  return (
    <div className="tv-notice tv-error" role="alert">
      <span>{children}</span>
      <button className="tv-button" onClick={retry}>
        Try again
      </button>
    </div>
  );
}
export function FileRows({
  files,
  returnTo,
  recent = false,
}: {
  files: FileRow[];
  returnTo?: string;
  recent?: boolean;
}) {
  return (
    <div className={`tv-rows tv-file-rows${recent ? ' tv-recent-rows' : ''}`}>
      {files.map((file) => (
        <a
          className="tv-row"
          key={file.key}
          href={tvHref('file', file.key, {
            from: returnTo,
            version: file.version_id,
            copy: file.copy_id,
          })}
        >
          <div className="tv-row-main">
            {recent ? (
              <div className="tv-recent-meta">
                <Kind value={file.kind} />
                <span className="tv-small">
                  {file.uploaded_at ? centralDate(file.uploaded_at) : 'Upload date unavailable'}
                </span>
              </div>
            ) : (
              <>
                <div className="tv-eyebrow">
                  {file.station} · {file.year} ·{' '}
                  {file.category ? `STATION CATEGORY: ${file.category}` : 'CATEGORY NOT IDENTIFIED'}
                </div>
              </>
            )}
            <strong>{file.name}</strong>
            {!recent && (
              <>
                <div className="tv-inline">
                  <Kind value={file.kind} />
                  {file.role && <span>{file.role}</span>}
                </div>
                <div className="tv-small">{uploaded(file.uploaded_at)}</div>
              </>
            )}
            {file.source_changed && (
              <p className="tv-small">
                The station file changed; this is the saved copy used for the check
              </p>
            )}
          </div>
          {!recent && <Arrow />}
        </a>
      ))}
    </div>
  );
}
export function Metric({
  value,
  label,
  children,
}: {
  value: number;
  label: string;
  children?: ReactNode;
}) {
  return (
    <div className="tv-metric">
      <strong>{value.toLocaleString('en-US')}</strong>
      <div>{label}</div>
      {children && <p className="tv-small">{children}</p>}
    </div>
  );
}
export function Checked({ date }: { date?: string }) {
  return date ? <p className="tv-small">Checked on {centralDate(date)}</p> : null;
}

export interface Choice {
  value: string;
  label: string;
  disabled?: boolean;
}
/** Owns its gap and stacking context; the overlay never depends on hover to stay open. */
export function ChoiceMenu({
  label,
  value,
  choices,
  onChange,
}: {
  label: string;
  value: string;
  choices: Choice[];
  onChange: (value: string) => void;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [above, setAbove] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const enabled = choices
    .map((choice, index) => (!choice.disabled ? index : -1))
    .filter((index) => index >= 0);
  const close = () => {
    setOpen(false);
    trigger.current?.focus();
  };
  useEffect(() => {
    if (!open) return;
    const away = (event: Event) => {
      if (!wrap.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', away, true);
    const rect = wrap.current?.getBoundingClientRect();
    if (rect)
      setAbove(
        window.innerHeight - rect.bottom < Math.min(280, choices.length * 48) &&
          rect.top > window.innerHeight - rect.bottom,
      );
    return () => document.removeEventListener('pointerdown', away, true);
  }, [open, choices.length]);
  useEffect(() => {
    if (open)
      panel.current
        ?.querySelector<HTMLElement>(`[data-index="${active}"]`)
        ?.scrollIntoView?.({ block: 'nearest' });
  }, [open, active]);
  const show = () => {
    setActive(
      Math.max(
        0,
        choices.findIndex((choice) => choice.value === value),
      ),
    );
    setOpen(true);
  };
  return (
    <div className={`tv-choice${open ? ' tv-choice-open' : ''}`} ref={wrap}>
      <span id={`${id}-label`} className="tv-choice-label">
        {label}
      </span>
      <button
        ref={trigger}
        className="tv-choice-trigger"
        role="combobox"
        aria-labelledby={`${id}-label`}
        aria-controls={`${id}-list`}
        aria-expanded={open}
        aria-activedescendant={open ? `${id}-${active}` : undefined}
        aria-haspopup="listbox"
        onClick={() => (open ? setOpen(false) : show())}
        onKeyDown={(event) => {
          if (['ArrowDown', 'ArrowUp', 'Home', 'End', 'Enter', ' ', 'Escape'].includes(event.key))
            event.preventDefault();
          if (event.key === 'Escape') return close();
          if (!open && ['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(event.key)) return show();
          if (event.key === 'Tab') return setOpen(false);
          if (!open) return;
          if (event.key === 'Home') setActive(enabled[0] ?? 0);
          if (event.key === 'End') setActive(enabled.at(-1) ?? 0);
          if (event.key === 'ArrowDown')
            setActive(enabled[(enabled.indexOf(active) + 1) % enabled.length] ?? 0);
          if (event.key === 'ArrowUp')
            setActive(
              enabled[(enabled.indexOf(active) - 1 + enabled.length) % enabled.length] ?? 0,
            );
          if (['Enter', ' '].includes(event.key) && choices[active] && !choices[active].disabled) {
            onChange(choices[active].value);
            close();
          }
        }}
      >
        {choices.find((choice) => choice.value === value)?.label ||
          value ||
          `All ${label.toLowerCase()}`}
        <span aria-hidden="true">⌄</span>
      </button>
      {open && (
        <div className={`tv-choice-bridge${above ? ' tv-choice-above' : ''}`}>
          <div
            ref={panel}
            id={`${id}-list`}
            role="listbox"
            aria-labelledby={`${id}-label`}
            className="tv-choice-panel"
          >
            {choices.map((choice, index) => (
              <div
                key={choice.value}
                id={`${id}-${index}`}
                data-index={index}
                role="option"
                aria-selected={choice.value === value}
                aria-disabled={choice.disabled || undefined}
                className={`tv-option${index === active ? ' tv-option-active' : ''}`}
                onPointerMove={() => !choice.disabled && setActive(index)}
                onClick={() => {
                  if (!choice.disabled) {
                    onChange(choice.value);
                    close();
                  }
                }}
              >
                {choice.label}
                {choice.value === value ? ' ✓' : ''}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export const tvStyles = `
.tv{font-family:'Libre Franklin',sans-serif;font-variant-numeric:tabular-nums;color:#11150f;font-size:17px;line-height:1.5;padding:36px 56px 72px;box-sizing:border-box;width:100%;min-width:0}
.tv *{box-sizing:border-box}.tv h1,.tv h2,.tv h3,.tv p{margin:0}.tv h1{font-size:44px;line-height:1.08;letter-spacing:-.03em;font-weight:800;margin:12px 0 18px;overflow-wrap:anywhere}.tv h1.tv-record-title{font-size:34px;line-height:1.15}.tv h2{font-size:22px;font-weight:800;letter-spacing:-.01em;margin-bottom:16px}.tv h3{font-size:16px;font-weight:800}.tv a{color:#0f7a45;text-decoration:none;overflow-wrap:anywhere}.tv a:hover{text-decoration:underline}.tv button,.tv input{font:inherit}.tv button{cursor:pointer}.tv button:disabled,.tv [aria-disabled=true]{cursor:default;opacity:.6}.tv button:focus-visible,.tv a:focus-visible,.tv summary:focus-visible,.tv [tabindex]:focus-visible{outline:2px solid #7c5cff;outline-offset:2px}.tv input:focus{outline:3px solid rgba(91,48,214,.22);border-color:#5b30d6}.tv .tv-back{color:#6f756f;display:block;min-height:44px;width:fit-content;font-size:15px}.tv-admin,.tv-kind{display:inline-flex;min-height:24px;align-items:center;border:1px solid #11150f;border-radius:7px;padding:0 8px;font-size:12.5px;font-weight:700;white-space:nowrap;background:white}.tv-admin{margin:12px 0}.tv-kind{background:#f1f3f2;border-color:rgba(17,21,15,.12)}.tv-unchecked{border-style:dashed;background:white}.tv-arrow{flex:none;vertical-align:-4.6px;margin-left:6px}.tv-lead{font-size:19px;max-width:1000px}.tv-section{margin-top:48px;padding-top:32px;border-top:1px solid rgba(17,21,15,.12)}.tv-card{background:#fff;border:1px solid rgba(17,21,15,.1);border-radius:16px;box-shadow:0 8px 24px rgba(17,21,15,.05);padding:26px 28px 28px;min-width:0}.tv-card h2{margin-bottom:16px}.tv-small{font-size:14px;color:#4f5651;line-height:1.5}.tv p.tv-small{margin-top:6px}.tv-eyebrow{font-size:12.5px;font-weight:800;color:#0f7a45;letter-spacing:.035em}.tv-inline{display:flex;gap:8px 12px;align-items:center;flex-wrap:wrap}.tv-grid3{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:24px}.tv-metrics{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:22px 24px}.tv-metric strong{font-size:26px;font-weight:800}.tv-metric{font-size:15px}.tv-metric p{max-width:300px}.tv-count-divider{border-top:1px solid rgba(17,21,15,.08);margin:24px 0}.tv-button{border:1px solid #11150f;background:#11150f;color:white;border-radius:12px;min-height:44px;padding:10px 18px;font-weight:700;flex:none}.tv-button:not(:disabled):not([aria-disabled=true]):hover{background:#3a423b}.tv-button.tv-secondary{background:white;color:#11150f;border-color:#cfd6d2}.tv-button.tv-secondary:not(:disabled):hover{background:#f1f3f2}.tv-link-button{background:none;border:0;color:#11150f;padding:8px 0;min-height:44px;text-align:left;font-weight:600}.tv-link-button:hover{text-decoration:underline}.tv-row{display:flex;align-items:center;gap:18px;justify-content:space-between;min-height:64px;border:1px solid rgba(17,21,15,.1);border-radius:12px;padding:15px 18px;box-shadow:0 6px 18px rgba(17,21,15,.05);background:white}.tv a.tv-row{text-decoration:none}.tv-row:hover{border-color:#28bf71}.tv-row-main{min-width:0}.tv-row-main strong{display:block;color:#11150f;font-size:18px;margin:3px 0}.tv-file-rows .tv-row{background:transparent;border:0;border-top:1px solid rgba(17,21,15,.08);border-radius:0;box-shadow:none;padding:12px 0}.tv-file-rows .tv-row:hover{background:#f5f6f7;border-color:rgba(17,21,15,.08)}.tv-file-rows .tv-row:active{background:#eef0ef}.tv-file-rows .tv-row .tv-eyebrow{color:#4f5651}.tv-file-rows.tv-rows{gap:0}.tv-recent-card{padding:18px 20px 6px!important}.tv-recent-card .tv-row{margin:0 -20px;padding:12px 20px}.tv-recent-rows .tv-row-main{width:100%}.tv-recent-meta{display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:6px 10px}.tv-recent-rows .tv-row-main strong{font-size:15.5px;margin-top:7px;line-height:1.35}.tv-rows{display:flex;flex-direction:column;gap:9px}.tv-notice{padding:16px;border:1px solid #dbeef4;background:#f4fafc;border-radius:12px;display:flex;align-items:center;gap:16px;justify-content:space-between;margin:16px 0}.tv-error{background:#fffbeb;border-color:#e9d69c;color:#5a4410}.tv-success{background:#eefaf3;border-color:#bfeacf;color:#0f5132}.tv-muted{color:#6f756f}.tv-sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap}.tv-skeleton{height:64px;background:#e6e9e7;border-radius:12px;margin:9px 0}.tv-loading{min-width:0}.tv-plain-list{list-style:none;padding:0;max-width:820px;margin:16px 0 0;display:flex;flex-direction:column;gap:10px;font-size:15px}.tv-plain-list li{position:relative;padding-left:18px}.tv-plain-list li:before{content:'';position:absolute;left:0;top:.62em;width:5px;height:5px;border-radius:50%;background:#6f756f}.tv-choice{position:relative;min-width:0}.tv-choice-open{z-index:30}.tv-choice-label{display:block;font-size:11px;letter-spacing:.1em;font-weight:700;margin-bottom:6px}.tv-choice-trigger{display:flex;justify-content:space-between;align-items:center;gap:12px;min-height:48px;width:100%;padding:9px 14px;border-radius:12px;border:1px solid rgba(17,21,15,.16);background:white;text-align:left;font-weight:700}.tv-choice-trigger:hover{border-color:#28bf71}.tv-choice-bridge{position:absolute;right:0;top:100%;padding-top:6px;min-width:100%;width:max-content;max-width:320px}.tv-choice-above{top:auto;bottom:100%;padding-top:0;padding-bottom:6px}.tv-choice-panel{max-height:280px;overflow:auto;padding:6px;background:white;border:1px solid #cfd6d2;border-radius:12px;box-shadow:0 14px 34px rgba(17,21,15,.14)}.tv-option{min-height:44px;display:flex;align-items:center;padding:10px 12px;border-radius:7px;white-space:normal;overflow-wrap:anywhere;cursor:pointer}.tv-option-active{background:#eef0ef}.tv-option[aria-disabled=true]{cursor:default}.tv-block-link{display:block;padding:10px 0;min-height:44px}.tv-table{border-collapse:collapse;width:100%;text-align:left}.tv-table th,.tv-table td{border-bottom:1px solid #e5e8e6;padding:14px 12px 14px 0;vertical-align:top}.tv-table th{font-size:12px;color:#4f5651;font-weight:800}.tv-table td{font-size:15px}.tv-quote{display:block;background:#f5f6f7;border-radius:7px;padding:10px 12px;font-size:14px;margin:10px 0;white-space:pre-wrap;overflow-wrap:anywhere}.tv-fact{padding-top:18px}.tv-fact+.tv-fact{margin-top:14px;border-top:1px solid rgba(17,21,15,.08)}.tv-fact-label{font-size:11px;letter-spacing:.1em;font-weight:700;color:#4f5651}.tv-fact-value{font-size:26px;line-height:1.2;font-weight:800;margin-top:8px;overflow-wrap:anywhere}.tv-text{white-space:pre-wrap;overflow-wrap:anywhere;font-family:inherit;font-size:15px;line-height:1.7}.tv-file-grid{display:grid;grid-template-columns:minmax(0,1fr) 380px;gap:28px;grid-template-areas:'viewer side' 'text side'}.tv-file-viewer{grid-area:viewer;min-width:0}.tv-file-side{grid-area:side;min-width:0;display:flex;flex-direction:column;gap:24px}.tv-file-text{grid-area:text;min-width:0}.tv-viewer{height:760px;background:#e4e7e5;border-radius:16px;position:relative;isolation:isolate;min-width:0}.tv-viewer-scroll{height:100%;overflow:auto;padding:24px 24px 84px;outline-offset:3px!important}.tv-viewer-image{display:block;height:auto;max-width:none;box-shadow:0 3px 12px rgba(0,0,0,.15)}.tv-toolbar{position:absolute;bottom:18px;left:50%;transform:translateX(-50%);display:flex;align-items:center;gap:4px;padding:5px;background:white;box-shadow:0 10px 26px rgba(17,21,15,.16);border-radius:14px;z-index:2;white-space:nowrap}.tv-toolbar button{border:0;background:white;border-radius:10px;min-width:44px;height:44px;padding:0 9px;color:#11150f}.tv-toolbar button:not([aria-disabled=true]):hover{background:#f1f3f2}.tv-toolbar button:not([aria-disabled=true]):active{background:#e4e7e5}.tv-toolbar output{font-size:14px}.tv-fit-phone{position:absolute;top:12px;right:12px;z-index:2}.tv-viewer-message{padding:30px;text-align:center}.tv-hidden{display:none}.tv-file-lower{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:24px;margin-top:28px}.tv-file-related{display:flex;flex-direction:column;gap:24px}.tv-search-form{display:flex;gap:12px;margin:28px 0 32px}.tv-search-field{flex:1;min-width:0}.tv-search-field input{width:100%;min-height:56px;border:1px solid rgba(17,21,15,.16);border-radius:14px;padding:14px 18px;background:white}.tv-search-form .tv-button{min-width:172px;min-height:56px}.tv-tabs{display:flex;gap:28px;border-bottom:1px solid #dce1dd;margin-bottom:16px}.tv-tabs button{padding:12px 0;border:0;border-bottom:3px solid transparent;background:none;font-weight:700;color:#4f5651}.tv-tabs button[aria-selected=true]{border-bottom-color:#2ed47e;color:#11150f}.tv-tabs button:hover{border-bottom-color:rgba(17,21,15,.2)}.tv-tabs button[aria-selected=true]:hover{border-bottom-color:#2ed47e}.tv-filters{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px;max-width:780px;margin:18px 0 24px}.tv-pagination{display:flex;align-items:center;justify-content:center;gap:18px;margin-top:24px}.tv-result-count{font-size:14px;font-weight:800;margin:18px 0 12px!important}.tv-dates{margin-top:14px;display:grid;grid-template-columns:1fr;gap:2px;font-size:14px}.tv-dates dt{color:#4f5651}.tv-dates dd{margin:0 0 8px;font-weight:700}.tv-date-notice{min-height:74px}.tv-date-notice .tv-button{min-width:196px}.tv-source{border-top:1px solid rgba(17,21,15,.12);padding-top:14px}.tv-source a{font-size:14px}.tv-year-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px}.tv-address{margin-top:20px;border-top:1px solid #e5e8e6;padding-top:16px}
@media(min-width:768px) and (max-width:1099px){.tv{font-size:16.5px;padding-left:40px;padding-right:40px}.tv h1{font-size:38px}.tv h1.tv-record-title{font-size:30px}.tv h2{font-size:21px}.tv-lead{font-size:18px}.tv-card{padding:24px 24px 26px}.tv-file-grid{grid-template-columns:minmax(0,1fr);grid-template-areas:'viewer' 'side' 'text'}.tv-file-side{display:grid;grid-template-columns:1fr 1fr}.tv-viewer{height:620px}.tv-file-lower{grid-template-columns:repeat(2,minmax(0,1fr))}.tv-file-limits{grid-column:1/-1}.tv-metric strong{font-size:25px}}
@media(max-width:767px){.tv{font-size:16px;padding:24px 20px 48px}.tv h1{font-size:30px}.tv h1.tv-record-title{font-size:24px}.tv h2{font-size:20px}.tv-lead{font-size:17px}.tv-card{padding:20px 18px 22px}.tv-grid3,.tv-file-lower,.tv-file-side{display:flex;flex-direction:column}.tv-metrics{grid-template-columns:repeat(2,minmax(0,1fr))}.tv-metric strong{font-size:24px}.tv-file-grid{grid-template-columns:minmax(0,1fr);grid-template-areas:'viewer' 'side' 'text'}.tv-viewer{height:420px}.tv-viewer-scroll{padding:18px 18px 78px}.tv-toolbar{bottom:12px;gap:0}.tv-toolbar output{font-size:12px}.tv-search-form{flex-direction:column}.tv-search-form .tv-button{width:100%}.tv-tabs{display:grid;grid-template-columns:1fr 1fr;gap:4px 16px}.tv-tabs button{text-align:left}.tv-filters{grid-template-columns:1fr}.tv-choice-bridge{width:100%;max-width:100%}.tv-pagination{justify-content:space-between;gap:8px}.tv-pagination .tv-button{padding:8px 12px}.tv-notice{align-items:flex-start;flex-direction:column}.tv-date-notice{min-height:131px}.tv-dates{grid-template-columns:1fr}.tv-dates dd{margin-bottom:6px}.tv-year-grid{grid-template-columns:1fr 1fr}.tv-folder-table thead{display:none}.tv-folder-table tr,.tv-folder-table td{display:block}.tv-folder-table tr{padding:12px 0;border-bottom:1px solid #e5e8e6}.tv-folder-table td{border:0;padding:4px 0}.tv-folder-table td[data-label]:before{content:attr(data-label) ': ';font-weight:700}}
@media(prefers-reduced-motion:reduce){.tv *{scroll-behavior:auto!important;transition:none!important}}
`;
