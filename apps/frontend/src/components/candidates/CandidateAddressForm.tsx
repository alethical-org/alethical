import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import { Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
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
  'no-match': 'We couldn’t match that address. Check the street address, city, and ZIP code',
  'outside-minnesota': 'This search covers Minnesota addresses',
  'rate-limited': 'Too many searches. Try again shortly',
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
    const field = inputRef.current;
    if (!field) return;
    const resize = () => {
      field.style.height = 'auto';
      field.style.height = `${Math.max(60, field.scrollHeight)}px`;
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
  }, [address]);
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
  const pick = (choice: CandidateAddressChoice) => {
    setSuggestions([]);
    setSuggestOpen(false);
    setChoicesOpen(false);
    onSubmit(address, choice);
  };
  const submit = () => {
    if (busy) return;
    if (!address.trim()) {
      setMissing(true);
      focusField();
      return;
    }
    setMissing(false);
    setSuggestOpen(false);
    setChoicesOpen(false);
    onSubmit(address);
  };
  const fieldKey = (event: ReactKeyboardEvent<HTMLElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      setSuggestOpen(false);
      setChoicesOpen(false);
      onCancel?.();
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
    if (event.key === 'Enter') {
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
    ? 'Finding candidates…'
    : missing
      ? 'Enter your full Minnesota street address'
      : errorKind
        ? errors[errorKind]
        : '';
  const invalid =
    !busy && (missing || errorKind === 'no-match' || errorKind === 'outside-minnesota');
  const inputStyle = {
    width: '100%',
    minHeight: 60,
    padding: '12px 18px',
    border: 'none',
    borderRadius: 14,
    background: '#fff',
    color: '#11150f',
    fontFamily: t.typography.body,
    fontSize: 17,
    outline: 'none',
    boxSizing: 'border-box' as const,
    fontVariantNumeric: 'tabular-nums' as const,
    scrollMarginTop: 90,
    resize: 'none' as const,
    overflow: 'hidden',
    lineHeight: '26px',
  };
  return (
    <View style={[styles.form, compact && { marginTop: 0 }]}>
      <Text nativeID={`${id}-label`} style={candidateText.strong}>
        Full street address
      </Text>
      <View style={[styles.controls, (isMobile || compact) && { flexDirection: 'column' }]}>
        <View style={styles.fieldWrap}>
          <View
            style={[
              styles.inputBorder,
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
                value={address}
                placeholder="Street address, city, MN ZIP"
                style={inputStyle}
                onChange={(event) => {
                  setMissing(false);
                  setChoicesOpen(false);
                  onAddress(event.target.value);
                }}
                onFocus={() => setFocused(true)}
                onBlur={() => {
                  setFocused(false);
                  setSuggestOpen(false);
                }}
                onKeyDown={fieldKey}
                onMouseEnter={() => setFieldHover(true)}
                onMouseLeave={() => setFieldHover(false)}
              />
            ) : (
              <TextInput
                ref={nativeRef}
                accessibilityLabel="Full street address"
                value={address}
                onChangeText={onAddress}
                onSubmitEditing={submit}
                autoComplete="street-address"
                placeholder="Street address, city, MN ZIP"
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
          label="Find My Candidates"
          busy={busy}
          onPress={submit}
          style={{
            minHeight: compact ? 52 : 60,
            width: isMobile || compact ? '100%' : isDesktop ? 248 : 220,
            alignSelf: 'stretch',
            borderRadius: 14,
          }}
        />
      </View>
      <View
        nativeID={`${id}-message`}
        aria-live="polite"
        accessibilityRole={errorKind === 'rate-limited' ? 'alert' : undefined}
        style={styles.message}
      >
        {message ? (
          <Text
            style={[
              candidateText.strong,
              { fontSize: 15, lineHeight: 22, color: invalid ? '#a3421a' : '#11150f' },
            ]}
          >
            {message}
          </Text>
        ) : null}
      </View>
      <Text nativeID={`${id}-help`} style={[candidateText.body, { fontSize: 15, lineHeight: 22 }]}>
        A city or ZIP code alone cannot identify your local races
      </Text>
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
  return (
    <Pressable
      nativeID={id}
      role="option"
      aria-selected={selected}
      tabIndex={-1}
      onPress={onPress}
      onHoverIn={() => setHovered(true)}
      onHoverOut={() => setHovered(false)}
      {...(Platform.OS === 'web' && keepFieldFocus
        ? { onMouseDown: (event: React.MouseEvent) => event.preventDefault() }
        : {})}
      style={[
        styles.choice,
        hovered && { backgroundColor: '#f5f6f7', borderColor: 'rgba(17,21,15,0.3)' },
        selected && { backgroundColor: '#f2fbf6', borderColor: '#2ed47e' },
      ]}
    >
      <Text style={[candidateText.strong, { flexShrink: 1 }]}>{label}</Text>
    </Pressable>
  );
}
const styles = StyleSheet.create({
  form: { marginTop: 28 },
  controls: { flexDirection: 'row', gap: 12, marginTop: 8 },
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
  message: { minHeight: 22, marginTop: 12 },
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
    justifyContent: 'center',
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: 'rgba(17,21,15,0.14)',
    borderRadius: 12,
  },
});
