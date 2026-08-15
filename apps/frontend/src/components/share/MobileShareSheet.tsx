import { useEffect, useRef, useState } from 'react';
import * as Clipboard from 'expo-clipboard';
import {
  Linking,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';

import { buildShareIntents, nativeShareText, type ShareContent } from '../../lib/share';
import { theme as t } from '../../theme/tokens';

const isWeb = Platform.OS === 'web';
const COLUMN_MAX = 640;

export function MobileShareSheet({
  visible,
  onClose,
  content,
}: {
  visible: boolean;
  onClose: () => void;
  content: ShareContent;
}) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const intents = buildShareIntents(content);
  const canUseDeviceShare =
    !isWeb || (typeof navigator !== 'undefined' && typeof navigator.share === 'function');

  useEffect(() => {
    if (!visible) setCopied(false);
  }, [visible]);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const copyLink = () => {
    void Clipboard.setStringAsync(content.url);
    setCopied(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), 1900);
  };

  const openIntent = (url: string) => {
    void Linking.openURL(url);
  };

  const openDeviceShare = () => {
    if (isWeb && typeof navigator !== 'undefined' && navigator.share) {
      void navigator
        .share({
          title: content.title,
          text: nativeShareText(content, false),
          url: content.url,
        })
        .catch(() => {});
      return;
    }

    void Share.share({
      title: content.title,
      message: nativeShareText(content, true),
      url: content.url,
    }).catch(() => {});
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Close">
        <Pressable
          style={styles.sheet}
          accessibilityViewIsModal
          accessibilityLabel={`Share this ${content.subject}`}
          onPress={(event) => event.stopPropagation?.()}
        >
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close"
            onPress={onClose}
            style={styles.close}
          >
            <Svg width={18} height={18} viewBox="0 0 24 24" fill="none">
              <Path
                d="M6 6 L18 18 M18 6 L6 18"
                stroke={t.colors.text.faint}
                strokeWidth={2.2}
                strokeLinecap="round"
              />
            </Svg>
          </Pressable>

          <ScrollView showsVerticalScrollIndicator={false}>
            <View style={styles.iconTile}>
              <ShareIcon />
            </View>
            <Text accessibilityRole="header" aria-level={2} style={styles.title}>
              {`Share this ${content.subject}`}
            </Text>
            <Text style={styles.contentTitle}>{content.title}</Text>
            <Text style={styles.description}>{content.description}</Text>

            <View style={styles.urlField}>
              <Text numberOfLines={1} style={styles.urlText}>
                {content.url}
              </Text>
            </View>

            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Copy link"
              onPress={copyLink}
              style={styles.copyButton}
            >
              {copied ? <CheckIcon /> : null}
              <Text style={styles.copyButtonText}>{copied ? 'Link copied' : 'Copy link'}</Text>
            </Pressable>

            {canUseDeviceShare ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Share using another app"
                onPress={openDeviceShare}
                style={styles.deviceShareButton}
              >
                <ShareIcon color={t.colors.text.primary} size={18} />
                <Text style={styles.deviceShareButtonText}>Share using another app</Text>
              </Pressable>
            ) : null}

            <View style={styles.socialSection}>
              <Text style={styles.socialLabel}>SHARE TO</Text>
              <View style={styles.socialRow}>
                <SocialButton
                  label="Share on LinkedIn"
                  onPress={() => openIntent(intents.linkedin)}
                >
                  <Path d="M20.45 20.45h-3.56v-5.57c0-1.33-.02-3.04-1.85-3.04-1.85 0-2.14 1.45-2.14 2.94v5.67H9.35V9h3.42v1.56h.05c.48-.9 1.64-1.85 3.37-1.85 3.6 0 4.27 2.37 4.27 5.46v6.28zM5.34 7.43a2.06 2.06 0 1 1 0-4.13 2.06 2.06 0 0 1 0 4.13zM7.12 20.45H3.56V9h3.56v11.45zM22.22 0H1.77C.79 0 0 .77 0 1.72v20.56C0 23.23.79 24 1.77 24h20.45c.98 0 1.78-.77 1.78-1.72V1.72C24 .77 23.2 0 22.22 0z" />
                </SocialButton>
                <SocialButton label="Share on X" onPress={() => openIntent(intents.x)}>
                  <Path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
                </SocialButton>
                <SocialButton
                  label="Share on Facebook"
                  onPress={() => openIntent(intents.facebook)}
                >
                  <Path d="M15.12 5.32H17V2.14A26.11 26.11 0 0 0 14.26 2c-2.72 0-4.58 1.66-4.58 4.7v2.6H6.61v3.56h3.07V22h3.68v-9.14h3.06l.46-3.56h-3.52V7.05c0-1.03.28-1.73 1.76-1.73z" />
                </SocialButton>
                <SocialButton
                  label="Share by email"
                  onPress={() => openIntent(intents.email)}
                  stroke
                >
                  <Path
                    d="M3 6.5 h18 v11 h-18 Z M4 7.5 L12 13 L20 7.5"
                    stroke={t.colors.text.primary}
                    strokeWidth={2}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    fill="none"
                  />
                </SocialButton>
              </View>
            </View>
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function ShareIcon({ color = t.colors.purple.base, size = 22 }: { color?: string; size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Circle cx={18} cy={5} r={2.6} stroke={color} strokeWidth={2} />
      <Circle cx={6} cy={12} r={2.6} stroke={color} strokeWidth={2} />
      <Circle cx={18} cy={19} r={2.6} stroke={color} strokeWidth={2} />
      <Path
        d="M8.4 10.7 L15.6 6.5 M8.4 13.3 L15.6 17.5"
        stroke={color}
        strokeWidth={2}
        strokeLinecap="round"
      />
    </Svg>
  );
}

function CheckIcon() {
  return (
    <Svg width={18} height={18} viewBox="0 0 24 24" fill="none">
      <Path
        d="M5 12.5 L10 17.5 L19 7"
        stroke={t.colors.brand.darkest}
        strokeWidth={2.6}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

function SocialButton({
  label,
  onPress,
  children,
  stroke = false,
}: {
  label: string;
  onPress: () => void;
  children: React.ReactNode;
  stroke?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={styles.socialButton}
    >
      <Svg
        width={21}
        height={21}
        viewBox="0 0 24 24"
        fill={stroke ? 'none' : t.colors.text.primary}
      >
        {children}
      </Svg>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(10,14,12,0.55)',
  },
  sheet: {
    width: '100%',
    maxWidth: COLUMN_MAX,
    maxHeight: '92%',
    alignSelf: 'center',
    backgroundColor: t.colors.surfaces.base,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingTop: 26,
    paddingBottom: 30,
    paddingHorizontal: 22,
  },
  close: {
    position: 'absolute',
    top: 22,
    right: 22,
    zIndex: 1,
    width: 36,
    height: 36,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconTile: {
    width: 48,
    height: 48,
    borderRadius: 13,
    backgroundColor: t.colors.purple.tint,
    borderWidth: 1,
    borderColor: t.colors.purple.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    marginTop: 16,
    fontFamily: t.typography.title,
    fontSize: t.fontSizes.h3,
    fontWeight: t.fontWeights.heavy,
    letterSpacing: -0.22,
    color: t.colors.text.primary,
  },
  contentTitle: {
    marginTop: 8,
    fontFamily: t.typography.ui,
    fontSize: t.fontSizes.lg,
    fontWeight: t.fontWeights.bold,
    lineHeight: 25,
    color: t.colors.text.primary,
  },
  description: {
    marginTop: 6,
    fontFamily: t.typography.body,
    fontSize: t.fontSizes.body,
    lineHeight: 23,
    color: t.colors.text.muted,
  },
  urlField: {
    marginTop: 16,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: t.colors.surfaces.s300,
    borderWidth: 1,
    borderColor: t.colors.alpha.ink12,
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 14,
  },
  urlText: {
    flex: 1,
    fontFamily: t.typography.mono,
    fontSize: t.fontSizes.small,
    color: t.colors.text.secondary,
  },
  copyButton: {
    marginTop: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: t.colors.brand.base,
    borderRadius: 12,
    paddingVertical: 15,
    minHeight: 48,
  },
  copyButtonText: {
    fontFamily: t.typography.ui,
    fontSize: t.fontSizes.subhead,
    fontWeight: t.fontWeights.bold,
    color: t.colors.text.onGreen,
  },
  deviceShareButton: {
    marginTop: 10,
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 9,
    backgroundColor: t.colors.surfaces.base,
    borderWidth: 1,
    borderColor: t.colors.alpha.ink16,
    borderRadius: 12,
    paddingVertical: 13,
  },
  deviceShareButtonText: {
    fontFamily: t.typography.ui,
    fontSize: t.fontSizes.body,
    fontWeight: t.fontWeights.bold,
    color: t.colors.text.primary,
  },
  socialSection: {
    marginTop: 20,
    paddingTop: 18,
    borderTopWidth: 1,
    borderTopColor: t.colors.alpha.ink08,
  },
  socialLabel: {
    fontFamily: t.typography.mono,
    fontSize: t.fontSizes.label,
    fontWeight: t.fontWeights.bold,
    letterSpacing: 1.6,
    color: t.colors.text.faint,
  },
  socialRow: {
    marginTop: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  socialButton: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: t.colors.surfaces.s400,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
