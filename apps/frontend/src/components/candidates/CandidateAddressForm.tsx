import { CANDIDATE_LOOKUP_COPY } from '../../lib/candidatePublicCopy';
import {
  useEffect,
  useId,
  useCallback,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';
import { AddressSuggestionField, type AddressFieldHandle } from '../address/AddressSuggestionField';
import { useResponsive } from '../../hooks/useResponsive';
import { theme as t } from '../../theme/tokens';
import { CandidateButton, CandidateLink, candidateText } from './CandidateControls';
import type {
  CandidateAddressChoice,
  CandidateLookupResponse,
  CandidateSearchServices,
} from './types';

const errors = {
  'historical-match-unavailable': 'We couldn’t confirm the races for this address and election',
  'no-match': 'We couldn’t match that address to election records',
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
  const inputRef = useRef<AddressFieldHandle>(null);
  const buttonRef = useRef<View>(null);
  const choicesRef = useRef<View>(null);
  const [choiceActive, setChoiceActive] = useState(0);
  const [choicesOpen, setChoicesOpen] = useState(false);
  const [missing, setMissing] = useState(false);
  const focusField = () => inputRef.current?.focus();
  useEffect(() => {
    if (focus) inputRef.current?.selectAll();
  }, [focus]);
  const suggest = useCallback(
    async (value: string, signal: AbortSignal) =>
      (await services.suggest(value, signal)).map((choice) => ({
        id: choice.id,
        address: choice.address,
        value: choice,
      })),
    [services],
  );
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
  const submit = (choice?: CandidateAddressChoice, suggestionAddress?: string) => {
    if (busy) return;
    const value = suggestionAddress ?? inputRef.current?.value() ?? address;
    inputRef.current?.dismiss();
    if (value !== address) onAddress(value);
    if (!value.trim()) {
      focusField();
      setMissing(true);
      return;
    }
    setMissing(false);
    setChoicesOpen(false);
    if (Platform.OS === 'web') (buttonRef.current as unknown as HTMLElement | null)?.focus();
    if (choice && (suggestionAddress !== undefined || value === address)) {
      onSubmit(
        value,
        suggestionAddress === undefined ? choice : { ...choice, address: value, label: value },
      );
    } else onSubmit(value);
  };
  const pick = (choice: CandidateAddressChoice) => submit(choice);
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
  return (
    <View
      style={[styles.form, compact && { marginTop: 0 }]}
      {...(Platform.OS === 'web' && onCancel
        ? {
            onKeyDown: (event: ReactKeyboardEvent<HTMLElement>) => {
              // The field and open choice list handle their own Escape first.
              if (event.key !== 'Escape' || event.defaultPrevented) return;
              event.preventDefault();
              onCancel();
            },
          }
        : {})}
    >
      <Text nativeID={`${id}-label`} style={candidateText.strong}>
        {CANDIDATE_LOOKUP_COPY.addressLabel}
      </Text>
      <Text nativeID={`${id}-help`} style={styles.help}>
        A city or ZIP code alone cannot identify your local races
      </Text>
      <View style={[styles.controls, (isMobile || compact) && { flexDirection: 'column' }]}>
        <View
          style={[styles.fieldWrap, (isMobile || compact) && { flex: undefined, width: '100%' }]}
        >
          <AddressSuggestionField
            fieldRef={inputRef}
            address={address}
            onAddress={(value) => {
              setMissing(false);
              setChoicesOpen(false);
              onAddress(value);
            }}
            suggestionsEnabled={!choicesOpen}
            suggest={suggest}
            onSubmit={(value, choice) => submit(choice, value)}
            labelId={`${id}-label`}
            describedBy={`${id}-message ${id}-help`}
            invalid={invalid}
            busy={busy}
            mobile={isMobile}
            compact={compact}
            onEscape={() => {
              if (choicesOpen) setChoicesOpen(false);
              else onCancel?.();
            }}
          />
        </View>
        <View
          style={{
            flexDirection: 'row',
            gap: 12,
            width: isMobile || compact ? '100%' : undefined,
            alignSelf: 'center',
            alignItems: 'stretch',
          }}
        >
          <CandidateButton
            label="Find"
            busyLabel="Finding candidates…"
            reserveBusyLabel={compact}
            buttonRef={buttonRef}
            busy={busy}
            // Keep suggestions from collapsing and moving this target between
            // pointer press and release. Keyboard focus remains unchanged.
            keepFieldFocus
            onPress={() => submit()}
            style={{
              minHeight: compact ? 52 : 60,
              width: isMobile || compact ? undefined : isDesktop ? 248 : 220,
              flex: isMobile || compact ? 1 : undefined,
              paddingHorizontal: compact ? 16 : 22,
              alignSelf: 'stretch',
              height: compact ? undefined : 60,
              paddingVertical: compact ? 8 : 0,
              borderRadius: 14,
            }}
          />
          {onCancel ? (
            <CandidateButton
              label="Cancel"
              kind="outline"
              pressedStyle={{ backgroundColor: '#eceeed' }}
              icon="none"
              onPress={onCancel}
              style={{
                minHeight: 52,
                paddingHorizontal: 16,
                borderRadius: 12,
                alignSelf: 'stretch',
              }}
            />
          ) : null}
        </View>
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
      {outcome?.kind === 'historical-match-unavailable' && !busy ? (
        <CandidateLink label="Official election results" url={outcome.officialResultsUrl} />
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
        <View style={[styles.privacy, !isMobile && styles.privacyWide]}>
          <Text style={styles.help}>{privacyDisclosure ?? CANDIDATE_LOOKUP_COPY.privacy}</Text>
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
}: {
  id: string;
  label: string;
  selected: boolean;
  onPress(): void;
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
      style={[
        styles.choice,
        selected && {
          backgroundColor: '#f2fbf6',
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
  controls: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 8,
    alignItems: 'flex-start',
    // RNW Views start at z-index 0. Lift this row above its helper siblings so
    // the desktop dropdown receives clicks where it extends beyond the row.
    zIndex: 1,
  },
  // Keep the source note clear of a short overlaid list without moving it as rows change.
  privacyWide: { marginTop: 144 },
  privacy: {
    marginTop: 36,
    paddingTop: 20,
    borderTopWidth: 1,
    borderTopColor: 'rgba(17,21,15,0.08)',
    gap: 6,
  },
  help: { ...candidateText.body, fontSize: 14, lineHeight: 21 },
  fieldWrap: { flex: 1, minWidth: 0, zIndex: 2 },
  message: { minHeight: 22, marginTop: 12, flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
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
