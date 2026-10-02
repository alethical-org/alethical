import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import { Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';
import { currentAddressInput } from '../../lib/currentAddressInput';
import { useResponsive } from '../../hooks/useResponsive';
import { theme as t } from '../../theme/tokens';
import { fieldFocusRing, fieldOutlineReset } from '../../theme/fieldFocus';
import { CandidateButton, candidateText } from './CandidateControls';
import type {
  CandidateAddressChoice,
  CandidateLookupResponse,
  CandidateSearchServices,
} from './types';

const errors = {
  'no-match': 'We couldn’t match that address: check the street address, city, and ZIP code',
  'outside-minnesota': 'This search covers Minnesota addresses',
  'rate-limited': 'Too many searches: try again shortly',
};
export function CandidateAddressForm({
  services,
  address,
  onAddress,
  onSubmit,
  busy,
  outcome,
  focus = false,
  onCancel,
  compact = false,
  privacyDisclosure,
  showBusyMessage = true,
}: {
  services: CandidateSearchServices;
  address: string;
  onAddress(value: string): void;
  onSubmit(address: string, choice?: CandidateAddressChoice): void;
  busy: boolean;
  outcome: Exclude<CandidateLookupResponse, { kind: 'results' }> | null;
  focus?: boolean;
  onCancel?(): void;
  compact?: boolean;
  privacyDisclosure?: string;
  showBusyMessage?: boolean;
}) {
  const { isMobile, isDesktop } = useResponsive();
  const id = useId().replace(/:/g, '');
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const nativeRef = useRef<TextInput>(null);
  const choicesRef = useRef<View>(null);
  const generation = useRef(0);
  const [suggestions, setSuggestions] = useState<CandidateAddressChoice[]>([]);
  const [suggestOpen, setSuggestOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [choiceActive, setChoiceActive] = useState(0);
  const [choicesOpen, setChoicesOpen] = useState(false);
  const [focused, setFocused] = useState(false);
  const [missing, setMissing] = useState(false);
  const [fieldHover, setFieldHover] = useState(false);
  useLayoutEffect(() => {
    // Explicit address changes still update the field. Suggestion, hover, and
    // other renders must not overwrite a browser fill whose event has not fired.
    if (inputRef.current && inputRef.current.value !== address) inputRef.current.value = address;
  }, [address]);
  useLayoutEffect(() => {
    const field = inputRef.current;
    if (!field) return;
    const resize = () => {
      field.style.height = 'auto';
      field.style.height = `${Math.max(compact ? 54 : 58, field.scrollHeight)}px`;
    };
    resize();
    if (typeof ResizeObserver === 'undefined') return;
    let width = field.getBoundingClientRect().width;
    const observer = new ResizeObserver(() => {
      const nextWidth = field.getBoundingClientRect().width;
      if (nextWidth !== width) {
        width = nextWidth;
        resize();
      }
    });
    observer.observe(field);
    return () => observer.disconnect();
  }, [address, compact]);
  const focusField = () => {
    inputRef.current?.focus();
    nativeRef.current?.focus();
  };
  useEffect(() => {
    if (focus) focusField();
  }, [focus]);
  useEffect(() => {
    const token = ++generation.current;
    const controller = new AbortController();
    setSuggestions([]);
    setSuggestOpen(false);
    setActive(-1);
    if (!focused || address.trim().length < 6 || busy) return () => controller.abort();
    const timer = setTimeout(() => {
      void services
        .suggest(address.trim(), controller.signal)
        .then((matches) => {
          if (token !== generation.current || controller.signal.aborted) return;
          setSuggestions(matches);
          setSuggestOpen(matches.length > 0);
        })
        .catch(() => {
          /* Suggestions are optional; explicit submit still works. */
        });
    }, 180);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [address, busy, focused, services]);
  useEffect(() => {
    setChoicesOpen(outcome?.kind === 'ambiguous');
    setChoiceActive(0);
  }, [outcome]);
  useEffect(() => {
    if (choicesOpen) {
      const node = choicesRef.current as unknown as HTMLElement | null;
      node?.focus?.();
    }
  }, [choicesOpen]);
  const choices = outcome?.kind === 'ambiguous' ? outcome.choices : [];
  const visibleAddress = () => currentAddressInput(inputRef.current, address);
  const submit = (choice?: CandidateAddressChoice) => {
    if (busy) return;
    const value = visibleAddress();
    // A browser-filled replacement invalidates any old highlighted suggestion.
    const changed = value !== address;
    if (changed) {
      generation.current += 1;
      setSuggestions([]);
      setActive(-1);
      onAddress(value);
    }
    if (!value.trim()) {
      setMissing(true);
      focusField();
      return;
    }
    setMissing(false);
    setSuggestOpen(false);
    setChoicesOpen(false);
    if (choice && !changed) onSubmit(value, choice);
    else onSubmit(value);
  };
  const pick = (choice: CandidateAddressChoice) => submit(choice);
  const fieldKey = (event: ReactKeyboardEvent<HTMLElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      if (!suggestOpen && !choicesOpen) onCancel?.();
      setSuggestOpen(false);
      setChoicesOpen(false);
      return;
    }
    if (
      suggestOpen &&
      suggestions.length &&
      (event.key === 'ArrowDown' || event.key === 'ArrowUp')
    ) {
      event.preventDefault();
      setActive(
        (index) =>
          (index + (event.key === 'ArrowDown' ? 1 : -1) + suggestions.length) % suggestions.length,
      );
      return;
    }
    if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
      event.preventDefault();
      if (suggestOpen && active >= 0 && suggestions[active]) pick(suggestions[active]);
      else submit();
    }
  };
  const choiceKey = (event: ReactKeyboardEvent<HTMLElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      setChoicesOpen(false);
      focusField();
      return;
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      setChoiceActive(
        (index) => (index + (event.key === 'ArrowDown' ? 1 : -1) + choices.length) % choices.length,
      );
    }
    if ((event.key === 'Enter' || event.key === ' ') && choices[choiceActive]) {
      event.preventDefault();
      pick(choices[choiceActive]);
    }
  };
  const errorKind =
    outcome && outcome.kind in errors ? (outcome.kind as keyof typeof errors) : null;
  const message = busy
    ? ''
    : missing
      ? 'Enter your full Minnesota street address'
      : errorKind
        ? errors[errorKind]
        : '';
  const invalid =
    !busy && (missing || errorKind === 'no-match' || errorKind === 'outside-minnesota');
  const inputStyle = {
    width: '100%',
    minHeight: compact ? 54 : 58,
    padding: compact ? '14px 16px' : '16px 18px',
    border: 'none',
    borderRadius: compact ? 12 : 14,
    background: '#fff',
    color: '#11150f',
    fontFamily: t.typography.body,
    fontSize: compact ? 16.5 : 17,
    outline: 'none',
    boxSizing: 'border-box' as const,
    fontVariantNumeric: 'tabular-nums' as const,
    scrollMarginTop: 90,
    resize: 'none' as const,
    overflow: 'hidden',
    overflowWrap: 'anywhere' as const,
    lineHeight: '26px',
  };
  return (
    <View style={[styles.form, compact && { marginTop: 0 }]}>
      <Text nativeID={`${id}-label`} style={candidateText.strong}>
        Full street address
      </Text>
      <View style={[styles.controls, (isMobile || compact) && { flexDirection: 'column' }]}>
        <View
          style={[styles.fieldWrap, (isMobile || compact) && { flex: undefined, width: '100%' }]}
        >
          <View
            style={[
              styles.inputBorder,
              compact && { minHeight: 56, borderRadius: 12 },
              {
                borderColor: invalid
                  ? '#a3421a'
                  : fieldHover
                    ? 'rgba(17,21,15,0.4)'
                    : 'rgba(17,21,15,0.18)',
              },
              ...fieldFocusRing(focused),
            ]}
          >
            {Platform.OS === 'web' ? (
              <textarea
                rows={1}
                ref={inputRef}
                aria-labelledby={`${id}-label`}
                role="combobox"
                aria-autocomplete="list"
                aria-expanded={suggestOpen}
                aria-controls={`${id}-suggestions`}
                aria-activedescendant={
                  suggestOpen && active >= 0 ? `${id}-suggestion-${active}` : undefined
                }
                aria-invalid={invalid || undefined}
                aria-describedby={`${id}-message ${id}-help`}
                autoComplete="street-address"
                enterKeyHint="search"
                defaultValue={address}
                placeholder="350 S 5th St, Minneapolis, MN 55415"
                style={inputStyle}
                onChange={(event) => {
                  setMissing(false);
                  setChoicesOpen(false);
                  const value = event.target.value.replace(/[\r\n]+/g, ' ');
                  event.target.value = value;
                  onAddress(value);
                }}
                onFocus={() => {
                  const value = visibleAddress();
                  if (value !== address) onAddress(value);
                  setFocused(true);
                  if (isMobile) inputRef.current?.scrollIntoView?.({ block: 'nearest' });
                }}
                onBlur={() => {
                  const value = visibleAddress();
                  if (value !== address) {
                    generation.current += 1;
                    setSuggestions([]);
                    setChoicesOpen(false);
                    onAddress(value);
                  }
                  setFocused(false);
                  setSuggestOpen(false);
                }}
                onKeyDown={fieldKey}
                onMouseEnter={() => !isMobile && setFieldHover(true)}
                onMouseLeave={() => setFieldHover(false)}
              />
            ) : (
              <TextInput
                ref={nativeRef}
                accessibilityLabel="Full street address"
                value={address}
                onChangeText={onAddress}
                onSubmitEditing={() => submit()}
                autoComplete="street-address"
                placeholder="350 S 5th St, Minneapolis, MN 55415"
                style={[styles.nativeInput, fieldOutlineReset]}
                onFocus={() => setFocused(true)}
                onBlur={() => setFocused(false)}
              />
            )}
          </View>
          {suggestOpen ? (
            <View
              nativeID={`${id}-suggestions`}
              {...({ role: 'listbox' } as object)}
              accessibilityLabel={
                suggestions.length === 1 ? 'Suggested address' : 'Suggested addresses'
              }
              style={[styles.suggestions, !isMobile && styles.suggestionOverlay]}
            >
              <Text style={styles.suggestionHeading}>
                {suggestions.length === 1 ? 'Suggested address' : 'Suggested addresses'}
              </Text>
              {suggestions.map((choice, index) => (
                <Choice
                  key={choice.id}
                  id={`${id}-suggestion-${index}`}
                  label={choice.label}
                  selected={active === index}
                  onPress={() => pick(choice)}
                  keepFieldFocus
                />
              ))}
            </View>
          ) : null}
        </View>
        <CandidateButton
          label="Find my candidates"
          busyLabel="Finding candidates…"
          busy={busy}
          // Keep suggestions from collapsing and moving this target between
          // pointer press and release. Keyboard focus remains unchanged.
          keepFieldFocus
          onPress={() => submit()}
          style={{
            minHeight: compact ? 52 : 60,
            width: isMobile || compact ? '100%' : isDesktop ? 248 : 220,
            alignSelf: 'flex-start',
            height: compact ? 52 : 60,
            borderRadius: 14,
          }}
        />
      </View>
      <View aria-live="polite" style={styles.hiddenStatus}>
        {busy && showBusyMessage ? <Text>Finding candidates…</Text> : null}
      </View>
      <View
        nativeID={`${id}-message`}
        aria-live="polite"
        accessibilityRole={errorKind === 'rate-limited' ? 'alert' : undefined}
        style={[styles.message, compact && { marginTop: 10 }]}
      >
        {message ? (
          <>
            {!busy ? <MessageIcon rate={errorKind === 'rate-limited'} /> : null}
            <Text
              style={[
                candidateText.strong,
                {
                  fontSize: 15,
                  lineHeight: 22,
                  flexShrink: 1,
                  color: invalid ? '#a3421a' : '#11150f',
                },
              ]}
            >
              {message}
            </Text>
          </>
        ) : null}
      </View>
      {compact ? (
        <Text
          nativeID={`${id}-help`}
          style={[candidateText.body, { fontSize: 14.5, lineHeight: 22 }]}
        >
          A city or ZIP code alone cannot identify your local races
        </Text>
      ) : null}
      {choicesOpen ? (
        <View style={{ marginTop: 22, gap: 10 }}>
          <Text nativeID={`${id}-choices-heading`} style={[candidateText.strong, { fontSize: 17 }]}>
            Choose your address
          </Text>
          <View
            ref={choicesRef}
            {...({ role: 'listbox' } as object)}
            aria-labelledby={`${id}-choices-heading`}
            tabIndex={0}
            aria-activedescendant={`${id}-choice-${choiceActive}`}
            style={{ gap: 8, borderRadius: 12 }}
            {...(Platform.OS === 'web' ? { onKeyDown: choiceKey } : {})}
          >
            {choices.map((choice, index) => (
              <Choice
                key={choice.id}
                id={`${id}-choice-${index}`}
                label={choice.label}
                selected={choiceActive === index}
                onPress={() => pick(choice)}
              />
            ))}
          </View>
        </View>
      ) : null}
      {!compact ? (
        <View style={styles.privacy}>
          <Text nativeID={`${id}-help`} style={styles.help}>
            A city or ZIP code alone cannot identify your local races
          </Text>
          <Text style={styles.help}>
            {privacyDisclosure ??
              'Address lookup uses Minnesota Secretary of State and Minnesota mapping services'}
          </Text>
        </View>
      ) : null}
    </View>
  );
}
function Choice({
  id,
  label,
  selected,
  onPress,
  keepFieldFocus = false,
}: {
  id: string;
  label: string;
  selected: boolean;
  onPress(): void;
  keepFieldFocus?: boolean;
}) {
  const [hovered, setHovered] = useState(false);
  const { isMobile } = useResponsive();
  return (
    <Pressable
      nativeID={id}
      role="option"
      aria-selected={selected}
      tabIndex={-1}
      onPress={onPress}
      onHoverIn={() => !isMobile && setHovered(true)}
      onHoverOut={() => setHovered(false)}
      {...(Platform.OS === 'web' && keepFieldFocus
        ? { onMouseDown: (event: React.MouseEvent) => event.preventDefault() }
        : {})}
      style={[
        styles.choice,
        keepFieldFocus && {
          minHeight: 52,
          paddingHorizontal: 12,
          paddingVertical: 10,
          borderRadius: 10,
          borderWidth: 0,
        },
        selected && {
          backgroundColor: keepFieldFocus ? '#e9f7ef' : '#f2fbf6',
          borderColor: '#2ed47e',
        },
        hovered && { backgroundColor: '#f5f6f7', borderColor: 'rgba(17,21,15,0.3)' },
      ]}
    >
      <Svg
        width={18}
        height={18}
        viewBox="0 0 24 24"
        fill="none"
        aria-hidden
        style={{ flexShrink: 0 }}
      >
        <Path
          d="M12 21 C12 21 5 14.5 5 9.5 A7 7 0 0 1 19 9.5 C19 14.5 12 21 12 21 Z"
          stroke="#4f5651"
          strokeWidth={2}
          strokeLinejoin="round"
        />
        <Circle cx={12} cy={9.5} r={2.5} stroke="#4f5651" strokeWidth={2} />
      </Svg>
      <Text
        style={[candidateText.strong, { flex: 1, fontSize: 16, lineHeight: 22, fontWeight: '600' }]}
      >
        {label}
      </Text>
      {!keepFieldFocus ? (
        <Svg
          width={18}
          height={18}
          viewBox="0 0 24 24"
          fill="none"
          aria-hidden
          style={{ flexShrink: 0 }}
        >
          <Path
            d="M9 6 L15 12 L9 18"
            stroke="#6f756f"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </Svg>
      ) : null}
    </Pressable>
  );
}
function MessageIcon({ rate }: { rate: boolean }) {
  const color = rate ? '#8f5a12' : '#a3421a';
  return (
    <Svg
      width={17}
      height={17}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden
      style={{ flexShrink: 0, marginTop: 2 }}
    >
      <Circle cx={12} cy={12} r={9} stroke={color} strokeWidth={2} />
      <Path
        d={rate ? 'M12 7 V12.5 L15.5 14.5' : 'M12 7.5 V13 M12 16 V16.1'}
        stroke={color}
        strokeWidth={2}
        strokeLinecap="round"
      />
    </Svg>
  );
}
const styles = StyleSheet.create({
  form: { marginTop: 28 },
  hiddenStatus: {
    position: 'absolute',
    width: 1,
    height: 1,
    margin: -1,
    overflow: 'hidden',
    ...(Platform.OS === 'web'
      ? ({ clip: 'rect(0, 0, 0, 0)', whiteSpace: 'nowrap' } as object)
      : {}),
  },
  controls: { flexDirection: 'row', gap: 12, marginTop: 8, alignItems: 'flex-start' },
  privacy: {
    marginTop: 36,
    paddingTop: 20,
    borderTopWidth: 1,
    borderTopColor: 'rgba(17,21,15,0.08)',
    gap: 6,
  },
  help: { ...candidateText.body, fontSize: 14, lineHeight: 21 },
  fieldWrap: { flex: 1, minWidth: 0, zIndex: 2 },
  inputBorder: { borderWidth: 1, borderRadius: 14, backgroundColor: '#fff', minHeight: 60 },
  nativeInput: {
    minHeight: 60,
    padding: 18,
    backgroundColor: '#fff',
    borderWidth: 0,
    borderColor: 'rgba(17,21,15,0.18)',
    borderRadius: 14,
    fontFamily: t.typography.body,
    fontSize: 17,
  },
  message: { minHeight: 22, marginTop: 12, flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  suggestions: {
    zIndex: 30,
    marginTop: 8,
    padding: 6,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: 'rgba(17,21,15,0.14)',
    borderRadius: 14,
    gap: 2,
  },
  suggestionOverlay: {
    position: 'absolute',
    top: '100%',
    left: 0,
    right: 0,
    boxShadow: '0 16px 40px rgba(17,21,15,0.16)',
  },
  suggestionHeading: {
    ...candidateText.strong,
    color: '#4f5651',
    fontSize: 13.5,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  choice: {
    paddingHorizontal: 14,
    paddingVertical: 12,
    minHeight: 56,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: 'rgba(17,21,15,0.14)',
    borderRadius: 12,
  },
});
