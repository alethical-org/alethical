import { useEffect, useId, useRef, type ReactNode, type Ref } from 'react';
import {
  Platform,
  StyleSheet,
  Text,
  TextInput,
  View,
  type StyleProp,
  type TextStyle,
} from 'react-native';
import Svg, { Circle, Path, Rect } from 'react-native-svg';
import { useResponsive } from '../../hooks/useResponsive';
import { fieldFocusRing, fieldOutlineReset, useFieldFocus } from '../../theme/fieldFocus';
import { CandidateButton, candidateDate, candidateText } from './CandidateControls';
import type { CandidateProfileRecord } from './types';

export function CandidateAccountIdentity({
  record,
  verified = false,
}: {
  record: CandidateProfileRecord;
  verified?: boolean;
}) {
  return (
    <View style={[candidateAccountStyles.identity, { padding: 0, gap: 0 }]}>
      <View style={{ paddingVertical: 16, paddingHorizontal: 18, gap: 3 }}>
        <Text style={[candidateText.strong, { fontSize: 19 }]}>{record.candidate.name}</Text>
        <Text style={[candidateText.strong, { fontSize: 15.5, fontWeight: '600' }]}>
          {record.office}
        </Text>
        {record.votingArea ? (
          <Text style={[candidateText.body, { fontSize: 15 }]}>{record.votingArea}</Text>
        ) : null}
        <Text style={[candidateText.body, { fontSize: 15 }]}>
          {record.election.label} · {candidateDate(record.election.date)}
        </Text>
      </View>
      {verified ? (
        <View
          style={{
            paddingVertical: 14,
            paddingHorizontal: 18,
            borderTopWidth: 1,
            borderColor: 'rgba(17,21,15,.08)',
            flexDirection: 'row',
            alignItems: 'center',
            gap: 10,
          }}
        >
          <CandidateStatusIcon kind="approved" size={19} />
          <Text style={[candidateText.strong, { fontSize: 15.5 }]}>Campaign access verified</Text>
        </View>
      ) : null}
    </View>
  );
}
export function CandidateStatusIcon({
  kind,
  size = 22,
}: {
  kind: 'approved' | 'pending' | 'warning' | 'withdrawn' | 'admin' | 'success';
  size?: number;
}) {
  const stroke =
    kind === 'approved' || kind === 'success'
      ? '#0f7a45'
      : kind === 'warning'
        ? '#8f5a12'
        : '#4f5651';
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
      {kind === 'success' ? (
        <>
          <Circle cx={12} cy={12} r={9} stroke={stroke} strokeWidth={2} />
          <Path
            d="M8 12.5 L11 15.5 L16.5 9.5"
            stroke={stroke}
            strokeWidth={2.2}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </>
      ) : kind === 'approved' ? (
        <>
          <Path
            d="M12 3 L19 6 V11.5 C19 15.8 16 19.2 12 21 C8 19.2 5 15.8 5 11.5 V6 Z"
            stroke={stroke}
            strokeWidth={2}
          />
          <Path
            d="M9 12 L11.2 14.2 L15.2 10"
            stroke={stroke}
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </>
      ) : kind === 'warning' ? (
        <>
          <Path
            d="M12 3.5 L21.5 20 H2.5 Z"
            stroke={stroke}
            strokeWidth={2}
            strokeLinejoin="round"
          />
          <Path
            d="M12 10 V14 M12 17 V17.1"
            stroke={stroke}
            strokeWidth={2.2}
            strokeLinecap="round"
          />
        </>
      ) : kind === 'admin' ? (
        <>
          <Rect x={5} y={10.5} width={14} height={10} rx={2.2} stroke={stroke} strokeWidth={2} />
          <Path d="M8 10.5 V8 a4 4 0 0 1 8 0 V10.5" stroke={stroke} strokeWidth={2} />
        </>
      ) : (
        <>
          <Circle cx={12} cy={12} r={9} stroke={stroke} strokeWidth={2} />
          <Path
            d={kind === 'pending' ? 'M12 7 V12.5 L15.5 14.5' : 'M8 12 H16'}
            stroke={stroke}
            strokeWidth={2}
            strokeLinecap="round"
          />
        </>
      )}
    </Svg>
  );
}
export function CandidateRecordBoundary({
  children,
  compact = false,
}: {
  children: ReactNode;
  compact?: boolean;
}) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 8 }}>
      <Svg
        width={17}
        height={17}
        viewBox="0 0 24 24"
        fill="none"
        aria-hidden
        style={{ flexShrink: 0, marginTop: 2 }}
      >
        <Rect x={3.5} y={4} width={7.5} height={16} rx={1.5} stroke="#4f5651" strokeWidth={2} />
        <Rect x={13} y={4} width={7.5} height={16} rx={1.5} stroke="#4f5651" strokeWidth={2} />
      </Svg>
      <Text
        style={[
          candidateText.strong,
          {
            flex: 1,
            fontSize: compact ? 14.5 : 15,
            lineHeight: compact ? 21 : 22.5,
            fontWeight: '600',
          },
        ]}
      >
        {children}
      </Text>
    </View>
  );
}
export function CandidateStatusHeading({
  title,
  body,
  kind,
  headingRef,
}: {
  title: string;
  body?: string;
  kind: Parameters<typeof CandidateStatusIcon>[0]['kind'];
  headingRef?: Ref<View>;
}) {
  const { isMobile, isDesktop } = useResponsive();
  const size = isMobile ? 26 : isDesktop ? 32 : 30;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 14 }}>
      <View
        style={{
          width: 44,
          height: 44,
          flexShrink: 0,
          borderRadius: 12,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor:
            kind === 'approved' ? '#e4f8ee' : kind === 'warning' ? '#fdf6e7' : '#f1f2f4',
        }}
      >
        <CandidateStatusIcon kind={kind} />
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <View ref={headingRef} tabIndex={-1}>
          <Text
            accessibilityRole="header"
            aria-level={1}
            style={[candidateText.title, { marginTop: 2, fontSize: size, lineHeight: size * 1.12 }]}
          >
            {title}
          </Text>
        </View>
        {body ? (
          <Text
            style={[
              candidateText.body,
              { marginTop: 10, fontSize: 16.5, lineHeight: 25.6, color: '#2c322c' },
            ]}
          >
            {body}
          </Text>
        ) : null}
      </View>
    </View>
  );
}
export function CandidateField({
  label,
  value,
  onChange,
  multiline = false,
  readOnly = false,
  maxLength,
  error,
  inputRef,
  hint,
  beforeInput,
  labelLevel,
  inputStyle,
  labelAside,
}: {
  label: string;
  value: string;
  onChange(value: string): void;
  multiline?: boolean;
  readOnly?: boolean;
  maxLength?: number;
  error?: string;
  inputRef?: Ref<TextInput>;
  hint?: string;
  beforeInput?: ReactNode;
  labelLevel?: 2;
  inputStyle?: StyleProp<TextStyle>;
  labelAside?: ReactNode;
}) {
  const { focused, focusProps } = useFieldFocus();
  const id = useId();
  const { isMobile, isDesktop } = useResponsive();
  return (
    <View style={{ gap: 8 }}>
      <View
        style={{
          flexDirection: 'row',
          flexWrap: 'wrap',
          alignItems: 'baseline',
          justifyContent: 'space-between',
          gap: 4,
        }}
      >
        <Text
          nativeID={`${id}-label`}
          accessibilityRole={labelLevel ? 'header' : undefined}
          aria-level={labelLevel}
          style={[
            candidateText.strong,
            labelLevel && { fontSize: isMobile ? 19 : isDesktop ? 21 : 20, fontWeight: '800' },
          ]}
        >
          {label}
        </Text>
        {labelAside}
      </View>
      {beforeInput ? <View nativeID={`${id}-help`}>{beforeInput}</View> : null}
      <TextInput
        ref={inputRef}
        accessibilityLabel={label}
        aria-labelledby={`${id}-label`}
        aria-invalid={Boolean(error)}
        aria-describedby={
          [beforeInput && `${id}-help`, hint && `${id}-hint`, error && `${id}-error`]
            .filter(Boolean)
            .join(' ') || undefined
        }
        value={value}
        onChangeText={onChange}
        multiline={multiline}
        editable={!readOnly}
        maxLength={maxLength}
        autoComplete="off"
        autoCapitalize={multiline ? 'sentences' : 'none'}
        autoCorrect={multiline}
        {...focusProps}
        style={[
          candidateAccountStyles.input,
          error && { borderColor: '#a3421a' },
          multiline && { minHeight: 150, textAlignVertical: 'top' },
          inputStyle,
          fieldOutlineReset,
          ...fieldFocusRing(focused),
        ]}
      />
      {hint ? (
        <Text nativeID={`${id}-hint`} style={candidateText.body}>
          {hint}
        </Text>
      ) : null}
      {error ? (
        <Text
          nativeID={`${id}-error`}
          role="alert"
          style={[candidateText.strong, { color: '#a3421a', fontSize: 15 }]}
        >
          {error}
        </Text>
      ) : null}
    </View>
  );
}
/** Browser dialog supplies focus trapping and makes the safe action the initial focus. */
export function CandidateDialog({
  title,
  children,
  onClose,
  initialFocus = 'safe',
}: {
  title: string;
  children: ReactNode;
  onClose(): void;
  initialFocus?: 'safe' | 'field';
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const { isMobile } = useResponsive();
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const prior = document.activeElement as HTMLElement | null;
    const element = dialog.current;
    element?.showModal?.();
    if (element && !element.showModal) element.setAttribute('open', '');
    element
      ?.querySelector<HTMLElement>(initialFocus === 'field' ? 'textarea, input' : 'button')
      ?.focus();
    return () => {
      element?.close?.();
      prior?.focus();
    };
  }, []);
  if (Platform.OS !== 'web')
    return (
      <View accessibilityRole="alert" style={candidateAccountStyles.identity}>
        {children}
      </View>
    );
  return (
    <dialog
      ref={dialog}
      aria-label={title}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      style={{
        border: 0,
        borderRadius: isMobile ? '20px 20px 0 0' : 18,
        padding: isMobile ? '24px 22px 28px' : '26px 28px',
        maxWidth: isMobile ? '100%' : 480,
        width: isMobile ? '100%' : 'calc(100% - 48px)',
        boxSizing: 'border-box',
        margin: '110px auto auto',
        maxHeight: 'calc(100dvh - 110px)',
        overflowY: 'auto',
        color: '#11150f',
        background: '#fff',
      }}
    >
      <View style={{ gap: 12 }}>
        <Text
          accessibilityRole="header"
          aria-level={2}
          style={[candidateText.title, { fontSize: 21, lineHeight: 27.3 }]}
        >
          {title}
        </Text>
        {children}
      </View>
    </dialog>
  );
}
export function CandidateDialogActions({ children }: { children: ReactNode }) {
  const { isMobile } = useResponsive();
  return (
    <View
      style={{
        marginTop: 10,
        flexDirection: isMobile ? 'column' : 'row-reverse',
        flexWrap: 'wrap',
        alignItems: isMobile ? 'stretch' : 'center',
        justifyContent: 'flex-start',
        gap: 10,
      }}
    >
      {children}
    </View>
  );
}
export function CandidateSafeDialog({
  title,
  safe,
  risky,
  onSafe,
  onRisky,
}: {
  title: string;
  safe: string;
  risky: string;
  onSafe(): void;
  onRisky(): void;
}) {
  return (
    <CandidateDialog title={title} onClose={onSafe}>
      <CandidateButton label={safe} kind="outline" onPress={onSafe} />
      <CandidateButton label={risky} kind="text" onPress={onRisky} />
    </CandidateDialog>
  );
}
export const candidateAccountStyles = StyleSheet.create({
  identity: {
    marginTop: 22,
    padding: 18,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: 'rgba(17,21,15,0.1)',
    borderRadius: 14,
    gap: 4,
  },
  input: {
    ...candidateText.body,
    color: '#11150f',
    minHeight: 56,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(17,21,15,0.2)',
    backgroundColor: '#fff',
  },
  actions: { marginTop: 16, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 10 },
});
