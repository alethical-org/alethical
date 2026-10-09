import {
  useEffect,
  useId,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
  type Ref,
} from 'react';
import { Platform, TextInput } from 'react-native';
import { addressSuggestionInput } from '../../lib/findMyLegislator';
import { preserveSuggestedUnit } from '../../lib/addressSuggestion';
import { browserFillInputProps, ensureBrowserFillStyles } from '../../theme/browserFill';
import { fieldFocusRing, fieldOutlineReset } from '../../theme/fieldFocus';
import { theme } from '../../theme/tokens';
import { ClearAddressButton } from './ClearAddressButton';
import { useAddressInputValue } from './useAddressInputValue';

export type AddressSuggestion<T> = { id: string; address: string; value: T };
export type AddressFieldHandle = {
  focus(): void;
  selectAll(): void;
  value(): string;
  dismiss(): void;
};
export function AddressSuggestionField<T>({
  address,
  onAddress,
  suggest,
  onSubmit,
  fieldRef,
  labelId,
  describedBy,
  invalid,
  busy,
  mobile,
  compact = false,
  suggestionsEnabled = true,
  onEscape,
  onClear,
}: {
  address: string;
  onAddress(value: string): void;
  suggest(value: string, signal: AbortSignal): Promise<AddressSuggestion<T>[]>;
  onSubmit(value: string, choice?: T): void;
  fieldRef?: Ref<AddressFieldHandle>;
  labelId: string;
  describedBy?: string;
  invalid?: boolean;
  busy: boolean;
  mobile: boolean;
  compact?: boolean;
  suggestionsEnabled?: boolean;
  onEscape?(): void;
  onClear?(): void;
}) {
  const id = useId().replace(/:/g, '');
  const field = useRef<HTMLTextAreaElement>(null);
  const native = useRef<TextInput>(null);
  const wrapper = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const generation = useRef(0);
  const quietUntilEdit = useRef(false);
  const lastRequestAt = useRef(-Infinity);
  const lastInputAt = useRef(-Infinity);
  const immediateInput = useRef(false);
  const pending = useRef<{
    address: string;
    controller: AbortController;
    promise: Promise<AddressSuggestion<T>[]>;
  } | null>(null);
  // Field-local only: no browser storage or reuse across mounted search forms.
  const recent = useRef(new Map<string, { expires: number; options: AddressSuggestion<T>[] }>());
  const suggestionSource = useRef(suggest);
  const pointer = useRef<{ x: number; y: number; moved: boolean } | null>(null);
  const cancelled = useRef(false);
  const manualScroll = useRef(false);
  const [focused, setFocused] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [open, setOpen] = useState(false);
  const [options, setOptions] = useState<AddressSuggestion<T>[]>([]);
  const [active, setActive] = useState(-1);
  const [hovered, setHovered] = useState(-1);
  const [fieldHovered, setFieldHovered] = useState(false);
  useLayoutEffect(() => {
    if (open && active >= 0)
      document
        .getElementById(`${id}-option-${active}`)
        ?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  }, [open, active, id]);
  const value = () => field.current?.value ?? address;
  const dismiss = (forgetOptions = false) => {
    generation.current += 1;
    pending.current?.controller.abort();
    pending.current = null;
    if (forgetOptions) setOptions([]);
    setOpen(false);
    setActive(-1);
    setHovered(-1);
    manualScroll.current = false;
  };
  const focus = () => {
    field.current?.focus();
    native.current?.focus();
  };
  useImperativeHandle(fieldRef, () => ({
    focus,
    selectAll: () => {
      quietUntilEdit.current = true;
      dismiss(true);
      setEnabled(false);
      focus();
      field.current?.select();
    },
    value,
    dismiss: () => {
      dismiss(true);
      // External submit controls consume their click. Do not rely on outside
      // dismissal to prevent busy/result changes from restarting suggestions.
      setEnabled(false);
    },
  }));
  useEffect(() => {
    ensureBrowserFillStyles();
  }, []);
  useLayoutEffect(() => {
    if (field.current && field.current.value !== address) field.current.value = address;
  }, [address]);
  const actualAddress = useAddressInputValue(field, address);
  useLayoutEffect(() => {
    const element = field.current;
    if (!element) return;
    const resize = () => {
      element.style.height = 'auto';
      element.style.height = `${Math.max(compact ? 56 : 60, element.scrollHeight + 2)}px`;
    };
    resize();
    if (typeof ResizeObserver === 'undefined') return;
    let width = element.getBoundingClientRect().width;
    const observer = new ResizeObserver(() => {
      const next = element.getBoundingClientRect().width;
      if (next !== width) {
        width = next;
        resize();
      }
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [address, actualAddress, compact]);
  useEffect(() => () => pending.current?.controller.abort(), []);
  useEffect(() => {
    const request = ++generation.current;
    const requestAddress = address.trim();
    setOptions([]);
    setOpen(false);
    setActive(-1);
    setHovered(-1);
    const input = addressSuggestionInput(requestAddress);
    const immediate = immediateInput.current;
    immediateInput.current = false;
    const now = Date.now();
    const idle = now - lastInputAt.current >= 180;
    lastInputAt.current = now;
    if (!requestAddress || busy || suggestionSource.current !== suggest) recent.current.clear();
    if (
      pending.current &&
      (pending.current.address !== requestAddress ||
        suggestionSource.current !== suggest ||
        !enabled ||
        !suggestionsEnabled ||
        busy)
    ) {
      pending.current.controller.abort();
      pending.current = null;
    }
    suggestionSource.current = suggest;
    for (const [key, entry] of recent.current) {
      if (entry.expires <= Date.now()) recent.current.delete(key);
    }
    if (!enabled || !suggestionsEnabled || busy || !input) return;
    const cached = recent.current.get(requestAddress);
    if (cached) {
      setOptions(cached.options);
      setOpen(cached.options.length > 0);
      return;
    }
    // The first eligible input and edits after an idle period start immediately.
    // Pasting, dropping or browser-replacing a complete value also skips the pause.
    // Continuing keystrokes share one trailing request to preserve the service
    // budget instead of spending a request on each letter.
    const run = () => {
      if (request !== generation.current) return;
      let current = pending.current;
      if (!current) {
        const controller = new AbortController();
        lastRequestAt.current = Date.now();
        current = {
          address: requestAddress,
          controller,
          promise: suggest(input, controller.signal),
        };
        pending.current = current;
      }
      const activeRequest = current;
      void activeRequest.promise
        .then((matches) => {
          if (
            request !== generation.current ||
            activeRequest.controller.signal.aborted ||
            value().trim() !== requestAddress
          )
            return;
          const safe = matches
            .flatMap((option) => {
              const preserved = preserveSuggestedUnit(requestAddress, option.address);
              return preserved ? [{ ...option, address: preserved }] : [];
            })
            .slice(0, 5);
          if (safe.length) {
            recent.current.delete(requestAddress);
            recent.current.set(requestAddress, { expires: Date.now() + 60_000, options: safe });
            while (recent.current.size > 8)
              recent.current.delete(recent.current.keys().next().value!);
          }
          setOptions(safe);
          setOpen(safe.length > 0);
          setActive(-1);
        })
        .catch(() => {
          /* Optional suggestions never block typed search. */
        })
        .finally(() => {
          if (pending.current === activeRequest) pending.current = null;
        });
    };
    // Attach before a pending reply can settle, without another network request.
    if (pending.current) {
      run();
      return;
    }
    const timer = setTimeout(
      run,
      lastRequestAt.current === -Infinity || idle || immediate ? 0 : 180,
    );
    return () => clearTimeout(timer);
  }, [address, enabled, suggestionsEnabled, busy, suggest]);

  // Do not collapse an inline list between pointer-down and click: that moves
  // the Search button under a finger, and can erase the option being tapped.
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const down = (event: PointerEvent) => {
      clearTimeout(releaseTimer);
      pointer.current = { x: event.clientX, y: event.clientY, moved: false };
      cancelled.current = false;
    };
    const move = (event: PointerEvent) => {
      if (!pointer.current) return;
      if (Math.hypot(event.clientX - pointer.current.x, event.clientY - pointer.current.y) > 8) {
        pointer.current.moved = true;
        manualScroll.current = true;
      }
    };
    let releaseTimer: ReturnType<typeof setTimeout> | undefined;
    const up = () => {
      if (pointer.current?.moved) cancelled.current = true;
      // click follows pointerup; a scroll has no click, so release its blur guard too.
      releaseTimer = setTimeout(() => {
        pointer.current = null;
      }, 0);
    };
    const cancel = () => {
      cancelled.current = true;
      pointer.current = null;
    };
    const click = (event: MouseEvent) => {
      if (!wrapper.current?.contains(event.target as Node)) {
        dismiss();
        setEnabled(false);
      }
      pointer.current = null;
    };
    const wheel = () => {
      manualScroll.current = true;
    };
    document.addEventListener('pointerdown', down, true);
    document.addEventListener('pointermove', move, true);
    document.addEventListener('pointerup', up, true);
    document.addEventListener('pointercancel', cancel, true);
    document.addEventListener('click', click);
    document.addEventListener('wheel', wheel, { passive: true });
    return () => {
      document.removeEventListener('pointerdown', down, true);
      document.removeEventListener('pointermove', move, true);
      clearTimeout(releaseTimer);
      document.removeEventListener('pointerup', up, true);
      document.removeEventListener('pointercancel', cancel, true);
      document.removeEventListener('click', click);
      document.removeEventListener('wheel', wheel);
    };
  }, []);
  useEffect(() => {
    if (!mobile || !open || Platform.OS !== 'web') return;
    let frame = 0;
    const reveal = () => {
      if (manualScroll.current || !panel.current || !wrapper.current) return;
      const top =
        document.getElementById(labelId)?.getBoundingClientRect().top ??
        wrapper.current.getBoundingClientRect().top;
      const viewport = window.visualViewport;
      const viewportTop = viewport?.offsetTop ?? 0;
      const bottom = viewportTop + (viewport?.height ?? window.innerHeight);
      const needed = panel.current.getBoundingClientRect().bottom - bottom + 12;
      const delta = Math.min(needed, top - viewportTop - 12);
      if (delta <= 0) return;
      let scrollParent = wrapper.current.parentElement;
      while (scrollParent && !/(auto|scroll)/.test(getComputedStyle(scrollParent).overflowY))
        scrollParent = scrollParent.parentElement;
      if (scrollParent) scrollParent.scrollBy?.({ top: delta, behavior: 'instant' });
      else window.scrollBy({ top: delta, behavior: 'instant' });
    };
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(reveal);
    };
    schedule();
    window.visualViewport?.addEventListener('resize', schedule);
    return () => {
      cancelAnimationFrame(frame);
      window.visualViewport?.removeEventListener('resize', schedule);
    };
  }, [mobile, open, labelId]);
  const submit = (option?: AddressSuggestion<T>) => {
    if (busy) return;
    const current = value();
    const chosen = current === address ? option : undefined;
    const next = chosen?.address ?? current;
    dismiss(true);
    setEnabled(false);
    if (field.current) field.current.value = next;
    onSubmit(next, chosen?.value);
  };
  const clear = () => {
    if (busy) return;
    quietUntilEdit.current = true;
    dismiss(true);
    setEnabled(false);
    recent.current.clear();
    if (field.current) {
      field.current.value = '';
      field.current.dispatchEvent(new Event('input', { bubbles: true }));
    }
    onAddress('');
    onClear?.();
    focus();
  };
  if (Platform.OS !== 'web')
    return (
      <TextInput
        ref={native}
        accessibilityLabel="Full street address"
        value={address}
        onChangeText={onAddress}
        onSubmitEditing={() => submit()}
        autoComplete="street-address"
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        style={[...fieldFocusRing(focused), fieldOutlineReset]}
      />
    );
  return (
    <div ref={wrapper} style={{ position: 'relative', minWidth: 0, width: '100%', zIndex: 2 }}>
      <style>{`@media(hover:hover) and (pointer:fine){[data-address-option]:hover {background:#f5f6f7}} [data-address-option][aria-selected="true"] {background:#e9f7ef} @media(forced-colors:active){[data-address-option][aria-selected="true"]{outline:2px solid Highlight;outline-offset:-2px}}`}</style>
      <textarea
        ref={field}
        rows={1}
        {...browserFillInputProps}
        defaultValue={address}
        placeholder="350 S 5th St, Minneapolis, MN 55415"
        autoComplete="street-address"
        name="street-address"
        enterKeyHint="search"
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={open}
        aria-controls={open ? `${id}-list` : undefined}
        aria-activedescendant={open && active >= 0 ? `${id}-option-${active}` : undefined}
        aria-labelledby={labelId}
        aria-describedby={describedBy}
        aria-invalid={invalid || undefined}
        style={{
          display: 'block',
          width: '100%',
          minHeight: compact ? 56 : 60,
          boxSizing: 'border-box',
          padding: compact ? '15px 56px 15px 16px' : '17px 60px 17px 18px',
          borderRadius: compact ? 12 : 14,
          border: `1px solid ${focused ? '#5b30d6' : invalid ? '#a3421a' : fieldHovered ? 'rgba(17,21,15,.4)' : 'rgba(17,21,15,.22)'}`,
          boxShadow: focused ? '0 0 0 3px rgba(91,48,214,.22)' : 'none',
          outline: 'none',
          background: '#fff',
          color: '#11150f',
          fontFamily: theme.typography.body,
          fontSize: compact ? 16.5 : 17,
          fontVariantNumeric: 'tabular-nums',
          lineHeight: '24px',
          resize: 'none',
          overflow: 'hidden',
          overflowWrap: 'anywhere',
        }}
        onMouseEnter={() => setFieldHovered(true)}
        onMouseLeave={() => setFieldHovered(false)}
        onChange={(event) => {
          quietUntilEdit.current = false;
          const next = event.target.value.replace(/[\r\n]+/g, ' ');
          // Spaces around the same query must not cancel its useful pending reply.
          if (next.trim() !== address.trim()) {
            dismiss();
            const inputType = (event.nativeEvent as InputEvent).inputType;
            immediateInput.current = [
              'insertFromPaste',
              'insertReplacementText',
              'insertFromDrop',
            ].includes(inputType);
          }
          setEnabled(true);
          event.target.value = next;
          onAddress(next);
        }}
        onFocus={() => {
          if (!quietUntilEdit.current && value() !== address) onAddress(value());
          setFocused(true);
          setEnabled(!quietUntilEdit.current);
        }}
        onBlur={(event) => {
          setFocused(false);
          if (value() !== address) onAddress(value());
          if (!pointer.current && !wrapper.current?.contains(event.relatedTarget as Node)) {
            dismiss();
            setEnabled(false);
          }
        }}
        onKeyDown={(event) => {
          if (event.nativeEvent.isComposing) return;
          if (event.key === 'Escape') {
            event.preventDefault();
            if (!open) onEscape?.();
            dismiss();
            return;
          }
          if (event.key === 'Tab') {
            dismiss();
            setEnabled(false);
            return;
          }
          if ((event.key === 'ArrowDown' || event.key === 'ArrowUp') && options.length) {
            event.preventDefault();
            setOpen(true);
            const next =
              !open || active < 0
                ? event.key === 'ArrowDown'
                  ? 0
                  : options.length - 1
                : (active + (event.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length;
            setActive(next);
            return;
          }
          if (event.key === 'Enter') {
            event.preventDefault();
            submit(open && active >= 0 ? options[active] : undefined);
          }
        }}
      />
      <ClearAddressButton
        visible={Boolean(actualAddress) && !busy}
        top={compact ? 6 : 8}
        right={compact ? 6 : 8}
        onClear={clear}
      />
      {open && (
        <div
          ref={panel}
          style={{
            position: mobile ? 'relative' : 'absolute',
            top: mobile ? undefined : '100%',
            marginTop: 8,
            left: 0,
            width: '100%',
            boxSizing: 'border-box',
            zIndex: 30,
            background: '#fff',
            border: '1px solid rgba(17,21,15,.14)',
            borderRadius: 14,
            padding: 6,
            boxShadow: '0 16px 40px rgba(17,21,15,.16)',
          }}
        >
          <div
            id={`${id}-heading`}
            style={{
              padding: '8px 12px 6px',
              fontFamily: theme.typography.body,
              fontSize: 13.5,
              fontWeight: 700,
              color: '#4f5651',
            }}
          >
            {options.length === 1 ? 'Suggested address' : 'Suggested addresses'}
          </div>
          <div id={`${id}-list`} role="listbox" aria-labelledby={`${id}-heading`}>
            {options.map((option, index) => (
              <div
                key={option.id}
                id={`${id}-option-${index}`}
                data-address-option
                role="option"
                aria-selected={active === index}
                tabIndex={-1}
                onPointerEnter={(event) => {
                  if (event.pointerType === 'mouse') setHovered(index);
                }}
                onPointerLeave={() => setHovered(-1)}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => {
                  if (!cancelled.current && !pointer.current?.moved) submit(option);
                }}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  minHeight: 52,
                  boxSizing: 'border-box',
                  padding: '10px 12px',
                  borderRadius: 10,
                  gap: 12,
                  cursor: 'pointer',
                  background:
                    active === index ? '#e9f7ef' : hovered === index ? '#f5f6f7' : undefined,
                }}
              >
                <svg
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  fill="none"
                  aria-hidden="true"
                  style={{ flexShrink: 0 }}
                >
                  <path
                    d="M12 21S5 14.5 5 9.5a7 7 0 0 1 14 0C19 14.5 12 21 12 21Z"
                    stroke="#4f5651"
                    strokeWidth="2"
                  />
                  <circle cx="12" cy="9.5" r="2.5" stroke="#4f5651" strokeWidth="2" />
                </svg>
                <span
                  style={{
                    minWidth: 0,
                    overflowWrap: 'anywhere',
                    fontFamily: theme.typography.body,
                    fontVariantNumeric: 'tabular-nums',
                    fontSize: 16,
                    fontWeight: 600,
                    lineHeight: 1.35,
                    color: '#11150f',
                  }}
                >
                  {option.address}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
      <span
        aria-live="polite"
        aria-atomic="true"
        style={{
          position: 'absolute',
          width: 1,
          height: 1,
          overflow: 'hidden',
          clipPath: 'inset(50%)',
        }}
      >
        {open
          ? `${options.length} suggested ${options.length === 1 ? 'address' : 'addresses'} below the address box`
          : ''}
      </span>
    </div>
  );
}
