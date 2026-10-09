import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { Platform, StyleSheet, Text, TextInput, View } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';
import { useResponsive } from '../../hooks/useResponsive';
import { theme } from '../../theme/tokens';
import { CandidateButton, candidateText } from './CandidateControls';

/**
 * A device location only suggests an address. The reader confirms or corrects
 * it here; nothing searches until they choose This is my home address.
 */
export function CandidateLocationConfirm({
  street,
  unit,
  missing,
  busy,
  onStreet,
  onUnit,
  onConfirm,
  onDifferent,
}: {
  street: string;
  unit: string;
  missing: boolean;
  busy: boolean;
  onStreet(value: string): void;
  onUnit(value: string): void;
  /** Receives the visible values, including a browser fill that has not reported. */
  onConfirm(street: string, unit: string): void;
  onDifferent(): void;
}) {
  const { isMobile, isDesktop } = useResponsive();
  const id = useId().replace(/:/g, '');
  const heading = useRef<View>(null);
  const streetRef = useRef<HTMLTextAreaElement>(null);
  const unitRef = useRef<HTMLInputElement>(null);
  const [focused, setFocused] = useState<'street' | 'unit' | null>(null);
  const [hovered, setHovered] = useState<'street' | 'unit' | null>(null);
  useEffect(() => {
    (heading.current as unknown as HTMLElement | null)?.focus?.({ preventScroll: false });
  }, []);
  useEffect(() => {
    if (missing) streetRef.current?.focus();
  }, [missing]);
  useLayoutEffect(() => {
    const element = streetRef.current;
    if (!element) return;
    if (element.value !== street) element.value = street;
    const resize = () => {
      element.style.height = 'auto';
      element.style.height = `${Math.max(60, element.scrollHeight + 2)}px`;
    };
    resize();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(resize);
    observer.observe(element);
    return () => observer.disconnect();
  }, [street]);
  const confirm = () => {
    if (busy) return;
    const visibleStreet = (streetRef.current?.value ?? street).replace(/[\r\n]+/g, ' ');
    const visibleUnit = unitRef.current?.value ?? unit;
    if (visibleStreet !== street) onStreet(visibleStreet);
    if (visibleUnit !== unit) onUnit(visibleUnit);
    onConfirm(visibleStreet, visibleUnit);
  };
  const enter = (event: React.KeyboardEvent<HTMLElement>) => {
    // An input method may use Enter to accept composed text; that is not a submission.
    if (event.key !== 'Enter' || event.nativeEvent.isComposing || event.keyCode === 229) return;
    event.preventDefault();
    confirm();
  };
  const field = (name: 'street' | 'unit', invalid = false) => ({
    display: 'block',
    boxSizing: 'border-box' as const,
    marginTop: 8,
    background: '#fff',
    color: '#11150f',
    border: `1px solid ${
      focused === name
        ? '#5b30d6'
        : invalid
          ? '#a3421a'
          : hovered === name
            ? 'rgba(17,21,15,0.4)'
            : 'rgba(17,21,15,0.22)'
    }`,
    boxShadow: focused === name ? '0 0 0 3px rgba(91,48,214,0.22)' : 'none',
    borderRadius: 14,
    outline: 'none',
    fontFamily: theme.typography.body,
    fontSize: 17,
    fontVariantNumeric: 'tabular-nums',
  });
  return (
    <View
      {...({ role: 'group' } as object)}
      aria-labelledby={`${id}-heading`}
      style={[styles.card, { padding: isMobile ? 18 : isDesktop ? 28 : 24 }]}
    >
      <Text
        ref={heading as never}
        nativeID={`${id}-heading`}
        accessibilityRole="header"
        aria-level={2}
        {...({ tabIndex: -1 } as object)}
        style={styles.heading}
      >
        Is this your home address?
      </Text>
      <Text style={styles.explanation}>
        Your device’s location can be approximate or show where you are now, not where you live
      </Text>
      <Text nativeID={`${id}-street-label`} style={[styles.label, { marginTop: 20 }]}>
        Street address
      </Text>
      {Platform.OS === 'web' ? (
        <textarea
          ref={streetRef}
          rows={1}
          defaultValue={street}
          autoComplete="street-address"
          aria-labelledby={`${id}-street-label`}
          aria-describedby={`${id}-message`}
          aria-invalid={missing || undefined}
          onChange={(event) => {
            const next = event.target.value.replace(/[\r\n]+/g, ' ');
            event.target.value = next;
            onStreet(next);
          }}
          onKeyDown={enter}
          onFocus={() => setFocused('street')}
          onBlur={() => setFocused(null)}
          onMouseEnter={() => setHovered('street')}
          onMouseLeave={() => setHovered(null)}
          style={{
            ...field('street', missing),
            width: '100%',
            minHeight: 60,
            padding: '17px 18px',
            lineHeight: '25px',
            resize: 'none',
            overflow: 'hidden',
            overflowWrap: 'anywhere',
          }}
        />
      ) : (
        <TextInput
          value={street}
          onChangeText={onStreet}
          onSubmitEditing={confirm}
          accessibilityLabel="Street address"
          autoComplete="street-address"
          style={styles.nativeField}
        />
      )}
      <View nativeID={`${id}-message`} aria-live="polite">
        {missing ? (
          <View style={styles.error}>
            <Svg
              width={17}
              height={17}
              viewBox="0 0 24 24"
              fill="none"
              aria-hidden
              style={{ flexShrink: 0, marginTop: 2 }}
            >
              <Circle cx={12} cy={12} r={9} stroke="#a3421a" strokeWidth={2} />
              <Path
                d="M12 7.5 V13 M12 16 V16.1"
                stroke="#a3421a"
                strokeWidth={2}
                strokeLinecap="round"
              />
            </Svg>
            <Text style={styles.errorText}>Enter your full Minnesota street address</Text>
          </View>
        ) : null}
      </View>
      <View style={[styles.unitLabel, { marginTop: 18 }]}>
        <Text nativeID={`${id}-unit-label`} style={styles.label}>
          Apartment or unit
        </Text>
        <Text nativeID={`${id}-optional`} style={styles.optional}>
          Optional
        </Text>
      </View>
      {Platform.OS === 'web' ? (
        <input
          ref={unitRef}
          defaultValue={unit}
          placeholder="Apt 3"
          autoComplete="address-line2"
          aria-labelledby={`${id}-unit-label ${id}-optional`}
          onChange={(event) => onUnit(event.target.value)}
          onKeyDown={enter}
          onFocus={() => setFocused('unit')}
          onBlur={() => setFocused(null)}
          onMouseEnter={() => setHovered('unit')}
          onMouseLeave={() => setHovered(null)}
          style={{
            ...field('unit'),
            width: isMobile ? '100%' : 240,
            maxWidth: '100%',
            minHeight: 56,
            padding: '0 18px',
          }}
        />
      ) : (
        <TextInput
          value={unit}
          onChangeText={onUnit}
          onSubmitEditing={confirm}
          placeholder="Apt 3"
          accessibilityLabel="Apartment or unit, optional"
          style={styles.nativeField}
        />
      )}
      <View
        style={[
          styles.actions,
          isMobile ? { flexDirection: 'column', alignItems: 'stretch' } : { flexWrap: 'wrap' },
        ]}
      >
        <CandidateButton
          label="This is my home address"
          busyLabel="Finding…"
          icon="none"
          busy={busy}
          fontSize={17}
          onPress={confirm}
          style={{
            width: isMobile ? '100%' : 272,
            minHeight: 60,
            paddingHorizontal: 22,
            paddingVertical: 6,
            borderRadius: 14,
          }}
        />
        <CandidateButton
          label="Enter a different address"
          kind="outline"
          icon="none"
          onPress={onDifferent}
          style={{
            minHeight: 60,
            paddingHorizontal: 22,
            paddingVertical: 6,
            borderRadius: 14,
            borderColor: 'rgba(17,21,15,0.16)',
            ...(isMobile ? { width: '100%' } : {}),
          }}
        />
      </View>
      <View aria-live="polite" style={styles.hiddenStatus}>
        {busy ? <Text>Finding…</Text> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    marginTop: 28,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: 'rgba(17,21,15,0.14)',
    borderRadius: 16,
  },
  heading: {
    ...candidateText.strong,
    fontSize: 21,
    lineHeight: 26,
    fontWeight: '800',
    letterSpacing: -0.2,
    ...(Platform.OS === 'web' ? ({ outlineStyle: 'none' } as object) : {}),
  },
  explanation: { ...candidateText.body, marginTop: 6, fontSize: 14.5, lineHeight: 21 },
  label: { ...candidateText.strong, fontSize: 16, lineHeight: 22 },
  unitLabel: { flexDirection: 'row', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' },
  optional: { ...candidateText.body, fontSize: 14.5, fontWeight: '500', color: '#4f5651' },
  error: { marginTop: 10, flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  errorText: {
    ...candidateText.strong,
    fontSize: 15,
    lineHeight: 22,
    color: '#a3421a',
    flexShrink: 1,
  },
  actions: { marginTop: 24, flexDirection: 'row', gap: 12 },
  nativeField: {
    marginTop: 8,
    minHeight: 56,
    borderWidth: 1,
    borderColor: 'rgba(17,21,15,0.22)',
    borderRadius: 14,
    paddingHorizontal: 18,
    fontSize: 17,
  },
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
});
