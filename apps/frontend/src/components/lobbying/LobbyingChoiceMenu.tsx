import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';

import { theme } from '../../theme/tokens';

export interface LobbyingChoice {
  value: string;
  label: string;
}

const TYPE_AHEAD_MS = 700;
const ink = '#11150f';
const quietInk = '#4f5651';
const disabledInk = '#8a908a';

export const CHOICE_MENU_ATTRIBUTE = 'data-alethical-choice-menu';
export const CHOICE_MENU_WEB_STYLE_ID = 'alethical-choice-menu-states';
/** Hover keeps the brand boundary every other control on the site uses. */
export const choiceMenuWebCss =
  `button[${CHOICE_MENU_ATTRIBUTE}]{-webkit-appearance:none;appearance:none;}` +
  `button[${CHOICE_MENU_ATTRIBUTE}]:not([aria-disabled="true"]):hover{border-color:${theme.colors.brand.base} !important;}`;

export function ensureChoiceMenuWebStyles(): void {
  if (typeof document === 'undefined' || document.getElementById(CHOICE_MENU_WEB_STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = CHOICE_MENU_WEB_STYLE_ID;
  style.textContent = choiceMenuWebCss;
  document.head.appendChild(style);
}

/**
 * The directory's own choice control: a closed box we draw and an open list we
 * draw, rather than the browser's grey operating-system panel.
 *
 * It follows the select-only combobox pattern, so the control keeps focus the
 * whole time and names the option a reader is on through `aria-activedescendant`.
 * The handoff put that attribute on the list instead; an attribute naming the
 * active option only reaches assistive technology when it sits on the element
 * that holds focus, so it is on the control here. Nothing drawn changes.
 */
export function LobbyingChoiceMenu({
  label,
  labelId,
  value,
  options,
  onChange,
  disabled = false,
  width,
  fullWidth = false,
  valueSize = 16,
}: {
  label: string;
  /** The persistent visible label beside or above the box names the control. */
  labelId: string;
  value: string;
  options: readonly LobbyingChoice[];
  onChange: (value: string) => void;
  disabled?: boolean;
  width?: number;
  fullWidth?: boolean;
  valueSize?: number;
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(value);
  const [hovered, setHovered] = useState<string | null>(null);
  // The purple ring belongs to a keyboard reader, so a pointer never paints it.
  const [byKeyboard, setByKeyboard] = useState(false);
  const [above, setAbove] = useState(false);
  const wrap = useRef<HTMLSpanElement | null>(null);
  const control = useRef<HTMLButtonElement | null>(null);
  const panel = useRef<HTMLSpanElement | null>(null);
  const typed = useRef({ text: '', at: 0 });
  const uid = useId();
  const listId = `${uid}list`;
  const optionId = useCallback((choice: string) => `${uid}opt-${choice}`, [uid]);
  const selected = options.find((choice) => choice.value === value);

  useEffect(() => ensureChoiceMenuWebStyles(), []);
  useEffect(() => {
    if (!open) setActive(value);
  }, [open, value]);

  // A press anywhere else closes the list and leaves the value alone. Focus is
  // not pulled back, because that would take it from whatever was pressed.
  useEffect(() => {
    if (!open) return;
    const away = (event: Event) => {
      if (!wrap.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', away, true);
    return () => document.removeEventListener('pointerdown', away, true);
  }, [open]);

  // The list opens below the box, and flips above it only when the window has
  // no room, so it is never cut off by the bottom of the screen.
  useEffect(() => {
    if (!open) {
      setAbove(false);
      return;
    }
    const box = wrap.current?.getBoundingClientRect();
    const height = panel.current?.offsetHeight ?? 0;
    if (!box) return;
    setAbove(box.bottom + 8 + height > window.innerHeight && box.top - 8 - height > 0);
  }, [open, options.length]);

  useEffect(() => {
    if (!open) return;
    document.getElementById(optionId(active))?.scrollIntoView?.({ block: 'nearest' });
  }, [open, active, optionId]);

  const openList = () => {
    if (disabled) return;
    setActive(value);
    setOpen(true);
  };
  const choose = (choice: string) => {
    onChange(choice);
    setOpen(false);
    control.current?.focus();
  };
  const dismiss = () => {
    setOpen(false);
    control.current?.focus();
  };

  /** First-letter matching, the one thing the browser's own list gave free. */
  const matchTyped = (key: string): string | undefined => {
    const now = Date.now();
    const text =
      (now - typed.current.at < TYPE_AHEAD_MS ? typed.current.text : '') + key.toLowerCase();
    typed.current = { text, at: now };
    const repeated = text.length > 1 && [...text].every((letter) => letter === text[0]);
    const needle = repeated ? text[0] : text;
    const from = repeated
      ? Math.max(
          0,
          options.findIndex((choice) => choice.value === (open ? active : value)),
        ) + 1
      : 0;
    return options
      .map((_, step) => options[(from + step) % options.length])
      .find((choice) => choice.label.toLowerCase().startsWith(needle))?.value;
  };

  const onKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (disabled) return;
    const key = event.key;
    const printable = key.length === 1 && !event.metaKey && !event.ctrlKey && !event.altKey;
    if (!open) {
      if (key === 'Enter' || key === ' ' || key === 'ArrowDown' || key === 'ArrowUp') {
        event.preventDefault();
        setByKeyboard(true);
        openList();
      } else if (printable) {
        event.preventDefault();
        const match = matchTyped(key);
        if (match) onChange(match);
      }
      return;
    }
    const at = Math.max(
      0,
      options.findIndex((choice) => choice.value === active),
    );
    // Movement stops at the ends rather than wrapping, as drawn.
    if (key === 'ArrowDown') {
      event.preventDefault();
      setByKeyboard(true);
      setActive(options[Math.min(at + 1, options.length - 1)].value);
    } else if (key === 'ArrowUp') {
      event.preventDefault();
      setByKeyboard(true);
      setActive(options[Math.max(at - 1, 0)].value);
    } else if (key === 'Home') {
      event.preventDefault();
      setByKeyboard(true);
      setActive(options[0].value);
    } else if (key === 'End') {
      event.preventDefault();
      setByKeyboard(true);
      setActive(options[options.length - 1].value);
    } else if (key === 'Enter' || key === ' ') {
      event.preventDefault();
      choose(active);
    } else if (key === 'Escape') {
      event.preventDefault();
      dismiss();
    } else if (key === 'Tab') {
      // No preventDefault: focus carries on out of the control, as it should.
      setOpen(false);
    } else if (printable) {
      event.preventDefault();
      setByKeyboard(true);
      const match = matchTyped(key);
      if (match) setActive(match);
    }
  };

  return (
    <span ref={wrap} style={wrapStyle(fullWidth, width)}>
      <button
        ref={control}
        type="button"
        role="combobox"
        {...{ [CHOICE_MENU_ATTRIBUTE]: 'true' }}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        aria-labelledby={labelId}
        aria-disabled={disabled || undefined}
        aria-activedescendant={open ? optionId(active) : undefined}
        onPointerDown={() => setByKeyboard(false)}
        onClick={() => (open ? dismiss() : openList())}
        onKeyDown={onKeyDown}
        style={closedStyle(valueSize, disabled)}
      >
        <span style={valueStyle}>{selected?.label ?? ''}</span>
        <Chevron open={open} disabled={disabled} />
      </button>
      {open ? (
        <span
          ref={panel}
          role="listbox"
          id={listId}
          aria-label={label}
          style={panelStyle(above)}
          onMouseLeave={() => setHovered(null)}
        >
          {options.map((choice) => {
            const chosen = choice.value === value;
            const onNow = byKeyboard && choice.value === active;
            return (
              <span
                key={choice.value}
                role="option"
                id={optionId(choice.value)}
                aria-selected={chosen}
                onMouseEnter={() => {
                  setHovered(choice.value);
                  setByKeyboard(false);
                }}
                onClick={() => choose(choice.value)}
                style={optionStyle(valueSize, chosen, onNow, hovered === choice.value)}
              >
                {chosen ? <Tick /> : <span aria-hidden="true" style={tickSpacer} />}
                <span style={optionLabelStyle}>{choice.label}</span>
              </span>
            );
          })}
        </span>
      ) : null}
    </span>
  );
}

function Chevron({ open, disabled }: { open: boolean; disabled: boolean }) {
  return (
    <svg
      width={15}
      height={15}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      style={{ flexShrink: 0, transform: open ? 'rotate(180deg)' : undefined }}
    >
      <path
        d="M6 9 L12 15 L18 9"
        stroke={disabled ? disabledInk : quietInk}
        strokeWidth={2.4}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** The chosen option carries 3 marks, so its state never rests on colour alone. */
function Tick() {
  return (
    <svg
      width={15}
      height={15}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      style={tickSpacer}
    >
      <path
        d="M5 13 L9.5 17.5 L19 7"
        stroke="#0f7a45"
        strokeWidth={2.6}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

const tickSpacer: CSSProperties = { width: 15, height: 15, flexShrink: 0, display: 'block' };

function wrapStyle(fullWidth: boolean, width?: number): CSSProperties {
  return {
    position: 'relative',
    display: 'block',
    minWidth: 0,
    width: fullWidth ? '100%' : width,
    maxWidth: '100%',
    flexShrink: 0,
  };
}

/**
 * A height floor rather than a fixed height: on the narrowest phones the longest
 * choice takes 2 lines and the box grows, which beats hiding half a value.
 */
function closedStyle(size: number, disabled: boolean): CSSProperties {
  return {
    boxSizing: 'border-box',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    width: '100%',
    minHeight: 48,
    margin: 0,
    padding: '9px 16px 9px 14px',
    background: disabled ? '#f4f5f4' : '#ffffff',
    border: `1px solid rgba(17,21,15,${disabled ? '0.1' : '0.18'})`,
    borderRadius: 12,
    fontFamily: theme.typography.body,
    fontSize: size,
    fontWeight: 700,
    lineHeight: 1.25,
    color: disabled ? disabledInk : ink,
    textAlign: 'left',
    cursor: disabled ? 'not-allowed' : 'pointer',
    fontVariantNumeric: 'tabular-nums',
  };
}

const valueStyle: CSSProperties = { flex: 1, minWidth: 0 };

function panelStyle(above: boolean): CSSProperties {
  return {
    position: 'absolute',
    left: 0,
    right: 0,
    ...(above ? { bottom: '100%', marginBottom: 8 } : { top: '100%', marginTop: 8 }),
    boxSizing: 'border-box',
    display: 'block',
    padding: 6,
    background: '#ffffff',
    border: '1px solid rgba(17,21,15,0.14)',
    borderRadius: 14,
    boxShadow: '0 14px 34px rgba(17,21,15,0.14)',
    maxHeight: 320,
    overflowY: 'auto',
    zIndex: 40,
  };
}

function optionStyle(
  size: number,
  chosen: boolean,
  keyboardActive: boolean,
  pointerOver: boolean,
): CSSProperties {
  return {
    boxSizing: 'border-box',
    display: 'flex',
    alignItems: 'center',
    gap: 9,
    minHeight: 44,
    padding: '10px 12px',
    borderRadius: 9,
    fontFamily: theme.typography.body,
    fontSize: size,
    fontWeight: chosen ? 700 : 500,
    lineHeight: 1.25,
    color: ink,
    // The chosen wash holds while a pointer passes over it; the neutral wash is
    // for the others, and never the chosen green.
    background: chosen ? '#f2fbf6' : keyboardActive || pointerOver ? '#f1f4f2' : 'transparent',
    // Drawn inside the edge so the ring never crosses the panel's own boundary.
    outline: keyboardActive ? '2px solid #7c5cff' : undefined,
    outlineOffset: keyboardActive ? -2 : undefined,
    cursor: 'pointer',
    fontVariantNumeric: 'tabular-nums',
  };
}

const optionLabelStyle: CSSProperties = { flex: 1, minWidth: 0 };
