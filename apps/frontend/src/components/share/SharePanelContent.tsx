import { useEffect, useRef, useState, type Ref } from 'react';
import * as Clipboard from 'expo-clipboard';
import {
  Linking,
  Platform,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import Svg, { Path } from 'react-native-svg';

import { shareDialogLabel, type ShareContent } from '../../lib/share';
import {
  buildShareIntents,
  complementaryShareDescription,
  nativeShareText,
  type ShareIntents,
} from '../../lib/shareIntents';
import { theme as t } from '../../theme/tokens';
import { useHover } from '../billDetail/interactions';
import { ShareDestinationIcon } from './ShareDestinationIcon';

export type SharePanelVariant = 'desktop' | 'tablet' | 'phone';
const isWeb = Platform.OS === 'web';
const DESTINATIONS = [
  ['email', 'Email', 'Share by email'],
  ['whatsapp', 'WhatsApp', 'Share on WhatsApp'],
  ['facebook', 'Facebook', 'Share on Facebook'],
  ['linkedin', 'LinkedIn', 'Share on LinkedIn'],
  ['x', 'X', 'Share on X'],
  ['bluesky', 'Bluesky', 'Share on Bluesky'],
] as const;

const BANDS = {
  desktop: {
    padding: 20,
    heading: 17,
    title: 16,
    description: 14.5,
    input: 13.5,
    circle: 44,
    icon: 18,
    name: 12.5,
    copy: 14.5,
    device: 14.5,
    buttonHeight: 44,
  },
  tablet: {
    padding: 26,
    heading: 21,
    title: 17.5,
    description: 15.5,
    input: 15,
    circle: 48,
    icon: 19,
    name: 13,
    copy: 16,
    device: 16,
    buttonHeight: 52,
  },
  phone: {
    padding: 22,
    heading: 22,
    title: 17,
    description: 15,
    input: 14,
    circle: 52,
    icon: 21,
    name: 13,
    copy: 18,
    device: 16.5,
    buttonHeight: 52,
  },
};

/** Shared content and behavior; the wrappers own placement and modal focus. */
export function SharePanelContent({
  content,
  variant,
  onClose,
  closeButtonRef,
}: {
  content: ShareContent;
  variant: SharePanelVariant;
  onClose: () => void;
  closeButtonRef?: Ref<View>;
}) {
  const band = BANDS[variant];
  const phone = variant === 'phone';
  const desktop = variant === 'desktop';
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState('');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const generation = useRef(0);
  const copying = useRef(false);
  const intents = buildShareIntents(content);
  // Some receiving apps print both title and text. Carry the complete identity
  // once in text, and the URL once in its own field.
  const payload = { text: nativeShareText(content, false), url: content.url };
  const description = complementaryShareDescription(
    content.title,
    content.previewDescription ?? content.description,
  );
  let canUseDeviceShare = !isWeb;
  if (isWeb && typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
    try {
      canUseDeviceShare = !navigator.canShare || navigator.canShare(payload);
    } catch {
      canUseDeviceShare = false;
    }
  }

  useEffect(() => {
    generation.current += 1;
    copying.current = false;
    setCopied(false);
    setError('');
    return () => {
      generation.current += 1;
      if (timer.current) clearTimeout(timer.current);
    };
  }, [content.url]);

  const copyLink = async () => {
    if (copying.current) return;
    copying.current = true;
    const attempt = generation.current;
    setCopied(false);
    setError('');
    if (timer.current) clearTimeout(timer.current);
    try {
      const success = await Clipboard.setStringAsync(content.url);
      if (!success) throw new Error('Clipboard unavailable');
      if (attempt !== generation.current) return;
      setCopied(true);
      timer.current = setTimeout(() => setCopied(false), 1900);
    } catch {
      if (attempt === generation.current)
        setError('Couldn’t copy the link. Select and copy it from the link field.');
    } finally {
      if (attempt === generation.current) copying.current = false;
    }
  };

  const openIntent = (destination: keyof ShareIntents) => {
    setError('');
    if (isWeb && typeof window !== 'undefined' && destination !== 'email') {
      window.open(intents[destination], '_blank', 'noopener,noreferrer');
    } else {
      void Linking.openURL(intents[destination]).catch(() =>
        setError('Couldn’t open the sharing app. Copy the link instead.'),
      );
    }
  };

  const openDeviceShare = async () => {
    setError('');
    try {
      if (isWeb) await navigator.share(payload);
      else
        await Share.share(
          Platform.OS === 'ios'
            ? { message: nativeShareText(content, false), url: content.url }
            : { message: nativeShareText(content, true) },
        );
    } catch (reason) {
      if (!(
        reason &&
        typeof reason === 'object' &&
        'name' in reason &&
        reason.name === 'AbortError'
      )) {
        setError('Couldn’t open the sharing menu. Copy the link instead.');
      }
    }
  };

  const copyButton = (
    <Pressable
      accessibilityRole="button"
      onPress={() => void copyLink()}
      style={[
        styles.copyButton,
        { minHeight: band.buttonHeight },
        phone && styles.stackedCopy,
        copied && styles.copiedButton,
      ]}
    >
      {copied ? (
        <Svg width={16} height={16} viewBox="0 0 24 24" fill="none" aria-hidden>
          <Path
            d="M5 12.5 L10 17.5 L19 7"
            stroke={t.colors.text.onGreen}
            strokeWidth={2.4}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </Svg>
      ) : null}
      <Text accessibilityLiveRegion="polite" style={[styles.copyText, { fontSize: band.copy }]}>
        {desktop ? (copied ? 'Copied' : 'Copy') : copied ? 'Link copied' : 'Copy link'}
      </Text>
    </Pressable>
  );
  const rows =
    variant === 'tablet' ? [DESTINATIONS] : [DESTINATIONS.slice(0, 3), DESTINATIONS.slice(3)];

  return (
    <View
      style={[
        styles.body,
        { padding: band.padding },
        !desktop && { paddingBottom: phone ? 30 : 32 },
        !desktop &&
          isWeb &&
          ({ paddingBottom: `max(${phone ? 30 : 32}px, env(safe-area-inset-bottom))` } as object),
      ]}
    >
      <View style={styles.header}>
        <Text
          accessibilityRole="header"
          aria-level={2}
          style={[styles.heading, { fontSize: band.heading }]}
        >
          {shareDialogLabel(content.subject, content.resultsKind)}
        </Text>
        <Pressable
          ref={closeButtonRef}
          accessibilityRole="button"
          accessibilityLabel="Close"
          onPress={onClose}
          style={styles.close}
        >
          <Svg
            width={desktop ? 18 : 20}
            height={desktop ? 18 : 20}
            viewBox="0 0 24 24"
            fill="none"
            aria-hidden
          >
            <Path
              d="M6 6 L18 18 M18 6 L6 18"
              stroke={t.colors.text.muted}
              strokeWidth={2.2}
              strokeLinecap="round"
            />
          </Svg>
        </Pressable>
      </View>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
        <View style={[styles.content, variant === 'tablet' && styles.tabletContent]}>
          <Text
            style={[styles.recordTitle, { fontSize: band.title, lineHeight: band.title * 1.3 }]}
          >
            {content.title}
          </Text>
          {description ? (
            <Text
              style={[
                styles.description,
                { fontSize: band.description, lineHeight: band.description * 1.4 },
              ]}
            >
              {description}
            </Text>
          ) : null}
          <View
            style={[styles.urlRow, !desktop && styles.sheetUrlRow, phone && styles.phoneUrlRow]}
          >
            {!desktop ? (
              <Svg width={17} height={17} viewBox="0 0 24 24" fill="none" aria-hidden>
                <Path
                  d="M9 15 L15 9 M10.5 6.5 L12 5 a3.5 3.5 0 0 1 5 5 l-1.5 1.5 M13.5 17.5 L12 19 a3.5 3.5 0 0 1-5-5 l1.5-1.5"
                  stroke={t.colors.text.muted}
                  strokeWidth={2}
                  strokeLinecap="round"
                />
              </Svg>
            ) : null}
            <TextInput
              value={content.url}
              editable={false}
              selectTextOnFocus
              accessibilityLabel={`${content.subject.charAt(0).toUpperCase()}${content.subject.slice(1)} link`}
              style={[styles.urlInput, { fontSize: band.input }]}
            />
            {!phone ? copyButton : null}
          </View>
          {phone ? copyButton : null}
          {error ? (
            <Text accessibilityRole="alert" style={styles.error}>
              {error}
            </Text>
          ) : null}
          <View style={[styles.socialSection, !desktop && styles.sheetSocialSection]}>
            <Text style={[styles.socialLabel, { fontSize: desktop ? 11 : phone ? 12 : 11.5 }]}>
              SHARE TO
            </Text>
            <View style={styles.grid}>
              {rows.map((row, index) => (
                <View key={index} style={styles.destinationRow}>
                  {row.map(([key, label, accessibleLabel]) => (
                    <DestinationButton
                      key={key}
                      label={label}
                      accessibleLabel={accessibleLabel}
                      destination={key}
                      band={band}
                      onPress={() => openIntent(key)}
                    />
                  ))}
                </View>
              ))}
            </View>
          </View>
          {canUseDeviceShare ? (
            <Pressable
              accessibilityRole="button"
              onPress={() => void openDeviceShare()}
              style={[
                styles.deviceButton,
                { minHeight: desktop ? 46 : 52, marginTop: desktop ? 14 : phone ? 16 : 18 },
              ]}
            >
              <Svg
                width={desktop ? 17 : 19}
                height={desktop ? 17 : 19}
                viewBox="0 0 24 24"
                fill="none"
                aria-hidden
              >
                <Path
                  d="M12 15 V4 M8.5 7.5 L12 4 L15.5 7.5 M5 13 v4.5 a2.5 2.5 0 0 0 2.5 2.5 h9 a2.5 2.5 0 0 0 2.5-2.5 V13"
                  stroke={t.colors.text.primary}
                  strokeWidth={2}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </Svg>
              <Text style={[styles.deviceText, { fontSize: band.device }]}>
                Share using another app
              </Text>
            </Pressable>
          ) : null}
        </View>
      </ScrollView>
    </View>
  );
}

function DestinationButton({
  label,
  accessibleLabel,
  destination,
  band,
  onPress,
}: {
  label: string;
  accessibleLabel: string;
  destination: keyof ShareIntents;
  band: (typeof BANDS)[SharePanelVariant];
  onPress: () => void;
}) {
  const [hovered, hover] = useHover();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibleLabel}
      onPress={onPress}
      {...hover}
      style={[styles.destination, hovered && styles.destinationHover]}
    >
      <View
        style={[
          styles.circle,
          { width: band.circle, height: band.circle, borderRadius: band.circle / 2 },
        ]}
      >
        <ShareDestinationIcon destination={destination} size={band.icon} />
      </View>
      <Text style={[styles.destinationName, { fontSize: band.name }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  body: { flexShrink: 1 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  heading: {
    flex: 1,
    fontFamily: t.typography.title,
    fontWeight: '800',
    letterSpacing: -0.25,
    color: t.colors.text.primary,
  },
  close: {
    width: 44,
    height: 44,
    flexShrink: 0,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 10,
  },
  scroll: {
    flexShrink: 1,
    marginTop: 16,
    ...(isWeb ? ({ overscrollBehavior: 'contain' } as object) : {}),
  },
  scrollContent: { paddingBottom: 2 },
  content: { width: '100%' },
  tabletContent: { maxWidth: 760 },
  recordTitle: {
    fontFamily: t.typography.ui,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
    letterSpacing: -0.16,
    color: t.colors.text.primary,
  },
  description: {
    marginTop: 4,
    fontFamily: t.typography.body,
    fontVariant: ['tabular-nums'],
    color: t.colors.text.muted,
  },
  urlRow: {
    marginTop: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#f7f9f8',
    borderWidth: 1,
    borderColor: t.colors.alpha.ink10,
    borderRadius: 11,
    paddingVertical: 5,
    paddingRight: 5,
    paddingLeft: 14,
  },
  sheetUrlRow: { marginTop: 16, gap: 10, borderRadius: 12 },
  phoneUrlRow: {
    paddingVertical: 12,
    paddingHorizontal: 14,
    backgroundColor: '#f4f5f7',
    borderColor: t.colors.alpha.ink12,
  },
  urlInput: {
    flex: 1,
    minWidth: 0,
    minHeight: 28,
    fontFamily: t.typography.ui,
    fontWeight: '500',
    fontVariant: ['tabular-nums'],
    color: t.colors.text.secondary,
    backgroundColor: 'transparent',
  },
  copyButton: {
    flexDirection: 'row',
    flexShrink: 0,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    paddingHorizontal: 18,
    paddingVertical: 8,
    backgroundColor: t.colors.brand.base,
    borderRadius: 8,
  },
  copiedButton: { paddingLeft: 15 },
  stackedCopy: { marginTop: 10, borderRadius: 12 },
  copyText: { fontFamily: t.typography.ui, fontWeight: '700', color: t.colors.text.onGreen },
  socialSection: {
    marginTop: 16,
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: t.colors.alpha.ink08,
  },
  sheetSocialSection: { marginTop: 20, paddingTop: 18 },
  socialLabel: {
    fontFamily: t.typography.mono,
    fontWeight: '700',
    letterSpacing: 1.54,
    color: t.colors.text.muted,
  },
  grid: { marginTop: 12, gap: 8 },
  destinationRow: { flexDirection: 'row', gap: 8 },
  destination: {
    flex: 1,
    minWidth: 0,
    alignItems: 'center',
    gap: 8,
    paddingTop: 10,
    paddingBottom: 11,
    paddingHorizontal: 2,
    borderRadius: 12,
  },
  destinationHover: { backgroundColor: 'rgba(17,21,15,0.05)' },
  circle: { alignItems: 'center', justifyContent: 'center', backgroundColor: '#f1f1f4' },
  destinationName: {
    fontFamily: t.typography.ui,
    fontWeight: '700',
    color: '#2c322c',
    textAlign: 'center',
  },
  deviceButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    padding: 10,
    backgroundColor: t.colors.surfaces.base,
    borderWidth: 1,
    borderColor: t.colors.alpha.ink16,
    borderRadius: 12,
  },
  deviceText: {
    flexShrink: 1,
    fontFamily: t.typography.ui,
    fontWeight: '700',
    color: t.colors.text.primary,
    textAlign: 'center',
  },
  error: {
    marginTop: 10,
    fontFamily: t.typography.body,
    fontSize: 14,
    lineHeight: 20,
    color: t.colors.text.primary,
  },
});
