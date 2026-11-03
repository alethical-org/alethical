import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from 'react';

export interface MenuOption {
  value: string;
  label: string;
  /** A second line under the label (a saved version's status). */
  note?: string;
}

function Caret({ up }: { up: boolean }) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      className={up ? 'mb-caret mb-caret-up' : 'mb-caret'}
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

function Tick() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      className="mb-tick"
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

/**
 * A menu button whose list opens over the content below it (eug-19/77: wrapper
 * z-index 40, 41 while open; list z-index 1). Escape or a press outside closes
 * it and returns focus to the button; arrow keys, Home and End move between
 * options; opening focuses the chosen option.
 */
export function MenuButton({
  id,
  value,
  options,
  onChange,
  children,
  className = '',
  listLabel,
  labelledBy,
  align = 'left',
  disabled = false,
  wide = false,
}: {
  id?: string;
  value: string;
  options: ReadonlyArray<MenuOption>;
  onChange: (value: string) => void;
  /** What the closed button shows. */
  children: ReactNode;
  className?: string;
  listLabel?: string;
  labelledBy?: string;
  align?: 'left' | 'right';
  disabled?: boolean;
  /** The list spans the button's width and scrolls (form fields). */
  wide?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const wrapper = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLUListElement>(null);

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
  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);
  useLayoutEffect(() => {
    if (open)
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
    <div className="mb-menu" data-open={open || undefined} ref={wrapper}>
      <button
        ref={button}
        id={id}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-labelledby={labelledBy}
        disabled={disabled}
        className={`mb-menu-button ${className}`}
        data-open={open || undefined}
        onClick={() => setOpen((was) => !was)}
      >
        <span className="mb-menu-current">{children}</span>
        <Caret up={open} />
      </button>
      {open && (
        <ul
          ref={list}
          role="listbox"
          aria-label={labelledBy ? undefined : listLabel}
          aria-labelledby={labelledBy ? labelledBy.split(' ')[0] : undefined}
          className="mb-menu-list"
          data-align={align}
          data-wide={wide || undefined}
          onKeyDown={onListKey}
        >
          {options.map((option) => {
            const selected = option.value === value;
            return (
              <li key={option.value} role="option" aria-selected={selected}>
                <button
                  type="button"
                  className="mb-menu-option"
                  data-selected={selected || undefined}
                  onClick={() => {
                    setOpen(false);
                    button.current?.focus();
                    if (!selected) onChange(option.value);
                  }}
                >
                  {selected && <Tick />}
                  {option.note ? (
                    <span>
                      <span className="mb-menu-label">{option.label}</span>
                      <span className="mb-menu-note">{option.note}</span>
                    </span>
                  ) : (
                    option.label
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
