import { useEffect } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';

import { theme as t } from '../../theme/tokens';

const isWeb = Platform.OS === 'web';

// Dark "Now tracking {code}." confirmation toast for the Search Bills screen
// (docs/mockups/search-bills, "RETURN-AFTER-SIGN-IN TOAST"). Auto-dismisses
// after ~3.6s. Bottom-left, pinned above the page. Bills-only.
const TOAST_MS = 3600;

export function ReturnToast({
  visible,
  billCode,
  onDismiss,
}: {
  visible: boolean;
  billCode: string;
  onDismiss: () => void;
}) {
  useEffect(() => {
    if (!visible) return;
    const timer = setTimeout(onDismiss, TOAST_MS);
    return () => clearTimeout(timer);
  }, [visible, billCode, onDismiss]);

  if (!visible) return null;

  return (
    <View
      accessibilityLiveRegion="polite"
      pointerEvents="none"
      style={[styles.toast, isWeb ? (styles.toastShadowWeb as object) : (t.shadows.lg as object)]}
    >
      <View style={styles.check}>
        <Svg width={12} height={12} viewBox="0 0 24 24" fill="none">
          <Path
            d="M5 12.5 L10 17.5 L19 7"
            stroke={t.colors.brand.darkest}
            strokeWidth={3}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </Svg>
      </View>
      <Text style={styles.text}>
        Now tracking <Text style={styles.code}>{billCode}</Text>.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  toast: {
    position: 'absolute',
    left: 32,
    bottom: 32,
    zIndex: 60,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: t.colors.footerBg,
    paddingVertical: 15,
    paddingHorizontal: 22,
    borderRadius: 13,
  },
  toastShadowWeb: { boxShadow: '0 16px 40px rgba(17,21,15,0.35)' },
  check: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: t.colors.brand.base,
    alignItems: 'center',
    justifyContent: 'center',
  },
  text: {
    fontFamily: t.typography.ui,
    fontSize: t.fontSizes.body,
    fontWeight: t.fontWeights.semibold,
    color: t.colors.white,
  },
  code: {
    fontFamily: t.typography.mono,
    fontWeight: t.fontWeights.bold,
    color: t.colors.brand.bright,
  },
});
