import { useEffect, useRef, useState } from 'react';
import { Modal, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';

import { theme as t } from '../../theme/tokens';
import { useAuth } from '../../providers/AuthProvider';

// What replaces the "Sign in" button once you're in (docs/mockups/sign-in,
// ACCOUNT CONTROL band). Three placements, one identity: a pill with a dropdown
// on desktop, an avatar opening a sheet on the phone top bar, and a row in the
// phone drawer's footer. Its only action is Sign out — the built Account page is
// pre-redesign and its URL redirects home, so a row pointing at it would send
// someone to a broken surface.

const isWeb = Platform.OS === 'web';

function displayName(name: string | undefined, email: string | undefined) {
  const trimmed = (name ?? '').trim();
  if (trimmed) return trimmed;
  return (email ?? '').split('@')[0] || 'Your account';
}

function initialOf(label: string) {
  return label.trim().charAt(0).toUpperCase() || '?';
}

function SignOutIcon({ color }: { color: string }) {
  return (
    <Svg width={17} height={17} viewBox="0 0 24 24" fill="none">
      <Path
        d="M13 4 H7 a2 2 0 0 0-2 2 v12 a2 2 0 0 0 2 2 h6"
        stroke={color}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path
        d="M15 12 H21 M18.5 8.5 L21 12 L18.5 15.5"
        stroke={color}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

function ChevronIcon() {
  return (
    <Svg width={14} height={14} viewBox="0 0 24 24" fill="none">
      <Path
        d="M6 10 L12 16 L18 10"
        stroke={t.colors.text.faint}
        strokeWidth={2.2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

function Avatar({ label, size }: { label: string; size: number }) {
  return (
    <View style={[styles.avatar, { width: size, height: size }]}>
      <Text style={[styles.avatarText, { fontSize: Math.round(size * 0.45) }]}>
        {initialOf(label)}
      </Text>
    </View>
  );
}

function Identity({ name, email, avatar }: { name: string; email: string; avatar: number }) {
  return (
    <View style={styles.identityRow}>
      <Avatar label={name} size={avatar} />
      <View style={styles.identityText}>
        <Text numberOfLines={1} style={styles.identityName}>
          {name}
        </Text>
        <Text numberOfLines={1} style={styles.identityEmail}>
          {email}
        </Text>
      </View>
    </View>
  );
}

/** Desktop top nav: avatar + first name + chevron, opening a right-aligned menu. */
export function AccountNavButton() {
  const { user, signOut } = useAuth();
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<View>(null);

  // Any click outside the button + panel closes the menu, matching how the nav's
  // own dropdowns behave (a full-screen overlay would swallow the panel's rows).
  useEffect(() => {
    if (!isWeb || !open) return;
    const handlePointerDown = (event: Event) => {
      const node = wrapRef.current as unknown as HTMLElement | null;
      const target = event.target as Node | null;
      if (node && target && node.contains(target)) return;
      setOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', handlePointerDown, true);
    document.addEventListener('keydown', handleKeyDown, true);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown, true);
      document.removeEventListener('keydown', handleKeyDown, true);
    };
  }, [open]);

  const name = displayName(user?.name, user?.email);
  const firstName = name.split(' ')[0];

  return (
    <View ref={wrapRef} style={styles.navWrap}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Account menu for ${name}`}
        accessibilityState={{ expanded: open }}
        onPress={() => setOpen((value) => !value)}
        style={({ pressed }) => [styles.navPill, pressed && styles.navPillPressed]}
      >
        <Avatar label={name} size={30} />
        <Text numberOfLines={1} style={styles.navPillName}>
          {firstName}
        </Text>
        <ChevronIcon />
      </Pressable>
      {open ? (
        <View style={styles.menuPanel}>
          <View style={styles.menuHeader}>
            <Identity name={name} email={user?.email ?? ''} avatar={38} />
          </View>
          <View style={styles.menuDivider} />
          <Pressable
            accessibilityRole="menuitem"
            onPress={() => {
              setOpen(false);
              void signOut();
            }}
            style={({ pressed }) => [styles.menuItem, pressed && styles.menuItemPressed]}
          >
            <SignOutIcon color={t.colors.text.faint} />
            <Text style={styles.menuItemText}>Sign out</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

/** Phone top bar: a 44x44 avatar target that opens the account sheet. */
export function AccountAvatarButton() {
  const { user, signOut } = useAuth();
  const [open, setOpen] = useState(false);
  const name = displayName(user?.name, user?.email);

  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Account menu"
        accessibilityState={{ expanded: open }}
        onPress={() => setOpen(true)}
        style={styles.avatarButton}
      >
        <Avatar label={name} size={34} />
      </Pressable>
      <Modal visible={open} transparent animationType="slide" onRequestClose={() => setOpen(false)}>
        <View style={styles.sheetScrim}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close account menu"
            onPress={() => setOpen(false)}
            style={StyleSheet.absoluteFill}
          />
          <View style={styles.sheet} accessibilityViewIsModal accessibilityLabel="Account">
            <View style={styles.grabHandle} />
            <Identity name={name} email={user?.email ?? ''} avatar={48} />
            <Pressable
              accessibilityRole="button"
              onPress={() => {
                setOpen(false);
                void signOut();
              }}
              style={({ pressed }) => [styles.sheetButton, pressed && styles.sheetButtonPressed]}
            >
              <SignOutIcon color={t.colors.text.primary} />
              <Text style={styles.sheetButtonText}>Sign out</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </>
  );
}

/** Phone drawer footer: who you are, and a way out. */
export function AccountDrawerRow({ onSignedOut }: { onSignedOut?: () => void }) {
  const { user, signOut } = useAuth();
  const name = displayName(user?.name, user?.email);

  return (
    <View>
      <Identity name={name} email={user?.email ?? ''} avatar={44} />
      <Pressable
        accessibilityRole="button"
        onPress={() => {
          onSignedOut?.();
          void signOut();
        }}
        style={({ pressed }) => [styles.drawerSignOut, pressed && styles.drawerSignOutPressed]}
      >
        <SignOutIcon color={t.colors.text.faint} />
        <Text style={styles.drawerSignOutText}>Sign out</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  avatar: {
    borderRadius: t.radii.pill,
    backgroundColor: t.colors.tint.t150,
    borderWidth: 1,
    borderColor: t.colors.tint.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    fontFamily: t.typography.ui,
    fontWeight: t.fontWeights.bold,
    color: t.colors.brand.deep,
  },
  identityRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  identityText: { flex: 1, minWidth: 0 },
  identityName: {
    fontFamily: t.typography.ui,
    fontSize: t.fontSizes.bodyLg,
    fontWeight: t.fontWeights.bold,
    color: t.colors.text.primary,
  },
  identityEmail: {
    fontFamily: t.typography.body,
    fontSize: t.fontSizes.meta,
    color: t.colors.text.muted,
  },
  // Sits above the page beneath it, the same way the nav's dropdown triggers do.
  navWrap: { position: 'relative', zIndex: 60 },
  navPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    backgroundColor: t.colors.surfaces.base,
    borderWidth: 1,
    borderColor: t.colors.alpha.ink14,
    borderRadius: t.radii.pill,
    paddingVertical: 5,
    paddingLeft: 5,
    paddingRight: 12,
  },
  navPillPressed: { backgroundColor: t.colors.surfaces.s200 },
  navPillName: {
    fontFamily: t.typography.ui,
    fontSize: t.fontSizes.small,
    fontWeight: t.fontWeights.semibold,
    color: t.colors.text.primary,
  },
  menuPanel: {
    position: 'absolute',
    top: '100%',
    right: 0,
    marginTop: 10,
    width: 268,
    zIndex: 60,
    backgroundColor: t.colors.surfaces.base,
    borderWidth: 1,
    borderColor: t.colors.alpha.ink10,
    borderRadius: 12,
    overflow: 'hidden',
    ...(t.shadows.panel as object),
  },
  menuHeader: { paddingVertical: 14, paddingHorizontal: 15 },
  menuDivider: { height: 1, backgroundColor: t.colors.alpha.ink08 },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 13,
    paddingHorizontal: 15,
  },
  menuItemPressed: { backgroundColor: t.colors.surfaces.s300 },
  menuItemText: {
    fontFamily: t.typography.ui,
    fontSize: t.fontSizes.small,
    fontWeight: t.fontWeights.semibold,
    color: t.colors.text.primary,
  },
  avatarButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  sheetScrim: { flex: 1, backgroundColor: 'rgba(10,14,12,0.5)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: t.colors.surfaces.base,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingTop: 12,
    paddingHorizontal: 22,
    paddingBottom: 26,
  },
  grabHandle: {
    width: 40,
    height: 5,
    borderRadius: t.radii.pill,
    backgroundColor: t.colors.borders.base,
    alignSelf: 'center',
    marginBottom: 18,
  },
  sheetButton: {
    marginTop: 20,
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 9,
    backgroundColor: t.colors.surfaces.base,
    borderWidth: 1,
    borderColor: t.colors.alpha.ink18,
    borderRadius: 13,
    paddingVertical: 16,
  },
  sheetButtonPressed: { backgroundColor: t.colors.surfaces.s300 },
  sheetButtonText: {
    fontFamily: t.typography.ui,
    fontSize: t.fontSizes.lg,
    fontWeight: t.fontWeights.semibold,
    color: t.colors.text.primary,
  },
  drawerSignOut: {
    marginTop: 12,
    minHeight: 44,
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 8,
  },
  drawerSignOutPressed: { opacity: 0.7 },
  drawerSignOutText: {
    fontFamily: t.typography.ui,
    fontSize: t.fontSizes.bodyLg,
    fontWeight: t.fontWeights.semibold,
    color: t.colors.text.primary,
  },
});
