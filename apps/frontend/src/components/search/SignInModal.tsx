import { Modal, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { Lock, X } from 'lucide-react-native';

import { theme as t } from '../../theme/tokens';
import { GoogleButton } from '../../theme/primitives';

const isWeb = Platform.OS === 'web';

// Intent-preserving Track sign-in for the Search Bills screen only
// (docs/mockups/search-bills, "INTENT-PRESERVING SIGN-IN"). A signed-out Track
// tap opens this; "Continue with Google" starts OAuth and returns to the bill
// with it tracked. The Search Legislators screen has no follow/modal/toast.

export function SignInModal({
  visible,
  billCode,
  onClose,
  onContinue,
}: {
  visible: boolean;
  billCode: string;
  onClose: () => void;
  onContinue: () => void;
}) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.scrim}>
        {/* Backdrop tap closes; sits behind the card so card taps don't reach it. */}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Dismiss sign-in"
          onPress={onClose}
          style={StyleSheet.absoluteFill}
        />
        <View
          style={[styles.card, isWeb ? (styles.cardShadowWeb as object) : (t.shadows.lg as object)]}
        >
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close"
            onPress={onClose}
            style={({ pressed }) => [styles.close, pressed && styles.closePressed]}
          >
            <X size={18} color={t.colors.text.faint} strokeWidth={2.2} />
          </Pressable>

          <View style={styles.lockTile}>
            <Lock size={26} color={t.colors.brand.deep} strokeWidth={2} />
          </View>

          <Text accessibilityRole="header" style={styles.title}>
            Sign in to track {billCode}
          </Text>
          <Text style={styles.body}>
            Tracking saves this bill to your watchlist and turns on status updates. You’ll come
            right back to your search.
          </Text>

          <View style={styles.action}>
            <GoogleButton onPress={onContinue} />
          </View>
        </View>
      </View>
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
    borderRadius: 20,
    paddingTop: 34,
    paddingHorizontal: 34,
    paddingBottom: 32,
  },
  cardShadowWeb: { boxShadow: '0 30px 80px rgba(10,14,12,0.4)' },
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
  closePressed: { backgroundColor: t.colors.surfaces.s400 },
  lockTile: {
    width: 52,
    height: 52,
    borderRadius: 14,
    backgroundColor: t.colors.tint.t150,
    borderWidth: 1,
    borderColor: t.colors.tint.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    marginTop: 20,
    fontFamily: t.typography.title,
    fontSize: t.fontSizes.h1,
    fontWeight: t.fontWeights.heavy,
    letterSpacing: -0.26,
    color: t.colors.text.primary,
  },
  body: {
    marginTop: 10,
    fontFamily: t.typography.body,
    fontSize: t.fontSizes.bodyLg,
    lineHeight: 24,
    color: t.colors.text.muted,
  },
  action: { marginTop: 24 },
});
