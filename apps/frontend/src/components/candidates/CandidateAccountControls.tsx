import { useEffect, useRef, type ReactNode } from 'react';
import { Platform, StyleSheet, Text, TextInput, View } from 'react-native';
import { useResponsive } from '../../hooks/useResponsive';
import { fieldFocusRing, fieldOutlineReset, useFieldFocus } from '../../theme/fieldFocus';
import { CandidateButton, candidateDate, candidateText } from './CandidateControls';
import type { CandidateProfileRecord } from './types';

export function CandidateAccountIdentity({ record }: { record: CandidateProfileRecord }) {
  return (
    <View style={candidateAccountStyles.identity}>
      <Text style={[candidateText.strong, { fontSize: 19 }]}>{record.candidate.name}</Text>
      <Text style={candidateText.strong}>{record.office}</Text>
      <Text style={candidateText.body}>{record.votingArea}</Text>
      <Text style={candidateText.body}>
        {record.election.label} · {candidateDate(record.election.date)}
      </Text>
    </View>
  );
}
export function CandidateField({
  label,
  value,
  onChange,
  multiline = false,
  readOnly = false,
  maxLength = 2000,
}: {
  label: string;
  value: string;
  onChange(value: string): void;
  multiline?: boolean;
  readOnly?: boolean;
  maxLength?: number;
}) {
  const { focused, focusProps } = useFieldFocus();
  return (
    <View style={{ gap: 8 }}>
      <Text style={candidateText.strong}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
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
          multiline && { minHeight: 220, textAlignVertical: 'top' },
          fieldOutlineReset,
          ...fieldFocusRing(focused),
        ]}
      />
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
        border: '1px solid rgba(17,21,15,0.2)',
        borderRadius: 16,
        padding: 24,
        maxWidth: 460,
        width: 'calc(100% - 40px)',
        ...(isMobile ? { margin: 'auto auto 0' } : {}),
      }}
    >
      <View style={{ gap: 18 }}>
        <Text
          accessibilityRole="header"
          aria-level={2}
          style={[candidateText.title, { fontSize: 22, lineHeight: 29 }]}
        >
          {title}
        </Text>
        {children}
      </View>
    </dialog>
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
    marginTop: 20,
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
