import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Path, Rect } from 'react-native-svg';

import { theme as t } from '../../theme/tokens';
import { useHover } from './interactions';

// Sign-in modal with ONE intent — see your legislators (spec §Tracking removed /
// sign-in modal). "Continue with Google" returns signed in with the district
// revealed. Tracking has no controls on this page.
export function VotesSignInModal({
  visible,
  onClose,
  onContinue,
}: {
  visible: boolean;
  onClose: () => void;
  onContinue: () => void;
}) {
  const [hovered, hover] = useHover();
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.scrim} onPress={onClose} accessibilityLabel="Close sign in">
        <Pressable style={styles.card} onPress={() => {}}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close"
            onPress={onClose}
            style={styles.close}
          >
            <Svg width={18} height={18} viewBox="0 0 24 24" fill="none">
              <Path
                d="M6 6 L18 18 M18 6 L6 18"
                stroke={t.colors.text.muted}
                strokeWidth={2.2}
                strokeLinecap="round"
              />
            </Svg>
          </Pressable>

          <View style={styles.icon}>
            <Svg width={26} height={26} viewBox="0 0 24 24" fill="none">
              <Rect
                x={5}
                y={11}
                width={14}
                height={9}
                rx={2}
                stroke={t.colors.brand.deep}
                strokeWidth={2}
              />
              <Path
                d="M8 11 V8 a4 4 0 0 1 8 0 v3"
                stroke={t.colors.brand.deep}
                strokeWidth={2}
                strokeLinecap="round"
              />
            </Svg>
          </View>

          <Text accessibilityRole="header" style={styles.title}>
            Sign in to see your legislators
          </Text>
          <Text style={styles.body}>
            Save your district once from Find My Legislator, and every roll call on Alethical shows
            how your senator and representative voted.
          </Text>

          <Pressable
            accessibilityRole="button"
            onPress={onContinue}
            {...hover}
            style={[styles.googleBtn, hovered && styles.googleBtnHover]}
          >
            <Svg width={20} height={20} viewBox="0 0 24 24">
              <Path
                fill="#4285F4"
                d="M23.06 12.25c0-.86-.07-1.5-.22-2.16H12v3.92h6.31c-.13 1.05-.81 2.63-2.34 3.69l-.02.14 3.4 2.63.24.02c2.16-2 3.47-4.94 3.47-8.26z"
              />
              <Path
                fill="#34A853"
                d="M12 23.5c3.09 0 5.68-1.02 7.58-2.77l-3.62-2.8c-.96.68-2.26 1.15-3.96 1.15-3.03 0-5.6-2-6.51-4.76l-.13.01-3.53 2.73-.05.13C3.6 20.8 7.5 23.5 12 23.5z"
              />
              <Path
                fill="#FBBC05"
                d="M5.49 14.32A7.09 7.09 0 0 1 5.11 12c0-.81.15-1.59.37-2.32l-.01-.16L1.9 6.75l-.11.05A11.44 11.44 0 0 0 .5 12c0 1.85.44 3.6 1.29 5.2l3.7-2.88z"
              />
              <Path
                fill="#EA4335"
                d="M12 4.92c2.15 0 3.6.93 4.42 1.7l3.23-3.15C17.67 1.6 15.09.5 12 .5 7.5.5 3.6 3.2 1.79 6.8l3.69 2.88C6.4 6.92 8.97 4.92 12 4.92z"
              />
            </Svg>
            <Text style={styles.googleText}>Continue with Google</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  scrim: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 40,
    backgroundColor: 'rgba(10,14,12,0.55)',
  },
  card: {
    width: 470,
    maxWidth: '100%',
    backgroundColor: t.colors.surfaces.base,
    borderRadius: t.radii.xl,
    paddingHorizontal: 34,
    paddingTop: 34,
    paddingBottom: 32,
    ...(t.shadows.lg as object),
  },
  close: {
    position: 'absolute',
    top: 18,
    right: 18,
    width: 34,
    height: 34,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 9,
  },
  icon: {
    width: 52,
    height: 52,
    borderRadius: t.radii.lg,
    backgroundColor: t.colors.tint.t150,
    borderWidth: 1,
    borderColor: t.colors.tint.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    marginTop: 20,
    fontFamily: t.typography.title,
    fontSize: t.fontSizes.h2,
    fontWeight: t.fontWeights.heavy,
    letterSpacing: -0.3,
    color: t.colors.text.primary,
  },
  body: {
    marginTop: 10,
    fontFamily: t.typography.body,
    fontSize: t.fontSizes.bodyLg,
    lineHeight: 24,
    color: t.colors.text.faint,
  },
  googleBtn: {
    marginTop: 24,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    backgroundColor: t.colors.surfaces.base,
    borderWidth: 1,
    borderColor: t.colors.alpha.ink18,
    borderRadius: t.radii.md,
    paddingVertical: 15,
    paddingHorizontal: 22,
  },
  googleBtnHover: { backgroundColor: t.colors.surfaces.s200, borderColor: t.colors.alpha.ink32 },
  googleText: {
    fontFamily: t.typography.ui,
    fontSize: t.fontSizes.bodyLg,
    fontWeight: t.fontWeights.semibold,
    color: t.colors.text.primary,
  },
});
