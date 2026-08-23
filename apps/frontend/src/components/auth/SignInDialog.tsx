import { ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import { Linking, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';

import { useResponsive } from '../../hooks/useResponsive';
import {
  REV9_AUTH_MESSAGES,
  createValidRequestGate,
  normalizeEmail,
  validateEmail,
  validatePassword,
  validatePasswordMatch,
} from '../../lib/auth/rev9Auth';
import { signInCopy, type SignInErrorKind } from '../../lib/signIn';
import { externalLinkProps, routePath } from '../../navigation/links';
import { GoogleButton } from '../../theme/primitives';
import { theme as t } from '../../theme/tokens';
import { ContactMailText } from './ContactMailText';
import { AccountCard } from './AccountCard';
import { CodeField } from './CodeField';
import { EmailField } from './EmailField';
import { FormError } from './FormError';
import { LoadingButton } from './LoadingButton';
import { PasswordField } from './PasswordField';
import { ResendControl, ResendStatus } from './ResendControl';
import { SignInContainer, accountPanelDescriptionTextStyle } from './SignInContainer';

const isWeb = Platform.OS === 'web';
const TERMS_URL = 'https://www.alethical.com/terms';
const PRIVACY_URL = 'https://www.alethical.com/privacy';
const NEWEST_CODE = 'Enter the newest code';

export type SignInDialogScreen =
  | 'sign-in'
  | 'email-sign-in'
  | 'create'
  | 'recover'
  | 'code'
  | 'choose-password'
  | 'uncertain-save'
  | 'different-account';

export interface SignInDialogActionError {
  kind: string;
  message: string;
}

export type SignInDialogActionResult = { ok: true } | { ok: false; error: SignInDialogActionError };

export interface AccountCodeVerifiedData {
  email: string;
  googleStillWorks: boolean;
}

export interface OpenAccountSummary {
  id: string;
  name: string;
  email: string;
}

export interface AccountCodePasswordOutcome {
  passwordStatus: 'saved' | 'already-set' | 'unknown';
  relationship: 'none' | 'same' | 'different';
  requiresAccountChoice: boolean;
  openAccount?: OpenAccountSummary;
}

export type AccountCodePasswordActionResult =
  | { ok: true; data: AccountCodePasswordOutcome }
  | {
      ok: false;
      error: SignInDialogActionError;
      canRetryPassword: boolean;
      passwordStatus: 'not-started' | 'saved' | 'already-set' | 'unknown';
    };

export interface SignInDialogProps {
  open: boolean;
  intent: 'nav' | 'track';
  billCode?: string;
  initialScreen?: SignInDialogScreen;
  initialEmail?: string;
  errorMessage?: string | null;
  errorKind?: SignInErrorKind | null;
  busyAction?:
    | 'google'
    | 'sign-in'
    | 'request-code'
    | 'verify-code'
    | 'save-password'
    | 'finish-code'
    | 'switch-account'
    | null;
  emailPasswordEnabled: boolean;
  /** The launch value recorded from Supabase. The 60-second drawing was not a specification. */
  resendWaitSeconds: number;
  ordinaryAccountOpen?: boolean;
  onClose: () => void;
  onGoogle: () => Promise<void>;
  onPasswordSignIn: (email: string, password: string) => Promise<SignInDialogActionResult>;
  onRequestAccountCode: (
    email: string,
    purpose: 'create' | 'recover',
  ) => Promise<SignInDialogActionResult>;
  onVerifyAccountCode: (
    code: string,
  ) => Promise<
    { ok: true; data: AccountCodeVerifiedData } | { ok: false; error: SignInDialogActionError }
  >;
  onSaveAccountCodePassword: (password: string) => Promise<AccountCodePasswordActionResult>;
  onRetryAccountCodeFinish: () => Promise<AccountCodePasswordActionResult>;
  onKeepCurrentAccount: () => Promise<void>;
  onSwitchAccount: () => Promise<SignInDialogActionResult>;
  onCancelAccountCode: (nextScreen: SignInDialogScreen) => Promise<void>;
  onBackFromOutcome?: () => void;
}

type FieldErrors = { email?: string; code?: string; password?: string; confirmation?: string };
type AccountOrigin = 'choices' | 'email' | 'direct';

function IntentIcon({
  icon,
  size,
}: {
  icon: 'brand' | 'bell' | 'mail' | 'lock' | 'shield';
  size: number;
}) {
  const glyph = size === 44 ? (icon === 'bell' ? 18 : 21) : Math.round(size * 0.5);
  const ink = t.colors.text.primary;
  return (
    <View
      style={[
        styles.iconTile,
        { width: size, height: size, borderRadius: size === 56 ? 15 : size === 44 ? 12 : 14 },
      ]}
    >
      <Svg width={glyph} height={glyph} viewBox="0 0 24 24" fill="none" aria-hidden>
        {icon === 'brand' ? (
          <>
            <Path d="M3 21 L11 4 L11 21 Z" fill={ink} />
            <Path d="M21 21 L13 4 L13 21 Z" fill={ink} />
          </>
        ) : null}
        {icon === 'bell' ? (
          <>
            <Path
              d="M18 8 a6 6 0 0 0-12 0 c0 7-3 9-3 9 h18 s-3-2-3-9"
              stroke={ink}
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <Path d="M10.5 21 a1.8 1.8 0 0 0 3 0" stroke={ink} strokeWidth={2} />
          </>
        ) : null}
        {icon === 'mail' ? (
          <>
            <Path d="M3.5 6.5 H20.5 V18.5 H3.5 Z" stroke={ink} strokeWidth={2} />
            <Path d="M4.5 8 L12 13.5 L19.5 8" stroke={ink} strokeWidth={2} />
          </>
        ) : null}
        {icon === 'lock' ? (
          <>
            <Path d="M6 10 H18 V21 H6 Z" stroke={ink} strokeWidth={2} />
            <Path d="M8.5 10 V7.5 A3.5 3.5 0 0 1 15.5 7.5 V10" stroke={ink} strokeWidth={2} />
          </>
        ) : null}
        {icon === 'shield' ? (
          <Path
            d="M12 3 L20 6 V11 C20 16 16.8 19.4 12 21 C7.2 19.4 4 16 4 11 V6 Z"
            stroke={ink}
            strokeWidth={2}
            strokeLinejoin="round"
          />
        ) : null}
      </Svg>
    </View>
  );
}

function Divider() {
  return (
    <View style={styles.divider}>
      <View style={styles.dividerLine} />
      <Text style={styles.dividerText}>or</Text>
      <View style={styles.dividerLine} />
    </View>
  );
}

function LegalLink({ label, path, url }: { label: string; path: string; url: string }) {
  return (
    <Text
      {...externalLinkProps(isWeb ? path : url, () => {
        void Linking.openURL(url);
      })}
      style={styles.legalLink}
    >
      {label}
    </Text>
  );
}

function LegalCopy({ compact = false }: { compact?: boolean }) {
  return (
    <Text style={[styles.legal, compact && styles.legalCompact]}>
      By continuing you agree to our{' '}
      <LegalLink label="Terms of Use" path={routePath.terms()} url={TERMS_URL} /> and{' '}
      <LegalLink label="Privacy Policy" path={routePath.privacy()} url={PRIVACY_URL} />
    </Text>
  );
}

function TextAction({
  label,
  onPress,
  disabled = false,
  inline = false,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  inline?: boolean;
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
        styles.textAction,
        inline && styles.textActionInline,
        focused && focusRingWeb,
        pressed && styles.textActionPressed,
        disabled && styles.textActionDisabled,
      ]}
    >
      <Text style={styles.textActionText}>{label}</Text>
    </Pressable>
  );
}

function EmailChoiceButton({ disabled, onPress }: { disabled: boolean; onPress: () => void }) {
  const [focused, setFocused] = useState(false);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Sign in with email"
      disabled={disabled}
      onBlur={() => setFocused(false)}
      onFocus={() => setFocused(true)}
      onPress={onPress}
      style={({ pressed }) => [
        styles.emailChoice,
        focused && focusRingWeb,
        pressed && styles.emailChoicePressed,
        disabled && styles.emailChoiceDisabled,
      ]}
    >
      <Svg width={19} height={19} viewBox="0 0 24 24" fill="none" aria-hidden>
        <Path d="M2.6 5 H21.4 V19 H2.6 Z" stroke={t.colors.text.muted} strokeWidth={1.9} />
        <Path
          d="M3.4 6.4 L12 13 L20.6 6.4"
          stroke={t.colors.text.muted}
          strokeWidth={1.9}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </Svg>
      <Text style={styles.emailChoiceText}>Sign in with email</Text>
    </Pressable>
  );
}

function GoogleHelp({ create = false }: { create?: boolean }) {
  if (create) {
    return <Text style={styles.googleHelp}>Already use Google with this email?</Text>;
  }

  return (
    <Text style={styles.googleHelp}>If you first used Google and haven’t added a password</Text>
  );
}

export function SignInDialog({
  open,
  intent,
  billCode,
  initialScreen = 'sign-in',
  initialEmail = '',
  errorMessage = null,
  errorKind = null,
  busyAction = null,
  emailPasswordEnabled,
  resendWaitSeconds,
  ordinaryAccountOpen = false,
  onClose,
  onGoogle,
  onPasswordSignIn,
  onRequestAccountCode,
  onVerifyAccountCode,
  onSaveAccountCodePassword,
  onRetryAccountCodeFinish,
  onKeepCurrentAccount,
  onSwitchAccount,
  onCancelAccountCode,
  onBackFromOutcome,
}: SignInDialogProps) {
  const { isMobile } = useResponsive();
  const openingScreen = emailPasswordEnabled ? initialScreen : 'sign-in';
  const openingOrigin: AccountOrigin =
    initialScreen === 'create' || initialScreen === 'recover' ? 'direct' : 'choices';
  const [screen, setScreen] = useState<SignInDialogScreen>(openingScreen);
  const [email, setEmail] = useState(initialEmail);
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [codePurpose, setCodePurpose] = useState<'create' | 'recover'>('create');
  const [accountOrigin, setAccountOrigin] = useState<AccountOrigin>(openingOrigin);
  const [googleStillWorks, setGoogleStillWorks] = useState(false);
  const [openAccount, setOpenAccount] = useState<OpenAccountSummary | null>(null);
  const [finishNeedsRetry, setFinishNeedsRetry] = useState(false);
  const [resendStatus, setResendStatus] = useState<ResendStatus>('ready');
  const [resendSeconds, setResendSeconds] = useState(0);
  const wasOpen = useRef(false);
  const openGeneration = useRef(0);
  const requestGate = useRef(createValidRequestGate()).current;
  const emailRef = useRef<any>(null);
  const codeRef = useRef<any>(null);
  const passwordRef = useRef<any>(null);
  const confirmationRef = useRef<any>(null);
  const emailSignInActionsRef = useRef<any>(null);
  const passwordActionsRef = useRef<any>(null);
  const anyBusy = busyAction !== null;

  const revealActions = useCallback(
    (actions: HTMLElement | null) => {
      if (!isWeb || !isMobile) return;
      actions?.scrollIntoView?.({ block: 'end', inline: 'nearest' });
    },
    [isMobile],
  );
  const revealPasswordActions = useCallback(
    () => revealActions(passwordActionsRef.current as HTMLElement | null),
    [revealActions],
  );
  const revealEmailSignInActions = useCallback(
    () => revealActions(emailSignInActionsRef.current as HTMLElement | null),
    [revealActions],
  );

  const resetDialog = useCallback(
    (nextEmail: string) => {
      setScreen(openingScreen);
      setEmail(nextEmail);
      setCode('');
      setPassword('');
      setConfirmation('');
      setFieldErrors({});
      setFormError(null);
      setCodePurpose('create');
      setAccountOrigin(openingOrigin);
      setGoogleStillWorks(false);
      setOpenAccount(null);
      setFinishNeedsRetry(false);
      setResendStatus('ready');
      setResendSeconds(0);
    },
    [openingOrigin, openingScreen],
  );

  useEffect(() => {
    if (!open) {
      if (wasOpen.current) openGeneration.current += 1;
      wasOpen.current = false;
      requestGate.reset();
      resetDialog('');
      return;
    }
    if (wasOpen.current) return;
    wasOpen.current = true;
    openGeneration.current += 1;
    resetDialog(initialEmail);
  }, [initialEmail, open, requestGate, resetDialog]);

  useEffect(() => {
    if (resendStatus !== 'waiting' && resendStatus !== 'rate-limited') return;
    const timer = setInterval(() => {
      setResendSeconds((seconds) => {
        if (seconds > 1) return seconds - 1;
        setResendStatus('ready');
        return 0;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [resendStatus]);

  useEffect(() => {
    if (anyBusy || formError !== REV9_AUTH_MESSAGES.badCredentials || password) return;
    passwordRef.current?.focus?.();
  }, [anyBusy, formError, password]);

  useEffect(() => {
    if (
      !open ||
      (screen !== 'choose-password' && screen !== 'email-sign-in') ||
      !isWeb ||
      !isMobile
    )
      return;
    const viewport = window.visualViewport;
    if (!viewport) return;
    let previousHeight = viewport.height;
    const revealAfterKeyboardOpens = () => {
      const nextHeight = viewport.height;
      if (nextHeight < previousHeight) {
        if (screen === 'choose-password' && document.activeElement === confirmationRef.current) {
          revealPasswordActions();
        }
        if (screen === 'email-sign-in' && document.activeElement === passwordRef.current) {
          revealEmailSignInActions();
        }
      }
      previousHeight = nextHeight;
    };
    viewport.addEventListener('resize', revealAfterKeyboardOpens);
    return () => viewport.removeEventListener('resize', revealAfterKeyboardOpens);
  }, [isMobile, open, revealEmailSignInActions, revealPasswordActions, screen]);

  const clearMessages = () => {
    setFieldErrors({});
    setFormError(null);
  };

  const moveTo = (next: SignInDialogScreen, clearEmail = false, nextOrigin?: AccountOrigin) => {
    setScreen(next);
    if (nextOrigin) setAccountOrigin(nextOrigin);
    if (clearEmail) setEmail('');
    setCode('');
    setPassword('');
    setConfirmation('');
    setOpenAccount(null);
    setFinishNeedsRetry(false);
    clearMessages();
    setResendStatus('ready');
    setResendSeconds(0);
  };

  const validateEmailAfterBlur = () => {
    const error = validateEmail(email);
    setFieldErrors((errors) => ({ ...errors, email: error ?? undefined }));
  };

  const isCurrentOpen = (generation: number) => openGeneration.current === generation;

  const resetCurrentRequest = (generation: number) => {
    if (isCurrentOpen(generation)) requestGate.reset();
  };

  const closeDialog = () => {
    openGeneration.current += 1;
    requestGate.reset();
    resetDialog('');
    onClose();
  };

  const cancelCodeAndMoveTo = (next: SignInDialogScreen, clearEmail = false) => {
    const generation = openGeneration.current;
    void onCancelAccountCode(next).finally(() => {
      if (isCurrentOpen(generation)) moveTo(next, clearEmail);
    });
  };

  const showResultError = (error: SignInDialogActionError) => {
    if (error.kind === 'invalid-email') {
      setFieldErrors({ email: REV9_AUTH_MESSAGES.invalidEmail });
      emailRef.current?.focus?.();
      return;
    }
    if (error.kind === 'weak-password' || error.kind === 'password-too-long') {
      setFieldErrors({ password: error.message });
      passwordRef.current?.focus?.();
      return;
    }
    if (error.kind === 'wrong-or-expired-code') {
      setFieldErrors({ code: error.message });
      codeRef.current?.focus?.();
      return;
    }
    setFormError(error.message);
    if (error.kind === 'bad-credentials') {
      const input = passwordRef.current;
      input?.focus?.();
      if (typeof input?.select === 'function') input.select();
      else input?.setNativeProps?.({ selection: { start: 0, end: password.length } });
    }
  };

  const finishResend = (sent = true) => {
    const seconds = Math.max(0, Math.ceil(resendWaitSeconds));
    setResendSeconds(seconds);
    setResendStatus(seconds > 0 ? (sent ? 'waiting' : 'rate-limited') : sent ? 'sent' : 'ready');
  };

  const submitGoogle = async () => {
    if (!requestGate.tryStart(true)) return;
    const generation = openGeneration.current;
    clearMessages();
    try {
      await onGoogle();
      if (!isCurrentOpen(generation)) return;
    } catch {
      if (!isCurrentOpen(generation)) return;
      setFormError(REV9_AUTH_MESSAGES.requestFailure);
    } finally {
      resetCurrentRequest(generation);
    }
  };

  const submitSignIn = async () => {
    const emailError = validateEmail(email);
    const passwordMissing = password.length === 0;
    if (emailError || passwordMissing) {
      setFieldErrors({ email: emailError ?? undefined });
      setFormError(passwordMissing ? REV9_AUTH_MESSAGES.badCredentials : null);
      (emailError ? emailRef : passwordRef).current?.focus?.();
      return;
    }
    if (!requestGate.tryStart(true)) return;
    const generation = openGeneration.current;
    clearMessages();
    const safeEmail = normalizeEmail(email);
    try {
      const result = await onPasswordSignIn(safeEmail, password);
      if (!isCurrentOpen(generation)) return;
      if (result.ok) return;
      if (result.error.kind === 'email-not-confirmed') {
        setEmail(safeEmail);
        const requested = await onRequestAccountCode(safeEmail, 'create');
        if (!isCurrentOpen(generation)) return;
        if (requested.ok) {
          setCodePurpose('create');
          moveTo('code', false, 'email');
          finishResend();
        } else {
          showResultError(requested.error);
        }
        return;
      }
      showResultError(result.error);
    } catch {
      if (!isCurrentOpen(generation)) return;
      setFormError(REV9_AUTH_MESSAGES.requestFailure);
    } finally {
      resetCurrentRequest(generation);
    }
  };

  const submitCodeRequest = async (purpose: 'create' | 'recover', repeat = false) => {
    const emailError = validateEmail(email);
    if (emailError) {
      setFieldErrors({ email: emailError });
      emailRef.current?.focus?.();
      return;
    }
    if (!requestGate.tryStart(true)) return;
    const generation = openGeneration.current;
    clearMessages();
    const safeEmail = normalizeEmail(email);
    try {
      const result = await onRequestAccountCode(safeEmail, purpose);
      if (!isCurrentOpen(generation)) return;
      if (result.ok) {
        setEmail(safeEmail);
        setCodePurpose(purpose);
        if (repeat) {
          setCode('');
          codeRef.current?.focus?.();
        } else moveTo('code');
        finishResend();
        return;
      }
      if (result.error.kind === 'too-many-attempts') {
        finishResend(false);
        if (repeat) codeRef.current?.focus?.();
      }
      showResultError(
        result.error.kind === 'bad-credentials'
          ? {
              kind: 'request-failure',
              message: 'We couldn’t request a code. Check your connection and try again.',
            }
          : result.error,
      );
    } catch {
      if (!isCurrentOpen(generation)) return;
      setFormError(REV9_AUTH_MESSAGES.requestFailure);
    } finally {
      resetCurrentRequest(generation);
    }
  };

  const submitCode = async () => {
    if (!code.trim()) {
      setFieldErrors({ code: 'Enter your code' });
      codeRef.current?.focus?.();
      return;
    }
    if (!requestGate.tryStart(true)) return;
    const generation = openGeneration.current;
    clearMessages();
    try {
      const result = await onVerifyAccountCode(code.trim());
      if (!isCurrentOpen(generation)) return;
      if (result.ok) {
        setEmail(result.data.email);
        setGoogleStillWorks(result.data.googleStillWorks);
        moveTo('choose-password');
        return;
      }
      showResultError(result.error);
    } catch {
      if (!isCurrentOpen(generation)) return;
      setFormError(REV9_AUTH_MESSAGES.requestFailure);
    } finally {
      resetCurrentRequest(generation);
    }
  };

  const finishPasswordOutcome = (outcome: AccountCodePasswordOutcome) => {
    setPassword('');
    setConfirmation('');
    setOpenAccount(outcome.openAccount ?? null);
    setFinishNeedsRetry(false);
    if (outcome.passwordStatus === 'unknown') {
      setScreen('uncertain-save');
    } else if (outcome.requiresAccountChoice) {
      setScreen('different-account');
    }
  };

  const submitCodePassword = async () => {
    const passwordError = validatePassword(password);
    const confirmationError = validatePasswordMatch(password, confirmation);
    if (passwordError || confirmationError) {
      setFieldErrors({
        password: passwordError ?? undefined,
        confirmation: confirmationError ?? undefined,
      });
      (passwordError ? passwordRef : confirmationRef).current?.focus?.();
      return;
    }
    if (!requestGate.tryStart(true)) return;
    const generation = openGeneration.current;
    clearMessages();
    try {
      const result = await onSaveAccountCodePassword(password);
      if (!isCurrentOpen(generation)) return;
      if (result.ok) {
        finishPasswordOutcome(result.data);
      } else if (result.canRetryPassword) {
        showResultError(result.error);
      } else {
        setPassword('');
        setConfirmation('');
        setFinishNeedsRetry(true);
        setFormError(result.error.message);
        setScreen('uncertain-save');
      }
    } catch {
      if (!isCurrentOpen(generation)) return;
      setPassword('');
      setConfirmation('');
      setFinishNeedsRetry(true);
      setFormError(REV9_AUTH_MESSAGES.requestFailure);
      setScreen('uncertain-save');
    } finally {
      resetCurrentRequest(generation);
    }
  };

  const retryCodeFinish = async () => {
    if (!requestGate.tryStart(true)) return;
    const generation = openGeneration.current;
    setFormError(null);
    try {
      const result = await onRetryAccountCodeFinish();
      if (!isCurrentOpen(generation)) return;
      if (result.ok) finishPasswordOutcome(result.data);
      else {
        setFinishNeedsRetry(true);
        setFormError(result.error.message);
      }
    } finally {
      resetCurrentRequest(generation);
    }
  };

  const switchCodeAccount = async () => {
    const generation = openGeneration.current;
    setFormError(null);
    try {
      const result = await onSwitchAccount();
      if (!isCurrentOpen(generation)) return;
      if (!result.ok) setFormError(result.error.message);
    } catch {
      if (!isCurrentOpen(generation)) return;
      setFormError(REV9_AUTH_MESSAGES.requestFailure);
    }
  };

  const signInIntent = signInCopy(intent, billCode);
  const trackObject = billCode || 'this bill';
  const trackDescription = `Save ${trackObject} to your tracked bills and check where it stands whenever you come back`;
  let title: string;
  let description: ReactNode = undefined;
  let bodyIcon: 'lock' | 'shield' | null = null;

  // The deactivated state is the one reachable stop state (the match-failure
  // screen was removed in rev 15 as verified unreachable, #1533).
  const dedicatedOutcome = errorKind === 'deactivated';

  if (dedicatedOutcome) {
    title = 'This account has been deactivated';
    description = (
      <ContactMailText text={errorMessage ?? ''} style={accountPanelDescriptionTextStyle} />
    );
    bodyIcon = 'shield';
  } else if (screen === 'sign-in') {
    title = signInIntent.headline;
    description = signInIntent.subcopy;
  } else if (screen === 'email-sign-in') {
    title = 'Sign in with email';
  } else if (screen === 'create') {
    title =
      intent === 'track' ? 'Create an account to track this bill' : 'Create your Alethical account';
    description =
      intent === 'track'
        ? accountOrigin === 'direct'
          ? signInIntent.subcopy
          : trackDescription
        : 'Bills you track are saved to your account';
  } else if (screen === 'recover') {
    title = 'Recover your account';
    description =
      intent === 'track' && accountOrigin === 'direct'
        ? signInIntent.subcopy
        : 'Enter your email to choose a new password. If no account exists, this creates one.';
  } else if (screen === 'code') {
    title = 'Enter your code';
    description = `For ${email}`;
  } else if (screen === 'choose-password') {
    title = 'Choose a password';
    description = `For ${email}`;
  } else if (screen === 'uncertain-save') {
    title = finishNeedsRetry
      ? 'We couldn’t finish signing you in'
      : 'We couldn’t confirm the password was saved';
    description = `For ${email}`;
    bodyIcon = 'lock';
  } else {
    title = 'Account ready';
    description = openAccount
      ? `${email} is ready. You’re still signed in as ${openAccount.email}`
      : `${email} is ready`;
    bodyIcon = 'shield';
  }

  let backAction: { label: string; onPress: () => void; disabled?: boolean } | undefined;
  if (dedicatedOutcome) {
    backAction = {
      label: 'Back to sign-in choices',
      disabled: anyBusy,
      onPress: () => {
        const generation = openGeneration.current;
        void onCancelAccountCode('sign-in').finally(() => {
          if (isCurrentOpen(generation)) {
            moveTo('sign-in', false, 'choices');
            onBackFromOutcome?.();
          }
        });
      },
    };
  } else if (screen === 'email-sign-in') {
    backAction = {
      label: 'Back to sign-in choices',
      disabled: anyBusy,
      onPress: () => moveTo('sign-in', false, 'choices'),
    };
  } else if ((screen === 'create' || screen === 'recover') && accountOrigin !== 'direct') {
    const target = accountOrigin === 'email' ? 'email-sign-in' : 'sign-in';
    backAction = {
      label:
        accountOrigin === 'email' ? 'Back to signing in with email' : 'Back to sign-in choices',
      disabled: anyBusy,
      onPress: () => cancelCodeAndMoveTo(target),
    };
  } else if (screen === 'code') {
    backAction = {
      label:
        codePurpose === 'create'
          ? 'Back to creating your account'
          : 'Back to recovering your account',
      disabled: anyBusy,
      onPress: () => cancelCodeAndMoveTo(codePurpose),
    };
  } else if (screen === 'choose-password') {
    backAction = {
      label:
        codePurpose === 'create'
          ? 'Cancel and go back to creating your account'
          : 'Cancel and go back to recovering your account',
      disabled: anyBusy,
      onPress: () => cancelCodeAndMoveTo(codePurpose),
    };
  }

  const showsIntentHeader =
    screen === 'sign-in' ||
    ((screen === 'create' || screen === 'recover') && accountOrigin === 'direct');
  const headerIcon: 'brand' | 'bell' | null = backAction
    ? null
    : showsIntentHeader && intent === 'track'
      ? 'bell'
      : 'brand';
  const shownError = dedicatedOutcome ? formError : (errorMessage ?? formError);
  const googleBusy = busyAction === 'google';
  const resendBusy = screen === 'code' && busyAction === 'request-code';
  const shownResendStatus: ResendStatus = resendBusy ? 'sending' : resendStatus;

  const serverError = shownError ? (
    <View style={styles.bannerWrap}>
      <FormError variant="banner" message={shownError} />
    </View>
  ) : null;

  const googleButton = (
    <GoogleButton
      onPress={() => void submitGoogle()}
      label="Continue with Google"
      busy={googleBusy}
      disabled={anyBusy && !googleBusy}
      busyLabel="Continuing with Google…"
      size="compact"
    />
  );
  const googleChoice = (
    <>
      {googleButton}
      {emailPasswordEnabled ? <Divider /> : null}
    </>
  );

  let content;
  if (dedicatedOutcome) {
    content = serverError;
  } else if (screen === 'sign-in') {
    content = (
      <>
        {serverError}
        {emailPasswordEnabled ? (
          <>
            <View style={styles.openingPrimaryChoices}>
              {googleButton}
              <EmailChoiceButton
                disabled={anyBusy}
                onPress={() => moveTo('email-sign-in', false, 'email')}
              />
            </View>
            <View style={styles.openingSeparator} />
            <View style={[styles.switchRow, styles.openingCreateRow]}>
              <Text style={styles.switchText}>New to Alethical?</Text>
              <TextAction
                label="Create an account"
                inline
                disabled={anyBusy}
                onPress={() => moveTo('create', false, 'choices')}
              />
            </View>
            <View style={styles.openingForgotRow}>
              <TextAction
                label="Forgot password?"
                inline
                disabled={anyBusy}
                onPress={() => moveTo('recover', false, 'choices')}
              />
            </View>
          </>
        ) : (
          googleButton
        )}
        <LegalCopy compact />
      </>
    );
  } else if (screen === 'email-sign-in') {
    content = (
      <>
        {serverError}
        {shownError === REV9_AUTH_MESSAGES.badCredentials ? <GoogleHelp /> : null}
        <View style={styles.emailFields}>
          <EmailField
            compact
            inputRef={emailRef}
            value={email}
            error={fieldErrors.email}
            disabled={anyBusy}
            onBlur={validateEmailAfterBlur}
            onChangeText={setEmail}
            onSubmitEditing={() => passwordRef.current?.focus?.()}
          />
          <PasswordField
            compact
            inputRef={passwordRef}
            value={password}
            error={fieldErrors.password}
            disabled={anyBusy}
            autoComplete="current-password"
            labelAccessory={
              <TextAction
                label="Forgot password?"
                inline
                disabled={anyBusy}
                onPress={() => moveTo('recover', false, 'email')}
              />
            }
            onFocus={revealEmailSignInActions}
            onChangeText={(value) => {
              setPassword(value);
              setFieldErrors((errors) => ({ ...errors, password: undefined }));
            }}
            onSubmitEditing={() => void submitSignIn()}
          />
        </View>
        <View style={styles.emailSignInActions}>
          <View ref={emailSignInActionsRef}>
            <LoadingButton
              label="Sign in"
              busyLabel="Signing in…"
              busy={busyAction === 'sign-in'}
              disabled={!email.trim() || !password || (anyBusy && busyAction !== 'sign-in')}
              onPress={submitSignIn}
              style={styles.accountPrimaryButton}
            />
          </View>
          <View style={[styles.switchRow, styles.emailSwitchRow]}>
            <Text style={styles.switchText}>New to Alethical?</Text>
            <TextAction
              label="Create an account"
              inline
              disabled={anyBusy}
              onPress={() => moveTo('create', false, 'email')}
            />
          </View>
          <LegalCopy compact />
        </View>
      </>
    );
  } else if (screen === 'create') {
    content = (
      <>
        {serverError}
        {!ordinaryAccountOpen ? <GoogleHelp create /> : null}
        {!ordinaryAccountOpen ? googleChoice : null}
        <EmailField
          compact
          inputRef={emailRef}
          value={email}
          error={fieldErrors.email}
          disabled={anyBusy}
          returnKeyType="go"
          onBlur={validateEmailAfterBlur}
          onChangeText={setEmail}
          onSubmitEditing={() => void submitCodeRequest('create')}
        />
        <View style={styles.actionStack}>
          <LoadingButton
            label="Continue"
            busyLabel="Continuing…"
            busy={busyAction === 'request-code'}
            disabled={!email.trim() || (anyBusy && busyAction !== 'request-code')}
            onPress={() => submitCodeRequest('create')}
            style={styles.accountPrimaryButton}
          />
        </View>
        {accountOrigin === 'direct' ? (
          <View style={styles.switchRow}>
            <Text style={styles.switchText}>Already have an account?</Text>
            <TextAction
              label="Sign in"
              inline
              disabled={anyBusy}
              onPress={() => cancelCodeAndMoveTo('sign-in')}
            />
          </View>
        ) : null}
        <LegalCopy />
      </>
    );
  } else if (screen === 'recover') {
    content = (
      <>
        {serverError}
        {!ordinaryAccountOpen ? googleChoice : null}
        <EmailField
          compact
          inputRef={emailRef}
          value={email}
          error={fieldErrors.email}
          disabled={anyBusy}
          returnKeyType="go"
          onBlur={validateEmailAfterBlur}
          onChangeText={setEmail}
          onSubmitEditing={() => void submitCodeRequest('recover')}
        />
        <View style={styles.actionStack}>
          <LoadingButton
            label="Continue"
            busyLabel="Continuing…"
            busy={busyAction === 'request-code'}
            disabled={!email.trim() || (anyBusy && busyAction !== 'request-code')}
            onPress={() => submitCodeRequest('recover')}
            style={styles.accountPrimaryButton}
          />
          {accountOrigin === 'direct' ? (
            <TextAction
              label="Back to sign in"
              disabled={anyBusy}
              onPress={() => cancelCodeAndMoveTo('sign-in')}
            />
          ) : null}
        </View>
      </>
    );
  } else if (screen === 'code') {
    content = (
      <>
        {serverError}
        <CodeField
          compact
          inputRef={codeRef}
          value={code}
          error={fieldErrors.code}
          disabled={anyBusy}
          onChangeText={(value) => {
            setCode(value);
            setFieldErrors((errors) => ({ ...errors, code: undefined }));
          }}
          onSubmitEditing={() => void submitCode()}
        />
        <View style={styles.actionStack}>
          <LoadingButton
            label="Continue"
            busyLabel="Checking…"
            busy={busyAction === 'verify-code'}
            disabled={!code.trim() || (anyBusy && busyAction !== 'verify-code')}
            onPress={submitCode}
            style={styles.accountPrimaryButton}
          />
          <ResendControl
            status={shownResendStatus}
            secondsRemaining={resendSeconds}
            sentMessage={NEWEST_CODE}
            actionLabel="Send a new code"
            sendingLabel="Requesting…"
            disabled={anyBusy && !resendBusy}
            onResend={() => submitCodeRequest(codePurpose, true)}
          />
          <TextAction
            label="Use another email"
            disabled={anyBusy}
            onPress={() => {
              const generation = openGeneration.current;
              void onCancelAccountCode(codePurpose).finally(() => {
                if (isCurrentOpen(generation)) moveTo(codePurpose, true);
              });
            }}
          />
          {!ordinaryAccountOpen ? googleButton : null}
          <ContactMailText
            text="No code? Check spam or contact us at ask@alethical.com."
            style={styles.helpText}
          />
        </View>
      </>
    );
  } else if (screen === 'choose-password') {
    content = (
      <>
        {serverError}
        <View style={styles.fields}>
          <PasswordField
            compact
            inputRef={passwordRef}
            label="PASSWORD"
            value={password}
            helper={REV9_AUTH_MESSAGES.passwordTooShort}
            error={fieldErrors.password}
            disabled={anyBusy}
            autoComplete="new-password"
            returnKeyType="next"
            onChangeText={(value) => {
              setPassword(value);
              setFieldErrors((errors) => ({ ...errors, password: undefined }));
            }}
            onSubmitEditing={() => confirmationRef.current?.focus?.()}
          />
          <PasswordField
            compact
            inputRef={confirmationRef}
            label="CONFIRM PASSWORD"
            value={confirmation}
            error={fieldErrors.confirmation}
            disabled={anyBusy}
            autoComplete="new-password"
            onFocus={revealPasswordActions}
            onChangeText={(value) => {
              setConfirmation(value);
              setFieldErrors((errors) => ({ ...errors, confirmation: undefined }));
            }}
            onSubmitEditing={() => void submitCodePassword()}
          />
        </View>
        {googleStillWorks ? <Text style={styles.helpText}>Google will still work</Text> : null}
        <View ref={passwordActionsRef} style={[styles.actionStack, styles.passwordActionStack]}>
          <LoadingButton
            label="Save password"
            busyLabel="Saving…"
            busy={busyAction === 'save-password'}
            disabled={!password || !confirmation || (anyBusy && busyAction !== 'save-password')}
            onPress={submitCodePassword}
            style={styles.accountPrimaryButton}
          />
        </View>
      </>
    );
  } else if (screen === 'uncertain-save') {
    const accountChoice = openAccount ? (
      <AccountCard
        label="This browser is still signed in as:"
        name={openAccount.name}
        email={openAccount.email}
      />
    ) : null;
    content = (
      <View style={styles.actionStackNoTop}>
        {serverError ?? (
          <FormError
            variant="banner"
            message="We couldn’t confirm whether the password was saved. Try it when you sign in. If it doesn’t work, recover your account."
          />
        )}
        {accountChoice}
        {finishNeedsRetry ? (
          <LoadingButton
            label="Continue"
            busyLabel="Finishing…"
            busy={busyAction === 'finish-code'}
            onPress={retryCodeFinish}
          />
        ) : openAccount ? (
          <>
            <LoadingButton
              label="Keep current account"
              busyLabel="Finishing…"
              busy={busyAction === 'finish-code'}
              disabled={anyBusy && busyAction !== 'finish-code'}
              onPress={() => void onKeepCurrentAccount()}
            />
            <LoadingButton
              tone="secondary"
              label="Switch account"
              busyLabel="Switching…"
              busy={busyAction === 'switch-account'}
              disabled={anyBusy && busyAction !== 'switch-account'}
              onPress={switchCodeAccount}
            />
          </>
        ) : (
          <LoadingButton
            label="Continue"
            busyLabel="Continuing…"
            busy={busyAction === 'finish-code'}
            disabled={anyBusy && busyAction !== 'finish-code'}
            onPress={() => void onKeepCurrentAccount()}
          />
        )}
      </View>
    );
  } else {
    content = (
      <View style={styles.actionStackNoTop}>
        {serverError}
        {openAccount ? (
          <AccountCard
            label="This browser is still signed in as:"
            name={openAccount.name}
            email={openAccount.email}
          />
        ) : null}
        <LoadingButton
          label="Keep current account"
          busyLabel="Finishing…"
          busy={busyAction === 'finish-code'}
          disabled={anyBusy && busyAction !== 'finish-code'}
          onPress={() => void onKeepCurrentAccount()}
        />
        <LoadingButton
          tone="secondary"
          label="Switch account"
          busyLabel="Switching…"
          busy={busyAction === 'switch-account'}
          disabled={anyBusy && busyAction !== 'switch-account'}
          onPress={switchCodeAccount}
        />
      </View>
    );
  }

  return (
    <SignInContainer
      open={open}
      focusKey={dedicatedOutcome ? 'deactivated' : `${screen}:${accountOrigin}:${codePurpose}`}
      accountPanel
      title={title}
      description={description}
      icon={bodyIcon ? <IntentIcon icon={bodyIcon} size={isMobile ? 56 : 52} /> : undefined}
      headerIcon={headerIcon ? <IntentIcon icon={headerIcon} size={44} /> : undefined}
      backAction={backAction}
      contentGap={screen === 'sign-in' ? 18 : screen === 'email-sign-in' ? 16 : undefined}
      onClose={closeDialog}
    >
      {content}
    </SignInContainer>
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
  iconTile: {
    backgroundColor: t.colors.surfaces.s400,
    borderWidth: 1,
    borderColor: 'rgba(17,21,15,0.08)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  bannerWrap: { marginBottom: 18 },
  openingPrimaryChoices: { gap: 12 },
  emailChoice: {
    width: '100%',
    minHeight: 54,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    paddingHorizontal: 18,
    borderRadius: 12,
    backgroundColor: t.colors.surfaces.s300,
  },
  emailChoicePressed: { backgroundColor: t.colors.surfaces.s400 },
  emailChoiceDisabled: { opacity: 0.5 },
  emailChoiceText: {
    fontFamily: t.typography.ui,
    fontSize: 16,
    lineHeight: 22,
    fontWeight: t.fontWeights.semibold,
    color: t.colors.text.primary,
  },
  openingSeparator: {
    height: 1,
    marginTop: 20,
    backgroundColor: t.colors.alpha.ink10,
  },
  openingCreateRow: { marginTop: 18 },
  openingForgotRow: {
    minHeight: 44,
    marginTop: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  divider: {
    marginVertical: 20,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  dividerLine: { flex: 1, height: 1, backgroundColor: t.colors.alpha.ink10 },
  dividerText: {
    fontFamily: t.typography.body,
    fontSize: t.fontSizes.meta,
    color: '#6f756f',
  },
  fields: { gap: 16 },
  emailFields: { gap: 16 },
  emailSignInActions: { marginTop: 16 },
  emailSwitchRow: { marginTop: 16 },
  accountPrimaryButton: { minHeight: 54 },
  googleHelp: {
    marginTop: t.spacing.sm,
    // Both help sentences sit directly above the Google button, so the gap
    // below belongs to the sentence itself rather than to one screen.
    marginBottom: t.spacing.md,
    fontFamily: t.typography.body,
    fontSize: 13.5,
    lineHeight: 20,
    color: t.colors.text.secondary,
  },
  actionStack: { marginTop: 20, gap: 12 },
  passwordActionStack: { marginTop: 16 },
  actionStackNoTop: { gap: 12 },
  googleSolo: { marginBottom: 12 },
  helpText: {
    fontFamily: t.typography.body,
    fontSize: t.fontSizes.small,
    lineHeight: 21,
    color: t.colors.text.muted,
  },
  textAction: {
    width: '100%',
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
    paddingHorizontal: 10,
  },
  textActionInline: { width: 'auto', paddingHorizontal: 5 },
  textActionPressed: { backgroundColor: t.colors.surfaces.s300 },
  textActionDisabled: { opacity: 0.5 },
  textActionText: {
    fontFamily: t.typography.ui,
    fontSize: 14.5,
    lineHeight: 20,
    fontWeight: t.fontWeights.semibold,
    color: t.colors.text.greenOnLight,
  },
  switchRow: {
    minHeight: 44,
    marginTop: 8,
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
  },
  switchText: {
    fontFamily: t.typography.body,
    fontSize: t.fontSizes.small,
    lineHeight: 20,
    color: t.colors.text.muted,
  },
  legal: {
    marginTop: 10,
    fontFamily: t.typography.body,
    fontSize: 12.5,
    lineHeight: 19,
    color: '#6f756f',
  },
  legalCompact: { marginTop: 12, textAlign: 'center' },
  legalLink: { color: t.colors.text.greenOnLight, fontWeight: t.fontWeights.semibold },
});
