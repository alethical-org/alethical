import { useNavigation } from '@react-navigation/native';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
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
import { trackedBillsCount } from '../../lib/trackedState';
import { useReducedMotion } from '../../hooks/useReducedMotion';
import { useResponsive } from '../../hooks/useResponsive';
import { useTrackedBills } from '../../hooks/useAppQueries';
import { linkProps, routePath } from '../../navigation/links';
import { navigateTopNavItem } from '../../navigation/topNavRoutes';
import { fieldFocusRing, fieldOutlineReset, useFieldFocus } from '../../theme/fieldFocus';
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
// built account actions; the drawer footer stays compact and opens the phone sheet.

const isWeb = Platform.OS === 'web';
const emailPasswordEnabled = process.env.EXPO_PUBLIC_EMAIL_PASSWORD_SIGN_IN_ENABLED === 'true';
const SIGN_OUT_FAILURE = 'We couldn’t sign you out. Check your connection and try again.';
const OTHER_DEVICE_NOTE = 'You may still be signed in on other devices';

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
  const { accessToken, setPassword, user } = useAuth();
  const [password, setPasswordValue] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [passwordError, setPasswordError] = useState<string | undefined>();
  const [confirmationError, setConfirmationError] = useState<string | undefined>();
  const [formError, setFormError] = useState<string | null>(null);
  const [freshProofCode, setFreshProofCode] = useState('');
  const [freshProofMessage, setFreshProofMessage] = useState<string | null>(null);
  const [freshProofRequested, setFreshProofRequested] = useState(false);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [uncertainMessage, setUncertainMessage] = useState<string | null>(null);
  const { focused: freshProofFocused, focusProps: freshProofFocusProps } = useFieldFocus();
  const { isMobile } = useResponsive();
  const currentCopy = useMemo(
    () => passwordMethodCopy(user?.signInMethods ?? null, user?.email ?? 'your email'),
    [user?.email, user?.signInMethods?.google, user?.signInMethods?.password],
  );
  const [flowCopy, setFlowCopy] = useState<PasswordMethodCopy>(currentCopy);
  const passwordRef = useRef<any>(null);
  const confirmationRef = useRef<any>(null);
  const freshProofRef = useRef<any>(null);
  const passwordActionsRef = useRef<any>(null);
  const requestGate = useRef(createValidRequestGate()).current;
  const wasOpen = useRef(false);
  const openingAccessToken = useRef<string | null>(null);

  const revealPasswordActions = useCallback(() => {
    if (!isWeb || !isMobile) return;
    const actions = passwordActionsRef.current as HTMLElement | null;
    actions?.scrollIntoView?.({ block: 'end', inline: 'nearest' });
    let parent = actions?.parentElement ?? null;
    while (parent) {
      if (parent.scrollHeight > parent.clientHeight) {
        parent.scrollTop = parent.scrollHeight;
        return;
      }
      parent = parent.parentElement;
    }
  }, [isMobile]);

  useEffect(() => {
    if (!open) {
      wasOpen.current = false;
      openingAccessToken.current = null;
      requestGate.reset();
      setPasswordValue('');
      setConfirmation('');
      setPasswordError(undefined);
      setConfirmationError(undefined);
      setFormError(null);
      setFreshProofCode('');
      setFreshProofMessage(null);
      setFreshProofRequested(false);
      return;
    }
    if (wasOpen.current) return;
    wasOpen.current = true;
    openingAccessToken.current = accessToken;
    setPasswordValue('');
    setConfirmation('');
    setPasswordError(undefined);
    setConfirmationError(undefined);
    setFormError(null);
    setFreshProofCode('');
    setFreshProofMessage(null);
    setFreshProofRequested(false);
    setBusy(false);
    setSaved(false);
    setUncertainMessage(null);
    setFlowCopy(currentCopy);
  }, [accessToken, currentCopy, open, requestGate]);

  useEffect(() => {
    if (!open || !freshProofRequested || busy) return;
    freshProofRef.current?.focus?.();
  }, [busy, freshProofRequested, open]);

  useEffect(() => {
    if (!open || !isWeb || !isMobile || typeof window === 'undefined') return;
    const viewport = window.visualViewport;
    if (!viewport) return;
    let previousHeight = viewport.height;
    const revealAfterKeyboardOpens = () => {
      const nextHeight = viewport.height;
      if (
        nextHeight < previousHeight &&
        typeof document !== 'undefined' &&
        document.activeElement === confirmationRef.current
      ) {
        revealPasswordActions();
      }
      previousHeight = nextHeight;
    };
    viewport.addEventListener('resize', revealAfterKeyboardOpens);
    return () => viewport.removeEventListener('resize', revealAfterKeyboardOpens);
  }, [isMobile, open, revealPasswordActions]);

  const save = async () => {
    const nextPasswordError = validatePassword(password) ?? undefined;
    const nextConfirmationError = validatePasswordMatch(password, confirmation) ?? undefined;
    if (nextPasswordError || nextConfirmationError) {
      setPasswordError(nextPasswordError);
      setConfirmationError(nextConfirmationError);
      (nextPasswordError ? passwordRef : confirmationRef).current?.focus?.();
      return;
    }
    const proofCode = freshProofCode.trim();
    if (freshProofRequested && !proofCode) {
      freshProofRef.current?.focus?.();
      return;
    }
    if (!requestGate.tryStart(true)) return;
    setBusy(true);
    setFormError(null);
    try {
      const result = await setPassword(
        password,
        proofCode || undefined,
        openingAccessToken.current ?? undefined,
      );
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
      if (result.error.kind === 'fresh-proof') {
        setFreshProofRequested(true);
        setFreshProofMessage(result.error.message);
        return;
      }
      if (result.error.kind === 'weak-password' || result.error.kind === 'password-too-long') {
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
              onFocus={revealPasswordActions}
              onChangeText={(value) => {
                setConfirmation(value);
                setConfirmationError(undefined);
                setFormError(null);
              }}
              onSubmitEditing={() => void save()}
            />
            {freshProofRequested ? (
              <View style={styles.freshProofField}>
                <Text nativeID="fresh-proof-code-label" style={styles.freshProofLabel}>
                  CODE
                </Text>
                {freshProofMessage ? (
                  <Text nativeID="fresh-proof-code-help" style={styles.freshProofMessage}>
                    {freshProofMessage}
                  </Text>
                ) : null}
                <TextInput
                  ref={freshProofRef}
                  nativeID="fresh-proof-code"
                  accessibilityLabel="CODE"
                  aria-describedby={freshProofMessage ? 'fresh-proof-code-help' : undefined}
                  aria-labelledby="fresh-proof-code-label"
                  autoCapitalize="none"
                  autoComplete="one-time-code"
                  autoCorrect={false}
                  editable={!busy}
                  inputMode="numeric"
                  keyboardType="number-pad"
                  returnKeyType="done"
                  spellCheck={false}
                  value={freshProofCode}
                  onChangeText={(value) => {
                    setFreshProofCode(value);
                    setFormError(null);
                  }}
                  onSubmitEditing={() => void save()}
                  {...freshProofFocusProps}
                  style={[
                    styles.freshProofInput,
                    fieldOutlineReset,
                    ...fieldFocusRing(freshProofFocused),
                  ]}
                />
              </View>
            ) : null}
          </View>
          <View ref={passwordActionsRef} style={styles.passwordActions}>
            <LoadingButton
              label="Save password"
              busyLabel="Saving…"
              busy={busy}
              disabled={
                !password || !confirmation || (freshProofRequested && !freshProofCode.trim())
              }
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

/** The watchlist row's glyph, drawn like the Track button's bookmark. */
function BookmarkIcon({ size }: { size: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
      <Path
        d="M7 4h10a1 1 0 0 1 1 1v15l-6-4-6 4V5a1 1 0 0 1 1-1Z"
        stroke={t.colors.brand.graphics}
        strokeWidth={2}
        strokeLinejoin="round"
      />
    </Svg>
  );
}

/**
 * How many bills this reader tracks, or `null` when there is no number we may
 * print. TWO cases return null and the row renders identically for both — the
 * label with no number:
 *
 *   nothing tracked   -> null. NEVER a printed 0.
 *   list not arrived  -> null. No dash, no spinner, no skeleton.
 *
 * The second case is the honesty one, and it is the same rule the Track button
 * follows for the same list (lib/trackedState.ts): a count we did not get is not
 * a count we may state about a reader's own things. A failed request lands here
 * too — `data` stays undefined — so a blip shows the label alone rather than
 * telling someone they track nothing.
 *
 * There is no count endpoint. This is the length of the watchlist itself, which
 * the server returns whole and unpaginated (`/me/tracked-bills`), and every
 * Track button on the page already shares this one query — so on a page that has
 * loaded it the number costs nothing, and elsewhere it arrives just after the
 * menu opens.
 */
function useTrackedBillsCount(): number | null {
  const { user } = useAuth();
  const tracked = useTrackedBills(user?.id);
  // The rule itself lives beside the Track button's, and is pinned by its tests.
  return trackedBillsCount(tracked.data?.length);
}

function TrackedBillsRow({
  variant,
  onNavigate,
}: {
  variant: 'desktop' | 'phone';
  onNavigate: () => void;
}) {
  const navigation = useNavigation<never>();
  const count = useTrackedBillsCount();
  const phone = variant === 'phone';
  const press = () => {
    onNavigate();
    // Tracked is a tab nested inside the root Tabs screen, so it goes through the
    // shared nav route map rather than a bare navigate() that would do nothing.
    navigateTopNavItem(navigation, { id: 'track-bills' });
  };
  return (
    <Pressable
      {...linkProps(routePath.tracked(), press)}
      // The number is part of the spoken name, so a screen reader hears "Tracked
      // Bills, 12". With no number the visible text is the name -- an aria-label
      // REPLACES that text, so setting one here would be strictly worse.
      accessibilityLabel={count === null ? undefined : `Tracked Bills, ${count}`}
      style={({ pressed }) => [
        phone ? styles.sheetTrackedRow : styles.menuTrackedRow,
        pressed && (phone ? styles.sheetButtonPressed : styles.menuItemPressed),
      ]}
    >
      <BookmarkIcon size={phone ? 22 : 20} />
      <Text style={phone ? styles.sheetTrackedLabel : styles.menuTrackedLabel}>Tracked Bills</Text>
      {count === null ? null : (
        <Text style={phone ? styles.sheetTrackedCount : styles.menuTrackedCount}>{count}</Text>
      )}
    </Pressable>
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
  onLeave,
}: {
  variant: 'desktop' | 'phone';
  name: string;
  email: string;
  signInMethods: Parameters<typeof passwordMethodCopy>[0];
  signOutFlow: ReturnType<typeof useAccountSignOut>;
  onPasswordPress: () => void;
  /** Shut the panel or sheet before navigating away from it. */
  onLeave: () => void;
}) {
  const passwordCopy = passwordMethodCopy(signInMethods, email || 'your email');

  if (variant === 'desktop') {
    return (
      <>
        <View style={styles.menuHeader}>
          <Identity name={name} email={email} avatar={38} />
        </View>
        <View style={styles.menuDivider} />
        {/* The reader's own things sit above the one setting behind this menu
            (#1698). There is deliberately no Account row: Change password IS the
            action, so a row called Account would be a hop revealing one row. */}
        <TrackedBillsRow variant="desktop" onNavigate={onLeave} />
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
      <TrackedBillsRow variant="phone" onNavigate={onLeave} />
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
              onLeave={() => setOpen(false)}
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
              onLeave={() => setOpen(false)}
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
  // The watchlist row. Same padding as the rows around it, with the 44px floor
  // stated rather than left to add up (nav build prompt, 20 Aug 2026).
  menuTrackedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    minHeight: 44,
    paddingTop: 13,
    paddingRight: 15,
    paddingBottom: 13,
    paddingLeft: 12,
  },
  menuTrackedLabel: {
    flex: 1,
    minWidth: 0,
    fontFamily: t.typography.ui,
    fontSize: t.fontSizes.lg,
    fontWeight: t.fontWeights.bold,
    color: t.colors.text.primary,
  },
  menuTrackedCount: {
    fontFamily: t.typography.mono,
    fontSize: t.fontSizes.small,
    fontWeight: t.fontWeights.bold,
    color: t.colors.text.secondary,
  },
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
  freshProofField: { width: '100%' },
  freshProofLabel: {
    marginBottom: 8,
    fontFamily: t.typography.mono,
    fontSize: t.fontSizes.caption,
    lineHeight: 16,
    fontWeight: t.fontWeights.bold,
    letterSpacing: 1.32,
    color: t.colors.text.secondary,
  },
  freshProofMessage: {
    marginBottom: 10,
    fontFamily: t.typography.body,
    fontSize: t.fontSizes.small,
    lineHeight: 20,
    color: t.colors.text.secondary,
  },
  freshProofInput: {
    width: '100%',
    minHeight: 52,
    borderWidth: 1,
    borderColor: 'rgba(17,21,15,0.18)',
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 16,
    backgroundColor: t.colors.surfaces.base,
    fontFamily: t.typography.body,
    fontSize: 17,
    lineHeight: 22,
    color: t.colors.text.primary,
  },
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
    paddingTop: 0,
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
    height: 66,
    marginBottom: 10,
    alignItems: 'center',
    justifyContent: 'flex-start',
    paddingTop: 12,
  },
  sheetClose: {
    position: 'absolute',
    top: 22,
    right: 0,
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
  // The phone watchlist row, above Change password. It carries the line ABOVE
  // it; the line between the two is Change password's own top border.
  sheetTrackedRow: {
    marginTop: 18,
    width: '100%',
    minHeight: 56,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: t.colors.surfaces.base,
    borderTopWidth: 1,
    borderColor: t.colors.alpha.ink08,
    paddingHorizontal: 2,
  },
  sheetTrackedLabel: {
    flex: 1,
    minWidth: 0,
    fontFamily: t.typography.ui,
    fontSize: t.fontSizes.subheadLg,
    fontWeight: t.fontWeights.bold,
    color: t.colors.text.primary,
  },
  sheetTrackedCount: {
    fontFamily: t.typography.mono,
    fontSize: t.fontSizes.body,
    fontWeight: t.fontWeights.bold,
    color: t.colors.text.secondary,
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
