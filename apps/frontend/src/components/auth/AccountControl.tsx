import { useEffect, useRef, useState } from 'react';
import { Modal, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';

import {
  REV9_AUTH_MESSAGES,
  createValidRequestGate,
  validatePassword,
  validatePasswordMatch,
} from '../../lib/auth/rev9Auth';
import { theme as t } from '../../theme/tokens';
import { useAuth } from '../../providers/AuthProvider';
import { FormError } from './FormError';
import { LoadingButton } from './LoadingButton';
import { PasswordField } from './PasswordField';
import { SignInContainer } from './SignInContainer';

// What replaces the "Sign in" button once you're in (docs/mockups/sign-in,
// ACCOUNT CONTROL band). Three placements, one identity: a pill with a dropdown
// on desktop, an avatar opening a sheet on the phone top bar, and a row in the
// phone drawer's footer. The panel and sheet offer the built account actions;
// the drawer footer stays compact and keeps only Sign out.

const isWeb = Platform.OS === 'web';
const emailPasswordEnabled = process.env.EXPO_PUBLIC_EMAIL_PASSWORD_SIGN_IN_ENABLED === 'true';

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

function PasswordIcon({
  color,
  done = false,
  size = 17,
}: {
  color: string;
  done?: boolean;
  size?: number;
}) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
      {done ? (
        <Path
          d="M5 12.5 L10 17.5 L19 7"
          stroke={color}
          strokeWidth={2.4}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ) : (
        <>
          <Path d="M6 10 H18 V21 H6 Z" stroke={color} strokeWidth={2} />
          <Path d="M8.5 10 V7.5 A3.5 3.5 0 0 1 15.5 7.5 V10" stroke={color} strokeWidth={2} />
        </>
      )}
    </Svg>
  );
}

function QuietButton({
  label,
  disabled,
  onPress,
}: {
  label: string;
  disabled: boolean;
  onPress: () => void;
}) {
  const [focused, setFocused] = useState(false);
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onBlur={() => setFocused(false)}
      onFocus={() => setFocused(true)}
      onPress={onPress}
      style={({ pressed }) => [
        styles.quietButton,
        focused && focusRingWeb,
        pressed && styles.quietButtonPressed,
        disabled && styles.quietButtonDisabled,
      ]}
    >
      <Text style={styles.quietButtonText}>{label}</Text>
    </Pressable>
  );
}

export function SetPasswordDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { setPassword } = useAuth();
  const [password, setPasswordValue] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [passwordError, setPasswordError] = useState<string | undefined>();
  const [confirmationError, setConfirmationError] = useState<string | undefined>();
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const passwordRef = useRef<any>(null);
  const confirmationRef = useRef<any>(null);
  const requestGate = useRef(createValidRequestGate()).current;
  const wasOpen = useRef(false);

  useEffect(() => {
    if (!open) {
      wasOpen.current = false;
      requestGate.reset();
      return;
    }
    if (wasOpen.current) return;
    wasOpen.current = true;
    setPasswordValue('');
    setConfirmation('');
    setPasswordError(undefined);
    setConfirmationError(undefined);
    setFormError(null);
    setBusy(false);
    setSaved(false);
  }, [open, requestGate]);

  const save = async () => {
    const nextPasswordError = validatePassword(password) ?? undefined;
    const nextConfirmationError = validatePasswordMatch(password, confirmation) ?? undefined;
    if (nextPasswordError || nextConfirmationError) {
      setPasswordError(nextPasswordError);
      setConfirmationError(nextConfirmationError);
      (nextPasswordError ? passwordRef : confirmationRef).current?.focus?.();
      return;
    }
    if (!requestGate.tryStart(true)) return;
    setBusy(true);
    setFormError(null);
    try {
      const result = await setPassword(password);
      if (result.ok) {
        setSaved(true);
        setPasswordValue('');
        setConfirmation('');
        return;
      }
      if (result.error.kind === 'weak-password' || result.error.kind === 'leaked-password') {
        setPasswordError(
          result.error.kind === 'leaked-password'
            ? REV9_AUTH_MESSAGES.leakedPassword
            : REV9_AUTH_MESSAGES.passwordTooShort,
        );
        passwordRef.current?.focus?.();
        return;
      }
      setFormError(result.error.message);
    } catch {
      setFormError(REV9_AUTH_MESSAGES.requestFailure);
    } finally {
      setBusy(false);
      requestGate.reset();
    }
  };

  if (!open) return null;

  return (
    <SignInContainer
      open
      title={saved ? 'Password saved' : 'Set or change password'}
      description={
        saved
          ? 'You can now sign in with your email or with Google. It’s the same Alethical account.'
          : 'Use a password with this email as another way to sign in. It keeps the same Alethical account.'
      }
      icon={
        <View style={[styles.passwordTile, saved && styles.passwordTileDone]}>
          <PasswordIcon
            color={saved ? t.colors.brand.forest : t.colors.text.primary}
            done={saved}
            size={26}
          />
        </View>
      }
      onClose={busy ? undefined : onClose}
    >
      {saved ? (
        <LoadingButton label="Done" busyLabel="Done" onPress={onClose} />
      ) : (
        <>
          {formError ? (
            <View style={styles.passwordFormError}>
              <FormError variant="banner" message={formError} />
            </View>
          ) : null}
          <View style={styles.passwordFields}>
            <PasswordField
              inputRef={passwordRef}
              label="NEW PASSWORD"
              value={password}
              helper={REV9_AUTH_MESSAGES.passwordTooShort}
              error={passwordError}
              disabled={busy}
              autoComplete="new-password"
              returnKeyType="next"
              onChangeText={(value) => {
                setPasswordValue(value);
                setPasswordError(undefined);
                setFormError(null);
              }}
              onSubmitEditing={() => confirmationRef.current?.focus?.()}
            />
            <PasswordField
              inputRef={confirmationRef}
              label="CONFIRM PASSWORD"
              value={confirmation}
              error={confirmationError}
              disabled={busy}
              autoComplete="new-password"
              onChangeText={(value) => {
                setConfirmation(value);
                setConfirmationError(undefined);
                setFormError(null);
              }}
              onSubmitEditing={() => void save()}
            />
          </View>
          <View style={styles.passwordActions}>
            <LoadingButton
              label="Save password"
              busyLabel="Saving…"
              busy={busy}
              disabled={!password || !confirmation}
              onPress={save}
            />
            <QuietButton label="Cancel" disabled={busy} onPress={onClose} />
          </View>
        </>
      )}
    </SignInContainer>
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
  const [passwordOpen, setPasswordOpen] = useState(false);
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
    <>
      <View ref={wrapRef} style={styles.navWrap}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Account panel for ${name}`}
          aria-expanded={open}
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
          <View
            {...({ role: 'region', 'aria-label': 'Account' } as object)}
            style={styles.menuPanel}
          >
            <View style={styles.menuHeader}>
              <Identity name={name} email={user?.email ?? ''} avatar={38} />
            </View>
            <View style={styles.menuDivider} />
            {emailPasswordEnabled ? (
              <Pressable
                accessibilityRole="button"
                onPress={() => {
                  setOpen(false);
                  setPasswordOpen(true);
                }}
                style={({ pressed }) => [styles.menuItem, pressed && styles.menuItemPressed]}
              >
                <PasswordIcon color={t.colors.text.faint} />
                <Text style={styles.menuItemText}>Set or change password</Text>
              </Pressable>
            ) : null}
            {emailPasswordEnabled ? (
              <Pressable
                accessibilityRole="button"
                onPress={() => {
                  setOpen(false);
                  void signOut();
                }}
                style={({ pressed }) => [styles.menuItem, pressed && styles.menuItemPressed]}
              >
                <SignOutIcon color={t.colors.text.faint} />
                <Text style={styles.menuItemText}>Sign out</Text>
              </Pressable>
            ) : null}
          </View>
        ) : null}
      </View>
      <SetPasswordDialog open={passwordOpen} onClose={() => setPasswordOpen(false)} />
    </>
  );
}

/** Phone top bar: a 44x44 avatar target that opens the account sheet. */
export function AccountAvatarButton() {
  const { user, signOut } = useAuth();
  const [open, setOpen] = useState(false);
  const [passwordOpen, setPasswordOpen] = useState(false);
  const name = displayName(user?.name, user?.email);

  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Account menu"
        aria-haspopup="dialog"
        aria-expanded={open}
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
          <View
            {...(isWeb ? ({ role: 'dialog', 'aria-label': 'Account' } as object) : null)}
            style={styles.sheet}
            accessibilityViewIsModal
            accessibilityLabel="Account"
          >
            <View style={styles.grabHandle} />
            <Identity name={name} email={user?.email ?? ''} avatar={48} />
            <Pressable
              accessibilityRole="button"
              onPress={() => {
                setOpen(false);
                setPasswordOpen(true);
              }}
              style={({ pressed }) => [styles.sheetButton, pressed && styles.sheetButtonPressed]}
            >
              <PasswordIcon color={t.colors.text.primary} />
              <Text style={styles.sheetButtonText}>Set or change password</Text>
            </Pressable>
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
      <SetPasswordDialog open={passwordOpen} onClose={() => setPasswordOpen(false)} />
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

const focusRingWeb = isWeb
  ? ({
      outlineColor: '#7c5cff',
      outlineOffset: 2,
      outlineStyle: 'solid',
      outlineWidth: 2,
    } as object)
  : null;

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
    color: t.colors.brand.display,
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
  passwordTile: {
    width: 52,
    height: 52,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: t.colors.surfaces.s400,
    borderWidth: 1,
    borderColor: t.colors.alpha.ink08,
    borderRadius: 14,
  },
  passwordTileDone: {
    backgroundColor: t.colors.tint.t150,
    borderColor: t.colors.tint.border,
  },
  passwordFormError: { marginBottom: 18 },
  passwordFields: { gap: 18 },
  passwordActions: { marginTop: 20, gap: 12 },
  quietButton: {
    width: '100%',
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
    paddingHorizontal: 10,
  },
  quietButtonPressed: { backgroundColor: t.colors.surfaces.s300 },
  quietButtonDisabled: { opacity: 0.5 },
  quietButtonText: {
    fontFamily: t.typography.ui,
    fontSize: 14.5,
    lineHeight: 20,
    fontWeight: t.fontWeights.semibold,
    color: '#6f756f',
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
