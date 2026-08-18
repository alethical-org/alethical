import { ReactNode, useEffect, useRef, useState } from 'react';
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
import { EmailField } from './EmailField';
import { FormError } from './FormError';
import { LoadingButton } from './LoadingButton';
import { PasswordField } from './PasswordField';
import { ResendControl, ResendStatus } from './ResendControl';
import { SignInContainer, descriptionTextStyle } from './SignInContainer';

const isWeb = Platform.OS === 'web';
const TERMS_URL = 'https://www.alethical.com/terms';
const PRIVACY_URL = 'https://www.alethical.com/privacy';
// Arrival-neutral by rule: no screen claims a send happened — Supabase measurably
// reports success without sending for an already-confirmed address, and a claim
// the screen cannot see is barred (rev 17 sign-in bundle, #1533).
const CONFIRMATION_SENT = 'If a confirmation email arrives, open the newest one';
const RESET_SENT = 'If a reset email arrives, open the newest one';

export type SignInDialogScreen = 'sign-in' | 'create' | 'check-email' | 'forgot' | 'forgot-sent';

export interface SignInDialogActionError {
  kind: string;
  message: string;
}

export type SignInDialogActionResult = { ok: true } | { ok: false; error: SignInDialogActionError };

export interface SignInDialogProps {
  open: boolean;
  intent: 'nav' | 'track';
  billCode?: string;
  initialScreen?: SignInDialogScreen;
  initialEmail?: string;
  errorMessage?: string | null;
  errorKind?: SignInErrorKind | null;
  busyAction?: 'google' | 'sign-in' | 'create' | 'resend' | 'forgot' | null;
  emailPasswordEnabled: boolean;
  /** The launch value recorded from Supabase. The 60-second drawing was not a specification. */
  resendWaitSeconds: number;
  onClose: () => void;
  onGoogle: () => Promise<void>;
  onPasswordSignIn: (email: string, password: string) => Promise<SignInDialogActionResult>;
  onCreateAccount: (email: string, password: string) => Promise<SignInDialogActionResult>;
  onResendConfirmation: (email: string) => Promise<SignInDialogActionResult>;
  onForgotPassword: (email: string) => Promise<SignInDialogActionResult>;
  onBackFromOutcome?: () => void;
}

type FieldErrors = { email?: string; password?: string; confirmation?: string };
type CheckEmailMode = 'create' | 'unconfirmed';

function IntentIcon({
  icon,
  size,
}: {
  icon: 'brand' | 'bell' | 'mail' | 'lock' | 'shield';
  size: number;
}) {
  const glyph = Math.round(size * 0.5);
  const ink = t.colors.text.primary;
  return (
    <View
      style={[styles.iconTile, { width: size, height: size, borderRadius: size === 56 ? 15 : 14 }]}
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

function LegalCopy() {
  return (
    <Text style={styles.legal}>
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

function GoogleHelp({ create = false }: { create?: boolean }) {
  if (create) {
    return (
      <Text style={[styles.googleHelp, styles.googleHelpCreate]}>
        Already use Google with this email?
      </Text>
    );
  }

  return (
    <Text style={styles.googleHelp}>
      If you first used Google and haven’t added a password,{' '}
      <Text style={styles.googleHelpStrong}>continue with Google.</Text>
    </Text>
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
  onClose,
  onGoogle,
  onPasswordSignIn,
  onCreateAccount,
  onResendConfirmation,
  onForgotPassword,
  onBackFromOutcome,
}: SignInDialogProps) {
  const { isMobile } = useResponsive();
  const [screen, setScreen] = useState<SignInDialogScreen>(initialScreen);
  const [email, setEmail] = useState(initialEmail);
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [checkEmailMode, setCheckEmailMode] = useState<CheckEmailMode>('create');
  const [resendStatus, setResendStatus] = useState<ResendStatus>('ready');
  const [resendSeconds, setResendSeconds] = useState(0);
  const wasOpen = useRef(false);
  const requestGate = useRef(createValidRequestGate()).current;
  const emailRef = useRef<any>(null);
  const passwordRef = useRef<any>(null);
  const confirmationRef = useRef<any>(null);
  const anyBusy = busyAction !== null;

  useEffect(() => {
    if (!open) {
      wasOpen.current = false;
      requestGate.reset();
      setEmail('');
      setPassword('');
      setConfirmation('');
      setFieldErrors({});
      setFormError(null);
      return;
    }
    if (wasOpen.current) return;
    wasOpen.current = true;
    setScreen(emailPasswordEnabled ? initialScreen : 'sign-in');
    setEmail(initialEmail);
    setPassword('');
    setConfirmation('');
    setFieldErrors({});
    setFormError(null);
    setCheckEmailMode('create');
    setResendStatus('ready');
    setResendSeconds(0);
  }, [emailPasswordEnabled, initialEmail, initialScreen, open, requestGate]);

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

  const clearMessages = () => {
    setFieldErrors({});
    setFormError(null);
  };

  const moveTo = (next: SignInDialogScreen, clearEmail = false) => {
    setScreen(next);
    if (clearEmail) setEmail('');
    setPassword('');
    setConfirmation('');
    clearMessages();
    setResendStatus('ready');
    setResendSeconds(0);
  };

  const showResultError = (error: SignInDialogActionError) => {
    if (error.kind === 'invalid-email') {
      setFieldErrors({ email: REV9_AUTH_MESSAGES.invalidEmail });
      emailRef.current?.focus?.();
      return;
    }
    if (error.kind === 'weak-password' || error.kind === 'leaked-password') {
      setFieldErrors({ password: error.message });
      passwordRef.current?.focus?.();
      return;
    }
    if (error.kind === 'bad-credentials') {
      setPassword('');
    }
    setFormError(error.message);
  };

  const finishResend = (sent = true) => {
    const seconds = Math.max(0, Math.ceil(resendWaitSeconds));
    setResendSeconds(seconds);
    setResendStatus(seconds > 0 ? (sent ? 'waiting' : 'rate-limited') : sent ? 'sent' : 'ready');
  };

  const submitGoogle = async () => {
    if (!requestGate.tryStart(true)) return;
    clearMessages();
    try {
      await onGoogle();
    } catch {
      setFormError(REV9_AUTH_MESSAGES.requestFailure);
    } finally {
      requestGate.reset();
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
    clearMessages();
    const safeEmail = normalizeEmail(email);
    try {
      const result = await onPasswordSignIn(safeEmail, password);
      if (result.ok) return;
      if (result.error.kind === 'email-not-confirmed') {
        setEmail(safeEmail);
        setCheckEmailMode('unconfirmed');
        moveTo('check-email');
        return;
      }
      showResultError(result.error);
    } catch {
      setFormError(REV9_AUTH_MESSAGES.requestFailure);
    } finally {
      requestGate.reset();
    }
  };

  const submitCreate = async () => {
    const emailError = validateEmail(email);
    const passwordError = validatePassword(password);
    const confirmationError = validatePasswordMatch(password, confirmation);
    if (emailError || passwordError || confirmationError) {
      setFieldErrors({
        email: emailError ?? undefined,
        password: passwordError ?? undefined,
        confirmation: confirmationError ?? undefined,
      });
      (emailError ? emailRef : passwordError ? passwordRef : confirmationRef).current?.focus?.();
      return;
    }
    if (!requestGate.tryStart(true)) return;
    clearMessages();
    const safeEmail = normalizeEmail(email);
    try {
      const result = await onCreateAccount(safeEmail, password);
      if (result.ok || result.error.kind === 'check-email') {
        setEmail(safeEmail);
        setCheckEmailMode('create');
        moveTo('check-email');
        return;
      }
      showResultError(result.error);
    } catch {
      setFormError(REV9_AUTH_MESSAGES.requestFailure);
    } finally {
      requestGate.reset();
    }
  };

  const submitForgot = async () => {
    const emailError = validateEmail(email);
    if (emailError) {
      setFieldErrors({ email: emailError });
      emailRef.current?.focus?.();
      return;
    }
    if (!requestGate.tryStart(true)) return;
    clearMessages();
    const safeEmail = normalizeEmail(email);
    try {
      const result = await onForgotPassword(safeEmail);
      if (result.ok) {
        setEmail(safeEmail);
        moveTo('forgot-sent');
        return;
      }
      showResultError(result.error);
    } catch {
      setFormError(REV9_AUTH_MESSAGES.requestFailure);
    } finally {
      requestGate.reset();
    }
  };

  const submitResend = async () => {
    if (!requestGate.tryStart(true)) return;
    clearMessages();
    try {
      const result =
        screen === 'forgot-sent'
          ? await onForgotPassword(normalizeEmail(email))
          : await onResendConfirmation(normalizeEmail(email));
      if (result.ok) finishResend();
      else {
        if (result.error.kind === 'too-many-attempts') finishResend(false);
        showResultError(result.error);
      }
    } catch {
      setFormError(REV9_AUTH_MESSAGES.requestFailure);
    } finally {
      requestGate.reset();
    }
  };

  const signInIntent = signInCopy(intent, billCode);
  const trackObject = billCode || 'this bill';
  const trackDescription = `Save ${trackObject} to your tracked bills and check where it stands whenever you come back`;
  let title: string;
  let description: ReactNode;
  let icon: 'brand' | 'bell' | 'mail' | 'lock' | 'shield';

  // The deactivated state is the one reachable stop state (the match-failure
  // screen was removed in rev 15 as verified unreachable, #1533).
  const dedicatedOutcome = errorKind === 'deactivated';

  if (dedicatedOutcome) {
    title = 'This account has been deactivated';
    description = <ContactMailText text={errorMessage ?? ''} style={descriptionTextStyle} />;
    icon = 'shield';
  } else if (screen === 'sign-in') {
    title = signInIntent.headline;
    description = intent === 'track' ? trackDescription : signInIntent.subcopy;
    icon = intent === 'track' ? 'bell' : 'brand';
  } else if (screen === 'create') {
    title =
      intent === 'track' ? 'Create an account to track this bill' : 'Create your Alethical account';
    description =
      intent === 'track' ? trackDescription : 'Bills you track are saved to your account';
    icon = intent === 'track' ? 'bell' : 'brand';
  } else if (screen === 'check-email') {
    title = checkEmailMode === 'unconfirmed' ? 'Confirm your email' : 'Check your email';
    // Every accepted create lands here — new address, taken address or
    // Google-first account, identical response and shape — so the copy names
    // no address and claims no send.
    description =
      checkEmailMode === 'unconfirmed'
        ? `Confirm ${email} before signing in`
        : 'If a confirmation email arrives, open the newest one. If none does, sign in — you may already have an account.';
    icon = 'mail';
  } else if (screen === 'forgot') {
    title = 'Reset your password';
    description =
      'Enter the email you use for Alethical and we’ll send password reset instructions';
    icon = 'lock';
  } else {
    title = 'Check your email';
    description = RESET_SENT;
    icon = 'mail';
  }
  const shownError = dedicatedOutcome ? formError : (errorMessage ?? formError);
  const googleBusy = busyAction === 'google';
  const resendBusy =
    busyAction === 'resend' || (screen === 'forgot-sent' && busyAction === 'forgot');
  const shownResendStatus: ResendStatus = resendBusy ? 'sending' : resendStatus;

  const serverError = shownError ? (
    <View style={styles.bannerWrap}>
      <FormError variant="banner" message={shownError} />
    </View>
  ) : null;

  const googleButton = (
    <GoogleButton
      onPress={anyBusy && !googleBusy ? undefined : () => void submitGoogle()}
      label="Continue with Google"
      busy={googleBusy}
      busyLabel="Continuing with Google…"
      size={isMobile ? 'lg' : 'md'}
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
    content = (
      <LoadingButton
        label="Back to sign in"
        busyLabel="Returning…"
        tone="quiet"
        onPress={() => onBackFromOutcome?.()}
      />
    );
  } else if (screen === 'sign-in') {
    content = (
      <>
        {serverError}
        {shownError === REV9_AUTH_MESSAGES.badCredentials ? <GoogleHelp /> : null}
        {googleChoice}
        {emailPasswordEnabled ? (
          <>
            <View style={styles.fields}>
              <EmailField
                inputRef={emailRef}
                value={email}
                error={fieldErrors.email}
                disabled={anyBusy}
                onChangeText={(value) => {
                  setEmail(value);
                  setFieldErrors((errors) => ({ ...errors, email: undefined }));
                }}
                onSubmitEditing={() => passwordRef.current?.focus?.()}
              />
              <PasswordField
                inputRef={passwordRef}
                value={password}
                error={fieldErrors.password}
                disabled={anyBusy}
                autoComplete="current-password"
                onChangeText={(value) => {
                  setPassword(value);
                  setFieldErrors((errors) => ({ ...errors, password: undefined }));
                }}
                onSubmitEditing={() => void submitSignIn()}
              />
            </View>
            <View style={styles.actionStack}>
              <LoadingButton
                label="Sign in"
                busyLabel="Signing in…"
                busy={busyAction === 'sign-in'}
                disabled={!email.trim() || !password || (anyBusy && busyAction !== 'sign-in')}
                onPress={submitSignIn}
              />
              <TextAction
                label="Forgot password?"
                disabled={anyBusy}
                onPress={() => moveTo('forgot')}
              />
            </View>
            <View style={styles.switchRow}>
              <Text style={styles.switchText}>New to Alethical?</Text>
              <TextAction
                label="Create an account"
                inline
                disabled={anyBusy}
                onPress={() => moveTo('create')}
              />
            </View>
          </>
        ) : null}
        <LegalCopy />
      </>
    );
  } else if (screen === 'create') {
    content = (
      <>
        {serverError}
        <GoogleHelp create />
        {googleChoice}
        <View style={styles.fields}>
          <EmailField
            inputRef={emailRef}
            value={email}
            error={fieldErrors.email}
            disabled={anyBusy}
            onChangeText={(value) => {
              setEmail(value);
              setFieldErrors((errors) => ({ ...errors, email: undefined }));
            }}
            onSubmitEditing={() => passwordRef.current?.focus?.()}
          />
          <PasswordField
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
            inputRef={confirmationRef}
            label="CONFIRM PASSWORD"
            value={confirmation}
            error={fieldErrors.confirmation}
            disabled={anyBusy}
            autoComplete="new-password"
            onChangeText={(value) => {
              setConfirmation(value);
              setFieldErrors((errors) => ({ ...errors, confirmation: undefined }));
            }}
            onSubmitEditing={() => void submitCreate()}
          />
        </View>
        <View style={styles.actionStack}>
          <LoadingButton
            label="Create account"
            busyLabel="Creating your account…"
            busy={busyAction === 'create'}
            disabled={
              !email.trim() || !password || !confirmation || (anyBusy && busyAction !== 'create')
            }
            onPress={submitCreate}
          />
        </View>
        <View style={styles.switchRow}>
          <Text style={styles.switchText}>Already have an account?</Text>
          <TextAction label="Sign in" inline disabled={anyBusy} onPress={() => moveTo('sign-in')} />
        </View>
        <LegalCopy />
      </>
    );
  } else if (screen === 'check-email') {
    // The Google button is on the card for the create outcome (rev 12): for a
    // taken address or a Google-first account every other control here is inert,
    // and the button reveals nothing because everyone sees it. The unconfirmed
    // outcome deliberately has no Google button — this screen already knows the
    // password is correct, and an unconfirmed email must never be invited to
    // claim an existing account through Google.
    const resendConfirmationControl = (
      <ResendControl
        status={shownResendStatus}
        secondsRemaining={resendSeconds}
        sentMessage={CONFIRMATION_SENT}
        actionLabel={
          checkEmailMode === 'unconfirmed' ? 'Resend confirmation email' : 'Resend email'
        }
        onResend={submitResend}
      />
    );
    const signInAfterEmailControl = (
      <LoadingButton
        label={checkEmailMode === 'unconfirmed' ? 'Sign in after confirming' : 'Sign in'}
        busyLabel="Opening sign in…"
        disabled={anyBusy}
        onPress={() => moveTo('sign-in')}
      />
    );
    content = (
      <>
        {serverError}
        {checkEmailMode === 'create' ? <View style={styles.googleSolo}>{googleButton}</View> : null}
        <View style={styles.actionStackNoTop}>
          {checkEmailMode === 'create' ? (
            <>
              {signInAfterEmailControl}
              {resendConfirmationControl}
            </>
          ) : (
            <>
              {resendConfirmationControl}
              {signInAfterEmailControl}
            </>
          )}
          <TextAction
            label="Change email"
            disabled={anyBusy}
            onPress={() => moveTo(checkEmailMode === 'create' ? 'create' : 'sign-in', true)}
          />
        </View>
      </>
    );
  } else if (screen === 'forgot') {
    // Rev 12: the Google button is on the card and the Google help sentence is
    // gone — the button is the sentence.
    content = (
      <>
        {serverError}
        {googleChoice}
        <EmailField
          inputRef={emailRef}
          value={email}
          error={fieldErrors.email}
          disabled={anyBusy}
          returnKeyType="go"
          onChangeText={(value) => {
            setEmail(value);
            setFieldErrors((errors) => ({ ...errors, email: undefined }));
          }}
          onSubmitEditing={() => void submitForgot()}
        />
        <View style={styles.actionStack}>
          <LoadingButton
            label="Send reset instructions"
            busyLabel="Sending…"
            busy={busyAction === 'forgot'}
            disabled={!email.trim() || (anyBusy && busyAction !== 'forgot')}
            onPress={submitForgot}
          />
          <TextAction
            label="Back to sign in"
            disabled={anyBusy}
            onPress={() => moveTo('sign-in')}
          />
        </View>
      </>
    );
  } else {
    content = (
      <>
        {serverError}
        <View style={styles.googleSolo}>{googleButton}</View>
        <View style={styles.actionStackNoTop}>
          <ResendControl
            status={shownResendStatus}
            secondsRemaining={resendSeconds}
            sentMessage={RESET_SENT}
            onResend={submitResend}
          />
          <TextAction
            label="Change email"
            disabled={anyBusy}
            onPress={() => moveTo('forgot', true)}
          />
          <TextAction
            label="Back to sign in"
            disabled={anyBusy}
            onPress={() => moveTo('sign-in')}
          />
        </View>
      </>
    );
  }

  return (
    <SignInContainer
      open={open}
      focusKey={dedicatedOutcome ? 'deactivated' : screen}
      title={title}
      description={description}
      icon={<IntentIcon icon={icon} size={isMobile ? 56 : 52} />}
      onClose={onClose}
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
  fields: { gap: 18 },
  googleHelp: {
    marginTop: t.spacing.sm,
    fontFamily: t.typography.body,
    fontSize: 13.5,
    lineHeight: 20,
    color: t.colors.text.secondary,
  },
  googleHelpCreate: { marginBottom: t.spacing.md },
  googleHelpStrong: { fontWeight: t.fontWeights.bold, color: t.colors.text.primary },
  actionStack: { marginTop: 20, gap: 12 },
  actionStackNoTop: { gap: 12 },
  googleSolo: { marginBottom: 12 },
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
  legalLink: { color: t.colors.text.greenOnLight, fontWeight: t.fontWeights.semibold },
});
