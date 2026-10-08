import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import {
  Linking,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';
import { externalLinkProps, linkProps } from '../../navigation/links';
import { theme as t } from '../../theme/tokens';
import { LinkArrow } from '../LinkArrow';
import type { CandidateSource } from './types';

import {
  candidateRecordsSourceLabel,
  CANDIDATE_PROFILE_COPY,
  safeCandidateUrl,
} from '../../lib/candidatePublicCopy';
import { ballotCheckedLabel } from '../../lib/personRecords';
export { candidateDate, safeCandidateUrl, sampleBallotUrl } from '../../lib/candidatePublicCopy';

export const candidateColors = {
  ink: '#11150f',
  muted: '#4f5651',
  link: '#0f7a45',
  focus: '#7c5cff',
};
function canHover() {
  return (
    Platform.OS === 'web' &&
    typeof window !== 'undefined' &&
    Boolean(window.matchMedia?.('(hover: hover) and (pointer: fine)').matches)
  );
}
export function CandidateButton({
  label,
  onPress,
  busy = false,
  disabled = false,
  icon = 'search',
  kind = 'green',
  style,
  href,
  keepFieldFocus = false,
  busyLabel,
  buttonRef,
  describedBy,
  accessibilityLabel,
}: {
  label: string;
  onPress(): void;
  busy?: boolean;
  disabled?: boolean;
  icon?: 'search' | 'none';
  kind?: 'green' | 'outline' | 'text';
  style?: StyleProp<ViewStyle>;
  href?: string;
  keepFieldFocus?: boolean;
  busyLabel?: string;
  buttonRef?: RefObject<View | null>;
  describedBy?: string;
  accessibilityLabel?: string;
}) {
  const [hovered, setHovered] = useState(false);
  const localRef = useRef<View>(null);
  const control = buttonRef ?? localRef;
  useEffect(() => {
    if (Platform.OS !== 'web' || document.getElementById('alethical-candidate-controls')) return;
    const sheet = document.createElement('style');
    sheet.id = 'alethical-candidate-controls';
    sheet.textContent =
      '@keyframes alethical-candidate-spin{to{transform:rotate(360deg)}}[data-candidate-spinner="true"]{animation:alethical-candidate-spin .8s linear infinite}@media(prefers-reduced-motion:reduce){[data-candidate-spinner="true"]{animation:none}}';
    document.head.append(sheet);
  }, []);
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const element = control.current as unknown as HTMLElement | null;
    if (busy || disabled) element?.setAttribute('aria-disabled', 'true');
    else element?.removeAttribute('aria-disabled');
  }, [busy, disabled, control]);
  return (
    <Pressable
      ref={control}
      accessibilityRole={href ? 'link' : 'button'}
      aria-describedby={describedBy}
      accessibilityLabel={accessibilityLabel}
      aria-busy={busy || undefined}
      disabled={disabled || (busy && !busyLabel)}
      accessibilityState={{ busy, disabled: busy || disabled }}
      {...(Platform.OS === 'web' && keepFieldFocus
        ? { onMouseDown: (event: React.MouseEvent) => event.preventDefault() }
        : {})}
      {...(href && !busy && !disabled
        ? linkProps(href, onPress)
        : {
            onPress: () => {
              if (!busy && !disabled) onPress();
            },
          })}
      onHoverIn={() => {
        if (canHover()) setHovered(true);
      }}
      onHoverOut={() => setHovered(false)}
      style={({ pressed }) => [
        styles.button,
        kind === 'green' ? styles.green : kind === 'text' ? styles.textButton : styles.outline,
        hovered &&
          !busy &&
          !disabled &&
          (kind === 'green'
            ? styles.greenHover
            : kind === 'text'
              ? styles.textHover
              : styles.outlineHover),
        pressed &&
          !busy &&
          !disabled &&
          (kind === 'green'
            ? styles.greenPressed
            : kind === 'outline'
              ? styles.outlinePressed
              : null),
        disabled && { opacity: 0.5 },
        busy && busyLabel && Platform.OS === 'web' && ({ cursor: 'progress' } as object),
        style,
      ]}
    >
      {kind === 'green' && (icon === 'search' || busy) ? (
        <View
          aria-hidden
          {...({ dataSet: { candidateSpinner: busy ? 'true' : 'false' } } as object)}
          style={{ width: 17, height: 17 }}
        >
          <Svg width={17} height={17} viewBox="0 0 24 24" fill="none" aria-hidden>
            <Circle
              cx={busy ? 12 : 11}
              cy={busy ? 12 : 11}
              r={busy ? 9 : 7}
              stroke={busy ? (busyLabel ? 'rgba(6,35,26,0.25)' : '#6a8478') : '#06231a'}
              strokeWidth={busy && busyLabel ? 2.4 : 2}
            />
            <Path
              d={busy ? 'M21 12a9 9 0 0 0-9-9' : 'M16.5 16.5L21 21'}
              stroke="#06231a"
              strokeWidth={busy && busyLabel ? 2.4 : 2}
              strokeLinecap="round"
            />
          </Svg>
        </View>
      ) : null}
      <Text
        style={[
          styles.buttonText,
          kind === 'green' && { color: '#06231a' },
          kind === 'text' && { textDecorationLine: 'underline' },
          kind === 'text' &&
            Platform.OS === 'web' &&
            ({
              textDecorationThickness: hovered ? '3px' : '1px',
              textUnderlineOffset: '3px',
            } as object),
        ]}
      >
        {busy && busyLabel ? busyLabel : label}
      </Text>
    </Pressable>
  );
}
export function CandidateLink({
  label,
  url,
  onPress,
  internal = false,
  accessibilityLabel,
  describedBy,
  style,
}: {
  label: string;
  url: string;
  onPress?(): void;
  internal?: boolean;
  accessibilityLabel?: string;
  describedBy?: string;
  style?: StyleProp<ViewStyle>;
}) {
  const [hovered, setHovered] = useState(false);
  if (!internal && !safeCandidateUrl(url)) return null;
  return (
    <Pressable
      {...(internal
        ? onPress
          ? linkProps(url, onPress)
          : { accessibilityRole: 'link' as const, href: url }
        : externalLinkProps(url, () => void Linking.openURL(url)))}
      accessibilityLabel={
        accessibilityLabel ?? `${label}${internal ? '' : ' (opens in a new tab)'}`
      }
      aria-describedby={describedBy}
      onHoverIn={() => {
        if (canHover()) setHovered(true);
      }}
      onHoverOut={() => setHovered(false)}
      style={[styles.link, style]}
    >
      <Text style={[styles.linkText, hovered && { color: '#11832b' }]}>
        {Platform.OS === 'web' ? (
          label.startsWith('Back to ') ? (
            <span>
              <span style={{ whiteSpace: 'nowrap' }}>
                <Svg
                  width={18}
                  height={18}
                  viewBox="0 0 24 24"
                  fill="none"
                  aria-hidden
                  style={{ marginRight: 9, verticalAlign: '-3px' } as object}
                >
                  <Path
                    d="M14.5 5.5L8 12l6.5 6.5"
                    stroke="#0f7a45"
                    strokeWidth={2}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </Svg>
                <span style={{ textDecoration: hovered ? 'underline' : 'none' }}>Back</span>
              </span>
              <span style={{ textDecoration: hovered ? 'underline' : 'none' }}>
                {label.slice(4)}
              </span>
            </span>
          ) : (
            <span>
              <span style={{ textDecoration: hovered ? 'underline' : 'none' }}>
                {label.slice(0, label.lastIndexOf(' ') + 1)}
              </span>
              <span style={{ whiteSpace: 'nowrap' }}>
                <span style={{ textDecoration: hovered ? 'underline' : 'none' }}>
                  {label.slice(label.lastIndexOf(' ') + 1)}
                </span>
                <LinkArrow color="#0f7a45" placement="candidate-inline" />
              </span>
            </span>
          )
        ) : (
          label
        )}
      </Text>
    </Pressable>
  );
}
export function CandidateSourceLine({
  source,
  group = false,
  style,
}: {
  source: CandidateSource;
  group?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View
      style={[
        styles.source,
        group && {
          borderTopWidth: 0,
          backgroundColor: 'transparent',
          paddingHorizontal: 14,
          paddingTop: 8,
          paddingBottom: 14,
          flexDirection: 'row',
          flexWrap: 'wrap',
          alignItems: 'center',
          columnGap: 18,
        },
        style,
      ]}
    >
      <CandidateLink url={source.url} label={candidateRecordsSourceLabel(source.authority)} />
      <Text style={styles.small}>{ballotCheckedLabel(source)}</Text>
      {source.stale && !source.retained ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Svg width={16} height={16} viewBox="0 0 24 24" fill="none" aria-hidden>
            <Circle cx={12} cy={12} r={9} stroke="#8f5a12" strokeWidth={1.8} />
            <Path d="M12 6v6l4 2" stroke="#8f5a12" strokeWidth={1.8} strokeLinecap="round" />
          </Svg>
          <Text style={[styles.small, { color: '#8f5a12', fontWeight: '700' }]}>
            {CANDIDATE_PROFILE_COPY.stale}
          </Text>
        </View>
      ) : null}
    </View>
  );
}
export function CandidateNotice({
  children,
  error = false,
}: {
  children: ReactNode;
  error?: boolean;
}) {
  return (
    <View
      accessibilityRole={error ? 'alert' : undefined}
      aria-live={error ? 'assertive' : 'polite'}
      style={[styles.notice, error && styles.errorNotice]}
    >
      {children}
    </View>
  );
}
export const candidateText = StyleSheet.create({
  body: {
    fontFamily: t.typography.body,
    fontSize: 16,
    lineHeight: 24,
    color: candidateColors.muted,
  },
  strong: {
    fontFamily: t.typography.body,
    fontSize: 16,
    lineHeight: 24,
    color: candidateColors.ink,
    fontWeight: '700',
  },
  title: {
    fontFamily: t.typography.title,
    fontWeight: '800',
    color: candidateColors.ink,
    letterSpacing: -0.8,
  },
  party: {
    fontFamily: t.typography.body,
    fontSize: 13,
    lineHeight: 20,
    color: candidateColors.muted,
    backgroundColor: '#f1f1f4',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
    alignSelf: 'flex-start',
  },
});
const styles = StyleSheet.create({
  button: {
    minHeight: 48,
    paddingHorizontal: 22,
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 9,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'flex-start',
  },
  green: { backgroundColor: '#2ed47e', borderColor: '#2ed47e' },
  greenHover: { backgroundColor: '#28bf71', borderColor: '#28bf71' },
  greenPressed: { backgroundColor: '#23ad66', borderColor: '#23ad66' },
  outline: { backgroundColor: '#fff', borderColor: 'rgba(17,21,15,0.2)' },
  outlineHover: { backgroundColor: '#f7f8fa', borderColor: 'rgba(17,21,15,0.3)' },
  outlinePressed: { backgroundColor: '#eceff1' },
  textButton: {
    borderColor: 'transparent',
    paddingHorizontal: 0,
    backgroundColor: 'transparent',
    minHeight: 44,
  },
  textHover: { ...(Platform.OS === 'web' ? ({ textDecorationThickness: '3px' } as object) : {}) },
  buttonText: {
    fontFamily: t.typography.body,
    fontSize: 16,
    lineHeight: 24,
    fontWeight: '700',
    color: candidateColors.ink,
    textAlign: 'center',
  },
  link: { minHeight: 44, justifyContent: 'center', alignSelf: 'flex-start', maxWidth: '100%' },
  linkText: {
    fontFamily: t.typography.body,
    fontSize: 15,
    lineHeight: 22,
    fontWeight: '700',
    color: candidateColors.link,
    ...(Platform.OS === 'web' ? ({ overflowWrap: 'anywhere' } as object) : {}),
  },
  source: {
    borderTopWidth: 1,
    borderTopColor: 'rgba(17,21,15,0.08)',
    paddingHorizontal: 18,
    paddingVertical: 10,
    backgroundColor: '#fff',
    flexDirection: 'column',
    alignItems: 'flex-start',
    gap: 0,
    borderBottomLeftRadius: 14,
    borderBottomRightRadius: 14,
  },
  small: {
    fontFamily: t.typography.body,
    fontSize: 14.5,
    lineHeight: 21,
    fontVariant: ['tabular-nums'],
    color: candidateColors.muted,
  },
  notice: {
    padding: 16,
    borderWidth: 1,
    borderColor: 'rgba(17,21,15,0.16)',
    borderRadius: 12,
    backgroundColor: '#fff',
    gap: 2,
  },
  errorNotice: { backgroundColor: '#fdf6e7', borderColor: '#efd9a8' },
});
