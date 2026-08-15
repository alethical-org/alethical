import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import Svg, { Path } from 'react-native-svg';

import {
  REV9_AUTH_MESSAGES,
  createValidRequestGate,
  validatePassword,
  validatePasswordMatch,
} from '../../lib/auth/rev9Auth';
import { passwordMethodCopy, type PasswordMethodCopy } from '../../lib/auth/passwordMethod';
import { clearSignedInAuthDrafts } from '../../lib/auth/signOutCleanup';
import { useReducedMotion } from '../../hooks/useReducedMotion';
import { theme as t } from '../../theme/tokens';
import { useAuth } from '../../providers/AuthProvider';
import { FormError } from './FormError';
import { LoadingButton } from './LoadingButton';
import { PasswordField } from './PasswordField';
import { SignInContainer } from './SignInContainer';

// What replaces the "Sign in" button once you're in
// (docs/product-onboarding/sign-in-guide.md). Three placements, one identity: a
// pill with a dropdown on desktop, an avatar opening a sheet on the phone top
// bar, and a row in the phone drawer's footer. The panel and sheet offer the
// built account actions; the drawer footer stays compact and keeps only Sign out.

const isWeb = Platform.OS === 'web';
const emailPasswordEnabled = process.env.EXPO_PUBLIC_EMAIL_PASSWORD_SIGN_IN_ENABLED === 'true';
const SIGN_OUT_FAILURE = 'We couldn’t sign you out. Check your connection and try again.';
const OTHER_DEVICE_NOTE = 'You may still be signed in on other devices.';

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

export function SetPasswordDialog({
  open,
  onClose,
  onDone = onClose,
}: {
  open: boolean;
  onClose: () => void;
  onDone?: () => void;
}) {
  const { setPassword, user } = useAuth();
  const [password, setPasswordValue] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [passwordError, setPasswordError] = useState<string | undefined>();
  const [confirmationError, setConfirmationError] = useState<string | undefined>();
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [uncertainMessage, setUncertainMessage] = useState<string | null>(null);
  const currentCopy = useMemo(
    () => passwordMethodCopy(user?.signInMethods ?? null, user?.email ?? 'your email'),
    [user?.email, user?.signInMethods?.google, user?.signInMethods?.password],
  );
  const [flowCopy, setFlowCopy] = useState<PasswordMethodCopy>(currentCopy);
  const passwordRef = useRef<any>(null);
  const confirmationRef = useRef<any>(null);
  const requestGate = useRef(createValidRequestGate()).current;
  const wasOpen = useRef(false);

  useEffect(() => {
    if (!open) {
      wasOpen.current = false;
      requestGate.reset();
      setPasswordValue('');
      setConfirmation('');
      setPasswordError(undefined);
      setConfirmationError(undefined);
      setFormError(null);
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
    setUncertainMessage(null);
    setFlowCopy(currentCopy);
  }, [currentCopy, open, requestGate]);

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
      // A lost reply may have saved the password server-side: clear the typed
      // password and never offer the save again — Done keeps the account
      // signed in (rev 17 REQUEST FAILURE carve-out, #1533).
      if (result.error.kind === 'uncertain-password-save') {
        setPasswordValue('');
        setConfirmation('');
        setPasswordError(undefined);
        setConfirmationError(undefined);
        setUncertainMessage(result.error.message);
        return;
      }
      if (
        result.error.kind === 'weak-password' ||
        result.error.kind === 'leaked-password' ||
        result.error.kind === 'same-password' ||
        result.error.kind === 'password-too-long'
      ) {
        setPasswordError(result.error.message);
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
      title={saved ? flowCopy.doneTitle : flowCopy.title}
      description={saved ? flowCopy.doneDescription : flowCopy.description}
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
        <LoadingButton label="Done" busyLabel="Done" onPress={onDone} />
      ) : uncertainMessage ? (
        <>
          <View style={styles.passwordFormError}>
            <FormError variant="banner" message={uncertainMessage} />
          </View>
          <LoadingButton label="Done" busyLabel="Done" onPress={onDone} />
        </>
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

function CloseIcon() {
  return (
    <Svg width={18} height={18} viewBox="0 0 24 24" fill="none" aria-hidden>
      <Path
        d="M6 6 L18 18 M18 6 L6 18"
        stroke={t.colors.text.faint}
        strokeWidth={2.2}
        strokeLinecap="round"
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

function ChevronRightIcon() {
  return (
    <Svg width={18} height={18} viewBox="0 0 24 24" fill="none" aria-hidden>
      <Path
        d="M9 5 L16 12 L9 19"
        stroke={t.colors.text.faint}
        strokeWidth={2}
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

type AccountSignOutState = 'idle' | 'busy' | 'failed';

function useAccountSignOut(onSuccess?: () => void) {
  const { signOut } = useAuth();
  const [state, setState] = useState<AccountSignOutState>('idle');
  const locked = useRef(false);

  const press = async () => {
    if (locked.current) return;
    locked.current = true;
    setState('busy');
    try {
      const result = await signOut();
      if (result.ok) {
        clearSignedInAuthDrafts();
        onSuccess?.();
        return;
      }
    } catch {
      // The one public failure below covers both provider and connection errors.
    }
    locked.current = false;
    setState('failed');
  };

  return {
    state,
    label: state === 'busy' ? 'Signing out…' : state === 'failed' ? 'Try again' : 'Sign out',
    press,
  };
}

function DesktopSignOut({ flow }: { flow: ReturnType<typeof useAccountSignOut> }) {
  const reduceMotion = useReducedMotion();
  return (
    <>
      {flow.state === 'failed' ? (
        <View style={styles.desktopSignOutError}>
          <FormError variant="banner" message={SIGN_OUT_FAILURE} />
        </View>
      ) : null}
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ busy: flow.state === 'busy', disabled: flow.state === 'busy' }}
        aria-busy={flow.state === 'busy' || undefined}
        aria-disabled={flow.state === 'busy' || undefined}
        onPress={() => void flow.press()}
        style={({ pressed }) => [styles.menuItem, pressed && styles.menuItemPressed]}
      >
        {flow.state === 'busy' && !reduceMotion ? (
          <ActivityIndicator size="small" color={t.colors.brand.forest} />
        ) : (
          <SignOutIcon color={t.colors.text.faint} />
        )}
        <Text style={styles.menuItemText}>{flow.label}</Text>
      </Pressable>
      <Text style={styles.desktopSignOutNote}>{OTHER_DEVICE_NOTE}</Text>
    </>
  );
}

function PhoneSignOut({ flow }: { flow: ReturnType<typeof useAccountSignOut> }) {
  const reduceMotion = useReducedMotion();
  return (
    <>
      {flow.state === 'failed' ? (
        <View style={styles.phoneSignOutError}>
          <FormError variant="banner" message={SIGN_OUT_FAILURE} />
        </View>
      ) : null}
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ busy: flow.state === 'busy', disabled: flow.state === 'busy' }}
        aria-busy={flow.state === 'busy' || undefined}
        aria-disabled={flow.state === 'busy' || undefined}
        onPress={() => void flow.press()}
        style={({ pressed }) => [styles.sheetButton, pressed && styles.sheetButtonPressed]}
      >
        {flow.state === 'busy' && !reduceMotion ? (
          <ActivityIndicator size="small" color={t.colors.brand.forest} />
        ) : (
          <SignOutIcon color={t.colors.text.primary} />
        )}
        <Text style={styles.sheetButtonText}>{flow.label}</Text>
      </Pressable>
      <Text style={styles.phoneSignOutNote}>{OTHER_DEVICE_NOTE}</Text>
    </>
  );
}

function AccountSurfaceContent({
  variant,
  name,
  email,
  signInMethods,
  signOutFlow,
  onPasswordPress,
}: {
  variant: 'desktop' | 'phone';
  name: string;
  email: string;
  signInMethods: Parameters<typeof passwordMethodCopy>[0];
  signOutFlow: ReturnType<typeof useAccountSignOut>;
  onPasswordPress: () => void;
}) {
  const passwordCopy = passwordMethodCopy(signInMethods, email || 'your email');

  if (variant === 'desktop') {
    return (
      <>
        <View style={styles.menuHeader}>
          <Identity name={name} email={email} avatar={38} />
        </View>
        <View style={styles.menuDivider} />
        {emailPasswordEnabled ? (
          <>
            <Pressable
              accessibilityRole="button"
              onPress={onPasswordPress}
              style={({ pressed }) => [styles.menuItem, pressed && styles.menuItemPressed]}
            >
              <PasswordIcon color={t.colors.text.faint} />
              <Text style={styles.menuItemText}>{passwordCopy.rowLabel}</Text>
            </Pressable>
            <View style={styles.menuDivider} />
          </>
        ) : null}
        <DesktopSignOut flow={signOutFlow} />
      </>
    );
  }

  return (
    <>
      <Identity name={name} email={email} avatar={48} />
      {emailPasswordEnabled ? (
        <Pressable
          accessibilityRole="button"
          onPress={onPasswordPress}
          style={({ pressed }) => [
            styles.sheetPasswordButton,
            pressed && styles.sheetButtonPressed,
          ]}
        >
          <PasswordIcon color={t.colors.text.primary} />
          <Text style={[styles.sheetButtonText, styles.sheetPasswordText]}>
            {passwordCopy.rowLabel}
          </Text>
          <ChevronRightIcon />
        </Pressable>
      ) : null}
      <PhoneSignOut flow={signOutFlow} />
    </>
  );
}

/** Desktop top nav: avatar + first name + chevron, opening a right-aligned menu. */
export function AccountNavButton() {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [passwordOpen, setPasswordOpen] = useState(false);
  const wrapRef = useRef<View>(null);
  const signOutFlow = useAccountSignOut();

  // Any click outside the button + panel closes the menu, matching how the nav's
  // own dropdowns behave (a full-screen overlay would swallow the panel's rows).
  useEffect(() => {
    if (!isWeb || !open) return;
    const handlePointerDown = (event: Event) => {
      const node = wrapRef.current as unknown as HTMLElement | null;
      const target = event.target as Node | null;
      if (node && target && node.contains(target)) return;
      if (signOutFlow.state === 'busy') return;
      setOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && signOutFlow.state !== 'busy') setOpen(false);
    };
    document.addEventListener('pointerdown', handlePointerDown, true);
    document.addEventListener('keydown', handleKeyDown, true);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown, true);
      document.removeEventListener('keydown', handleKeyDown, true);
    };
  }, [open, signOutFlow.state]);

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
            <AccountSurfaceContent
              variant="desktop"
              name={name}
              email={user?.email ?? ''}
              signInMethods={user?.signInMethods ?? null}
              signOutFlow={signOutFlow}
              onPasswordPress={() => {
                setOpen(false);
                setPasswordOpen(true);
              }}
            />
          </View>
        ) : null}
      </View>
      <SetPasswordDialog
        open={passwordOpen}
        onClose={() => setPasswordOpen(false)}
        onDone={() => {
          setPasswordOpen(false);
          setOpen(true);
        }}
      />
    </>
  );
}

function PhoneAccountControl({ trigger }: { trigger: 'avatar' | 'drawer' }) {
  const reduceMotion = useReducedMotion();
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [closeFocused, setCloseFocused] = useState(false);
  const avatarRef = useRef<View>(null);
  const name = displayName(user?.name, user?.email);
  const signOutFlow = useAccountSignOut();

  // The sheet always closes three ways — the Close button, the scrim, Escape —
  // and focus returns to the control that opened it (rev 15/17, #1533).
  const closeSheet = () => {
    if (signOutFlow.state === 'busy') return;
    setOpen(false);
    if (isWeb) (avatarRef.current as unknown as HTMLElement | null)?.focus?.();
  };

  // RN-Web's Modal does not close on Escape by itself (verified in-browser),
  // so the sheet listens for it directly while open.
  useEffect(() => {
    if (!isWeb || !open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || signOutFlow.state === 'busy') return;
      setOpen(false);
      (avatarRef.current as unknown as HTMLElement | null)?.focus?.();
    };
    document.addEventListener('keydown', onKeyDown, true);
    return () => document.removeEventListener('keydown', onKeyDown, true);
  }, [open, signOutFlow.state]);

  return (
    <>
      <Pressable
        ref={avatarRef}
        accessibilityRole="button"
        accessibilityLabel={trigger === 'avatar' ? 'Account menu' : `Account for ${name}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        onPress={() => setOpen(true)}
        style={({ pressed }) => [
          trigger === 'avatar' ? styles.avatarButton : styles.drawerAccountButton,
          trigger === 'drawer' && pressed && styles.drawerAccountButtonPressed,
        ]}
      >
        {trigger === 'avatar' ? (
          <Avatar label={name} size={34} />
        ) : (
          <Identity name={name} email={user?.email ?? ''} avatar={44} />
        )}
      </Pressable>
      <Modal
        visible={open}
        transparent
        animationType={reduceMotion ? 'none' : 'slide'}
        onRequestClose={closeSheet}
      >
        <View style={styles.sheetScrim}>
          <Pressable
            accessible={false}
            focusable={false}
            {...(isWeb ? ({ 'aria-hidden': true } as object) : null)}
            disabled={signOutFlow.state === 'busy'}
            onPress={closeSheet}
            style={StyleSheet.absoluteFill}
          />
          <View
            {...(isWeb ? ({ role: 'dialog', 'aria-label': 'Account' } as object) : null)}
            style={styles.sheet}
            accessibilityViewIsModal
            accessibilityLabel="Account"
          >
            <View style={styles.sheetHeader}>
              <View style={styles.grabHandle} />
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Close"
                disabled={signOutFlow.state === 'busy'}
                onBlur={() => setCloseFocused(false)}
                onFocus={() => setCloseFocused(true)}
                onPress={closeSheet}
                style={({ pressed }) => [
                  styles.sheetClose,
                  closeFocused && focusRingWeb,
                  pressed && styles.sheetButtonPressed,
                ]}
              >
                <CloseIcon />
              </Pressable>
            </View>
            <AccountSurfaceContent
              variant="phone"
              name={name}
              email={user?.email ?? ''}
              signInMethods={user?.signInMethods ?? null}
              signOutFlow={signOutFlow}
              onPasswordPress={() => {
                setOpen(false);
                setPasswordOpen(true);
              }}
            />
          </View>
        </View>
      </Modal>
      <SetPasswordDialog
        open={passwordOpen}
        onClose={() => setPasswordOpen(false)}
        onDone={() => {
          setPasswordOpen(false);
          setOpen(true);
        }}
      />
    </>
  );
}

/** Phone top bar: a 44x44 avatar target that opens the account sheet. */
export function AccountAvatarButton() {
  return <PhoneAccountControl trigger="avatar" />;
}

/** Phone drawer footer: a full-width account target opening the same account sheet. */
export function AccountDrawerRow() {
  return <PhoneAccountControl trigger="drawer" />;
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
  navWrap: { position: 'relative', zIndex: 40 },
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
    width: 288,
    zIndex: 1,
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
    paddingTop: 13,
    paddingRight: 15,
    paddingBottom: 13,
    paddingLeft: 12,
  },
  menuItemPressed: { backgroundColor: t.colors.surfaces.s300 },
  menuItemText: {
    fontFamily: t.typography.ui,
    fontSize: t.fontSizes.small,
    fontWeight: t.fontWeights.semibold,
    color: t.colors.text.primary,
  },
  desktopSignOutError: { marginTop: 12, marginHorizontal: 15 },
  desktopSignOutNote: {
    paddingTop: 2,
    paddingRight: 15,
    paddingBottom: 14,
    paddingLeft: 15,
    fontFamily: t.typography.body,
    fontSize: 12,
    lineHeight: 17,
    color: t.colors.text.faint,
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
  drawerAccountButton: {
    width: '100%',
    minHeight: 44,
    justifyContent: 'center',
    borderRadius: 10,
    paddingVertical: 4,
  },
  drawerAccountButtonPressed: { backgroundColor: t.colors.surfaces.s300 },
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
  },
  sheetHeader: {
    minHeight: 44,
    marginBottom: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sheetClose: {
    position: 'absolute',
    top: 0,
    right: -12,
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 10,
    backgroundColor: t.colors.surfaces.s300,
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
  sheetPasswordButton: {
    marginTop: 18,
    width: '100%',
    minHeight: 56,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: t.colors.surfaces.base,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: t.colors.alpha.ink08,
    paddingHorizontal: 2,
  },
  sheetPasswordText: { flex: 1, textAlign: 'left' },
  sheetButtonPressed: { backgroundColor: t.colors.surfaces.s300 },
  sheetButtonText: {
    fontFamily: t.typography.ui,
    fontSize: t.fontSizes.lg,
    fontWeight: t.fontWeights.semibold,
    color: t.colors.text.primary,
  },
  phoneSignOutError: { marginTop: 16 },
  phoneSignOutNote: {
    marginTop: 10,
    fontFamily: t.typography.body,
    fontSize: 13.5,
    lineHeight: 20,
    color: t.colors.text.faint,
  },
});
