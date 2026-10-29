import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from 'react';

import { WithArrow } from './parts';

function Caret({ up = false }: { up?: boolean }) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      className={up ? 'f-caret-up' : undefined}
    >
      <path
        d="M6 9 L12 15 L18 9"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function Check() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      className="f-check"
    >
      <path
        d="M5 12.5 L9.5 17 L19 7.5"
        stroke="#0E6A82"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function Cross() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M6 6 L18 18 M18 6 L6 18"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
      />
    </svg>
  );
}

export interface Option<T extends string> {
  value: T;
  label: string;
}

/**
 * The drawings' dropdown: "{name}: {current}" on a button, options as 44px rows
 * with a check on the chosen one, drawn over the content below it. Escape, a
 * press outside, or a choice closes it; arrow keys move between options.
 */
export function Dropdown<T extends string>({
  name,
  value,
  options,
  onChange,
}: {
  name: string;
  value: T;
  options: ReadonlyArray<Option<T>>;
  onChange: (value: T) => void;
}) {
  const [open, setOpen] = useState(false);
  const wrapper = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const id = useId();
  const current = options.find((option) => option.value === value) ?? options[0];

  useEffect(() => {
    if (!open) return;
    function onPointer(event: PointerEvent) {
      if (!wrapper.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKey(event: globalThis.KeyboardEvent) {
      if (event.key === 'Escape') {
        setOpen(false);
        button.current?.focus();
      }
    }
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  // Opening puts focus on the chosen option, so arrow keys start from it.
  useLayoutEffect(() => {
    if (!open) return;
    list.current?.querySelector<HTMLButtonElement>('[aria-selected="true"] button')?.focus();
  }, [open]);

  function onListKey(event: KeyboardEvent<HTMLUListElement>) {
    const buttons = [...(list.current?.querySelectorAll<HTMLButtonElement>('button') ?? [])];
    const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
    let next = -1;
    if (event.key === 'ArrowDown') next = Math.min(buttons.length - 1, at + 1);
    else if (event.key === 'ArrowUp') next = Math.max(0, at - 1);
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = buttons.length - 1;
    else if (event.key === 'Tab') setOpen(false);
    if (next >= 0) {
      event.preventDefault();
      buttons[next]?.focus();
    }
  }

  return (
    <div className="f-dropdown" ref={wrapper}>
      <button
        ref={button}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        className="f-dropdown-button"
        data-open={open || undefined}
        onClick={() => setOpen((value) => !value)}
      >
        <span className="f-dropdown-name">{name}:</span> {current?.label}
        <Caret up={open} />
      </button>
      {open && (
        <ul
          id={id}
          ref={list}
          role="listbox"
          aria-label={name}
          className="f-dropdown-list"
          onKeyDown={onListKey}
        >
          {options.map((option) => {
            const selected = option.value === value;
            return (
              <li key={option.value} role="option" aria-selected={selected}>
                <button
                  type="button"
                  className="f-dropdown-option"
                  data-selected={selected || undefined}
                  onClick={() => {
                    setOpen(false);
                    button.current?.focus();
                    if (!selected) onChange(option.value);
                  }}
                >
                  {selected && <Check />}
                  {option.label}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/** "Clear all", the only label for clearing filters. */
export function ClearAll({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" className="f-btn f-btn-secondary f-clear" onClick={onClick}>
      <Cross />
      Clear all
    </button>
  );
}

/** Year and type choices: chips that size to their label and wrap. */
export function Chips<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: ReadonlyArray<Option<T>>;
  onChange: (value: T) => void;
}) {
  return (
    <div role="group" aria-label={label} className="f-chips">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={option.value === value}
          className="f-chip"
          onClick={() => option.value !== value && onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

export interface Tab<T extends string> {
  value: T;
  label: string;
  count?: string | null;
}

/** A content switch within a page: a 3px accent underline on the chosen tab. */
export function Tabs<T extends string>({
  label,
  value,
  tabs,
  onChange,
}: {
  label: string;
  value: T;
  tabs: ReadonlyArray<Tab<T>>;
  onChange: (value: T) => void;
}) {
  const row = useRef<HTMLDivElement>(null);
  function onKey(event: KeyboardEvent<HTMLDivElement>) {
    const at = tabs.findIndex((tab) => tab.value === value);
    let next = -1;
    if (event.key === 'ArrowRight') next = (at + 1) % tabs.length;
    else if (event.key === 'ArrowLeft') next = (at - 1 + tabs.length) % tabs.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = tabs.length - 1;
    if (next < 0) return;
    event.preventDefault();
    onChange(tabs[next].value);
    row.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus();
  }
  return (
    <div ref={row} role="tablist" aria-label={label} className="f-tabs" onKeyDown={onKey}>
      {tabs.map((tab) => {
        const selected = tab.value === value;
        return (
          <button
            key={tab.value}
            type="button"
            role="tab"
            aria-selected={selected}
            tabIndex={selected ? 0 : -1}
            className="f-tab"
            onClick={() => !selected && onChange(tab.value)}
          >
            {tab.label}
            {tab.count != null && <span className="f-tab-count">{tab.count}</span>}
          </button>
        );
      })}
    </div>
  );
}

/** Three placeholder rows while a list's first answer loads. */
export function LoadingRows({ label = 'Loading…' }: { label?: string }) {
  return (
    <div role="status" aria-busy="true" className="f-skeleton">
      <span className="f-visually-hidden">{label}</span>
      {[52, 44, 58].map((width, index) => (
        <div key={width} className="f-skeleton-row">
          <span
            className="f-skeleton-bar"
            style={{ width: `${width}%`, animationDelay: `${index * 0.15}s` }}
          />
          <span className="f-skeleton-sub" style={{ width: `${width - 22}%` }} />
        </div>
      ))}
    </div>
  );
}

/** The attempt was refused: red banner, the reason, and Try again. */
export function Refused({
  children,
  onRetry,
  retrying = false,
}: {
  children: ReactNode;
  onRetry?: () => void;
  retrying?: boolean;
}) {
  return (
    <div role="alert" className="f-alert">
      <svg width="19" height="19" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <circle cx="12" cy="12" r="9" stroke="#c0392b" strokeWidth="2" />
        <path
          d="M12 7.5 V13 M12 16 V16.5"
          stroke="#c0392b"
          strokeWidth="2.2"
          strokeLinecap="round"
        />
      </svg>
      <div>
        {children}
        {onRetry && (
          <div className="f-alert-action">
            <button
              type="button"
              className="f-btn f-btn-secondary f-btn-small"
              aria-disabled={retrying || undefined}
              onClick={() => !retrying && onRetry()}
            >
              {retrying && <span className="f-spinner" aria-hidden="true" />}
              {retrying ? 'Trying again…' : 'Try again'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

/** Earlier results stay on screen while this view updates. */
export function Updating() {
  return (
    <div role="status" className="f-retained">
      <span>Updating results…</span>
      <span>Previous results are shown while this view updates</span>
    </div>
  );
}

/** Nothing matched: a dashed box with the next step. */
export function Empty({ title, next }: { title: string; next?: string }) {
  return (
    <div className="f-empty-box">
      {title}
      {next && <div className="f-empty-next">{next}</div>}
    </div>
  );
}

export interface EvidenceRow {
  label: string;
  value: string;
}

export interface Evidence {
  title: string;
  authority: string;
  rows: EvidenceRow[];
  quote?: string;
  quoteLabel?: string;
  page?: string;
  /** "Checked on {date}" or "Not checked": whether, never who. */
  checked?: string;
  sourceHref?: string;
  sourceLabel?: string;
}

/**
 * Source evidence (Evidence Panel drawing): a drawer at the right, a bottom
 * sheet on phone. Focus moves into it and back to the opener; Tab stays inside;
 * Escape and the scrim close it; the rest of the page is inert meanwhile.
 */
export function EvidencePanel({
  evidence,
  onClose,
}: {
  evidence: Evidence | null;
  onClose: () => void;
}) {
  const panel = useRef<HTMLElement>(null);
  const close = useRef<HTMLButtonElement>(null);
  const opener = useRef<Element | null>(null);
  const open = evidence !== null;

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
      if (event.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      for (const element of inerted) element.removeAttribute('inert');
      (opener.current as HTMLElement | null)?.focus?.();
    };
  }, [open, onClose]);

  if (!evidence) return null;
  const checked = evidence.checked ?? 'Not checked';
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
                <span className="f-evidence-quote-label">{evidence.quoteLabel ?? 'QUOTE'}</span>
                {!evidence.quoteLabel && evidence.page && (
                  <>
                    {' · '}
                    <strong>Page {evidence.page}</strong>
                  </>
                )}
              </figcaption>
              <blockquote data-italic={!evidence.quoteLabel || undefined}>
                {evidence.quote}
              </blockquote>
            </figure>
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
          {evidence.sourceHref && (
            <a
              href={evidence.sourceHref}
              target="_blank"
              rel="noopener noreferrer"
              className="f-dest f-evidence-source"
            >
              <span>
                <WithArrow>{evidence.sourceLabel ?? 'View source'}</WithArrow>
              </span>
              <span className="f-visually-hidden"> (opens in a new tab)</span>
            </a>
          )}
        </div>
      </section>
    </div>
  );
}
