import { useEffect, useState } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';

import { useAuth } from '../../providers/AuthProvider';
import { theme as t } from '../../theme/tokens';

const PASSWORD_NOTICE_KEY = 'alethical.passwordChangedNotice';

/** Show the different-account reset result once, then consume it. */
export function PasswordChangedNotice() {
  const { isLoading, user } = useAuth();
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (isLoading || Platform.OS !== 'web' || typeof window === 'undefined') return;
    setMessage(null);
    try {
      const saved = window.sessionStorage.getItem(PASSWORD_NOTICE_KEY);
      window.sessionStorage.removeItem(PASSWORD_NOTICE_KEY);
      if (!saved) return;
      const next = JSON.parse(saved) as { resetEmail?: unknown; ordinaryEmail?: unknown };
      if (
        typeof next.resetEmail !== 'string' ||
        typeof next.ordinaryEmail !== 'string' ||
        user?.email.trim().toLowerCase() !== next.ordinaryEmail.trim().toLowerCase()
      ) {
        return;
      }
      setMessage(
        `Password changed for ${next.resetEmail}. You’re still signed in as ${next.ordinaryEmail}.`,
      );
      const timer = window.setTimeout(() => setMessage(null), 6000);
      return () => window.clearTimeout(timer);
    } catch {
      // The reset itself succeeded even if this short confirmation cannot persist.
    }
  }, [isLoading, user?.email]);

  if (!message) return null;

  return (
    <View
      {...(Platform.OS === 'web' ? ({ role: 'status' } as object) : null)}
      accessibilityLiveRegion="polite"
      pointerEvents="none"
      style={[styles.notice, Platform.OS === 'web' ? (t.shadows.lg as object) : null]}
    >
      <Text style={styles.text}>{message}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  notice: {
    position: 'absolute',
    left: 24,
    bottom: 24,
    zIndex: 80,
    maxWidth: 440,
    borderRadius: 13,
    backgroundColor: t.colors.footerBg,
    paddingVertical: 14,
    paddingHorizontal: 18,
  },
  text: {
    fontFamily: t.typography.ui,
    fontSize: t.fontSizes.body,
    lineHeight: 22,
    fontWeight: t.fontWeights.semibold,
    color: t.colors.white,
  },
});
