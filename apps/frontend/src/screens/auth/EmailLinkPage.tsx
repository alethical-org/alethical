import { useEffect, useMemo, useRef, useState } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';
import { AuthClient, type Session } from '@supabase/auth-js';

import { AccountCard } from '../../components/auth/AccountCard';
import { ContactMailText } from '../../components/auth/ContactMailText';
import { EmailField } from '../../components/auth/EmailField';
import { FormError } from '../../components/auth/FormError';
import { LoadingButton } from '../../components/auth/LoadingButton';
import { PasswordField } from '../../components/auth/PasswordField';
import { ResendControl, type ResendStatus } from '../../components/auth/ResendControl';
import { SignInContainer, descriptionTextStyle } from '../../components/auth/SignInContainer';
import { ApiError, completePendingTrackActionFromApi } from '../../data/api';
import { createTemporaryAuthClient } from '../../lib/auth/linkSession';
import { validateAlethicalSession } from '../../lib/auth/operations';
import { finishResetSignOuts, updatePasswordOnce } from '../../lib/auth/resetCleanup';
import {
  REV9_AUTH_MESSAGES,
  emailLinkFailureScreen,
  isUncertainPasswordSave,
  mapProviderAuthError,
  uncertainPasswordSaveMessage,
  validateEmail,
  validatePassword,
  validatePasswordMatch,
} from '../../lib/auth/rev9Auth';
import { SIGN_IN_ERROR_MESSAGES } from '../../lib/signIn';
import { theme as t } from '../../theme/tokens';

declare global {
  interface Window {
    __alethicalEmailLink?: Readonly<{
      tokenHash: string | null;
      type: string | null;
      pendingReference: string | null;
    }>;
  }
}

type LinkKind = 'confirm' | 'reset';
type Screen =
  | 'gate'
  | 'checking'
  | 'link-fail'
  | 'dead'
  | 'dead-sent'
  | 'deactivated'
  | 'confirmed'
  | 'confirmed-other'
  | 'new-password'
  | 'uncertain-save'
  | 'finishing';

interface OrdinaryAccount {
  session: Session;
  id: string;
  name: string;
  email: string;
}

const OPEN_SIGN_IN_KEY = 'alethical.openSignIn';
const PASSWORD_NOTICE_KEY = 'alethical.passwordChangedNotice';
const configuredResendWait = Number(process.env.EXPO_PUBLIC_AUTH_RESEND_WAIT_SECONDS);
const RESEND_WAIT_SECONDS =
  Number.isFinite(configuredResendWait) && configuredResendWait > 0 ? configuredResendWait : 60;

function publicOrigin() {
  return Platform.OS === 'web' && typeof window !== 'undefined' ? window.location.origin : '';
}

function goToAlethical(openSignIn = false) {
  if (typeof window === 'undefined') return;
  if (openSignIn) {
    try {
      window.sessionStorage.setItem(OPEN_SIGN_IN_KEY, 'sign-in');
    } catch {
      // The destination still works when short-lived browser storage is unavailable.
    }
  }
  window.location.replace('/');
}

function goToForgotPassword() {
  if (typeof window === 'undefined') return;
  window.location.replace('/#auth_screen=forgot');
}

function publicSupabaseConfig() {
  return {
    url: process.env.EXPO_PUBLIC_SUPABASE_URL ?? '',
    key: process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? '',
  };
}

async function ordinaryClientAndAccount(): Promise<{
  client: InstanceType<typeof AuthClient>;
  account: OrdinaryAccount | null;
  clearStoredSession: () => void;
}> {
  const module = await import('../../lib/supabase.web');
  const current = await module.supabase.auth.getSession();
  const session = current.data.session;
  if (!session) {
    return {
      client: module.supabase.auth,
      account: null,
      clearStoredSession: module.clearStoredSupabaseSession,
    };
  }

  const metadataName = session.user.user_metadata?.full_name ?? session.user.user_metadata?.name;
  const email = session.user.email ?? '';
  return {
    client: module.supabase.auth,
    account: {
      session,
      id: session.user.id,
      name:
        typeof metadataName === 'string' && metadataName.trim()
          ? metadataName
          : email.split('@')[0] || 'Signed-in user',
      email,
    },
    clearStoredSession: module.clearStoredSupabaseSession,
  };
}

export function EmailLinkPage({ kind }: { kind: LinkKind }) {
  const memory = typeof window !== 'undefined' ? window.__alethicalEmailLink : undefined;
  const [screen, setScreen] = useState<Screen>('gate');
  const [error, setError] = useState<string | null>(null);
  const [email, setEmail] = useState('');
  const [emailError, setEmailError] = useState<string | undefined>();
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [passwordError, setPasswordError] = useState<string | undefined>();
  const [confirmationError, setConfirmationError] = useState<string | undefined>();
  const [verifiedEmail, setVerifiedEmail] = useState('');
  const [ordinaryAccount, setOrdinaryAccount] = useState<OrdinaryAccount | null>(null);
  const [returnPath, setReturnPath] = useState('/');
  const [deadResendStatus, setDeadResendStatus] = useState<ResendStatus>('ready');
  const [deadResendSeconds, setDeadResendSeconds] = useState(0);
  const temporaryClient = useRef<InstanceType<typeof AuthClient> | null>(null);
  const temporarySession = useRef<Session | null>(null);
  const ordinaryClient = useRef<InstanceType<typeof AuthClient> | null>(null);
  const clearOrdinarySession = useRef<(() => void) | null>(null);
  const ordinaryAccountRef = useRef<OrdinaryAccount | null>(null);
  const passwordWasChanged = useRef(false);
  const emailRef = useRef<any>(null);
  const passwordRef = useRef<any>(null);
  const confirmationRef = useRef<any>(null);

  useEffect(() => {
    if (deadResendStatus !== 'rate-limited') return;
    const timer = setInterval(() => {
      setDeadResendSeconds((seconds) => {
        if (seconds > 1) return seconds - 1;
        setDeadResendStatus('ready');
        return 0;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [deadResendStatus]);

  const finishConfirmation = async (session: Session) => {
    if (memory?.pendingReference) {
      try {
        const completed = await completePendingTrackActionFromApi(
          session.access_token,
          memory.pendingReference,
        );
        setReturnPath(completed.returnPath);
      } catch (completionError) {
        if (!(completionError instanceof ApiError && completionError.status === 410)) {
          setScreen('link-fail');
          return;
        }
      }
    }

    const openAccount = ordinaryAccountRef.current;
    const relationship = !openAccount
      ? 'none'
      : openAccount.id === session.user.id
        ? 'same'
        : 'different';
    const ordinary = ordinaryClient.current;
    const temporary = temporaryClient.current;
    if (!ordinary || !temporary) {
      setScreen('link-fail');
      return;
    }

    if (relationship === 'none') {
      const handed = await ordinary.setSession({
        access_token: session.access_token,
        refresh_token: session.refresh_token,
      });
      if (handed.error) {
        setScreen('link-fail');
        return;
      }
      setScreen('confirmed');
      return;
    }

    await temporary.signOut({ scope: 'local' });
    temporarySession.current = null;
    setScreen(relationship === 'different' ? 'confirmed-other' : 'confirmed');
  };

  const expectedLink = useMemo(() => {
    if (!memory?.tokenHash) return false;
    return kind === 'confirm'
      ? memory.type === 'signup' || memory.type === 'email'
      : memory.type === 'recovery';
  }, [kind, memory]);

  const continueVerifiedSession = async (session: Session) => {
    const temporary = temporaryClient.current;
    if (!temporary) {
      setScreen('link-fail');
      return;
    }
    const safeAccount = await validateAlethicalSession(session);
    if (!safeAccount.ok) {
      const failureScreen = emailLinkFailureScreen(safeAccount.error.kind);
      if (failureScreen === 'deactivated') {
        await temporary.signOut({ scope: 'local' });
        temporarySession.current = null;
      }
      setScreen(failureScreen === 'deactivated' ? 'deactivated' : 'link-fail');
      return;
    }
    setVerifiedEmail(safeAccount.data.email || session.user.email || '');

    const ordinary = await ordinaryClientAndAccount();
    ordinaryClient.current = ordinary.client;
    clearOrdinarySession.current = ordinary.clearStoredSession;
    ordinaryAccountRef.current = ordinary.account;
    setOrdinaryAccount(ordinary.account);
    if (kind === 'reset') {
      setScreen('new-password');
      return;
    }
    await finishConfirmation(session);
  };

  const verifyLink = async () => {
    if (temporarySession.current) {
      setScreen('checking');
      setError(null);
      await continueVerifiedSession(temporarySession.current);
      return;
    }
    if (!expectedLink || !memory?.tokenHash || !memory.type) {
      setScreen('dead');
      return;
    }
    setScreen('checking');
    setError(null);
    const config = publicSupabaseConfig();
    if (!config.url || !config.key) {
      setScreen('link-fail');
      return;
    }

    const temporary = createTemporaryAuthClient(config.url, config.key);
    temporaryClient.current = temporary;
    const verified = await temporary.verifyOtp({
      token_hash: memory.tokenHash,
      type: memory.type,
    });
    if (verified.error || !verified.data.session) {
      const failure = mapProviderAuthError(verified.error);
      // A spent or expired token has its own page; every other failure gets the
      // shared floor — the same retry, a human contact, and a way out (#1533).
      setScreen(failure.kind === 'expired-or-used-link' ? 'dead' : 'link-fail');
      return;
    }

    temporarySession.current = verified.data.session;
    await continueVerifiedSession(verified.data.session);
  };

  const resendDeadConfirmation = async () => {
    const fieldFailure = validateEmail(email);
    setEmailError(fieldFailure ?? undefined);
    if (fieldFailure) {
      emailRef.current?.focus?.();
      return;
    }
    setError(null);
    setDeadResendStatus('sending');
    try {
      const config = publicSupabaseConfig();
      const temporary = createTemporaryAuthClient(config.url, config.key);
      const result = await temporary.resend({
        type: 'signup',
        email: email.trim().toLowerCase(),
        options: {
          emailRedirectTo: `${publicOrigin()}/confirm#auth_action=confirm`,
        },
      });
      if (result.error) {
        const failure = mapProviderAuthError(result.error, email);
        setError(failure.message);
        if (failure.kind === 'too-many-attempts') {
          setDeadResendSeconds(RESEND_WAIT_SECONDS);
          setDeadResendStatus('rate-limited');
        } else {
          setDeadResendStatus('ready');
        }
        return;
      }
      setScreen('dead-sent');
    } catch {
      setError(REV9_AUTH_MESSAGES.requestFailure);
      setDeadResendStatus('ready');
    }
  };

  const resetRelationship = () => {
    const resetSession = temporarySession.current;
    if (!ordinaryAccount) return 'none' as const;
    if (resetSession && ordinaryAccount.id === resetSession.user.id) return 'same' as const;
    return 'different' as const;
  };

  const finishResetCleanup = async () => {
    const temporary = temporaryClient.current;
    const resetSession = temporarySession.current;
    if (!temporary || !resetSession) {
      setScreen('dead');
      return;
    }
    setScreen('finishing');
    // The password save itself already revoked the account's other sessions —
    // Supabase's UpdatePassword runs LogoutAllExceptMe inside the same
    // transaction — so the client's only remaining work is its two local
    // clears, and there is no cleanup failure left to report (#1533).
    const relationship = resetRelationship();
    await finishResetSignOuts(
      temporary,
      ordinaryClient.current,
      relationship,
      clearOrdinarySession.current,
    );
    if (relationship === 'different' && ordinaryAccount) {
      try {
        window.sessionStorage.setItem(
          PASSWORD_NOTICE_KEY,
          JSON.stringify({
            resetEmail: verifiedEmail,
            ordinaryEmail: ordinaryAccount.email,
          }),
        );
      } catch {
        // The password is changed even if its brief return notice cannot persist.
      }
      goToAlethical(false);
      return;
    }
    goToAlethical(true);
  };

  // The uncertain-save exit: the save may or may not have finished server-side,
  // so this skips the "Password changed" screen and notice entirely — success
  // is unknown, and no surface may claim it (rev 17 REQUEST FAILURE carve-out).
  const continueAfterUncertainSave = async () => {
    const temporary = temporaryClient.current;
    const relationship = resetRelationship();
    if (temporary) {
      await finishResetSignOuts(
        temporary,
        ordinaryClient.current,
        relationship,
        clearOrdinarySession.current,
      );
    }
    goToAlethical(relationship !== 'different');
  };

  const changePassword = async () => {
    const firstFailure = validatePassword(password);
    const secondFailure = validatePasswordMatch(password, confirmation);
    setPasswordError(firstFailure ?? undefined);
    setConfirmationError(secondFailure ?? undefined);
    if (firstFailure || secondFailure) {
      (firstFailure ? passwordRef : confirmationRef).current?.focus?.();
      return;
    }
    if (!temporaryClient.current) return;

    const temporary = temporaryClient.current;
    const changed = await updatePasswordOnce(passwordWasChanged, () =>
      temporary.updateUser({ password }),
    );
    if (changed.error) {
      // A lost reply may have saved the password server-side. Clear the typed
      // password and never offer the save again — a blind retry could change
      // the password twice, which the checks forbid.
      if (isUncertainPasswordSave(changed.error)) {
        setPassword('');
        setConfirmation('');
        setPasswordError(undefined);
        setConfirmationError(undefined);
        setError(null);
        setScreen('uncertain-save');
        return;
      }
      const failure = mapProviderAuthError(changed.error, verifiedEmail, { passwordSave: true });
      const fieldError =
        failure.kind === 'weak-password' ||
        failure.kind === 'leaked-password' ||
        failure.kind === 'same-password' ||
        failure.kind === 'password-too-long';
      setPasswordError(fieldError ? failure.message : undefined);
      setError(fieldError ? null : failure.message);
      if (fieldError) passwordRef.current?.focus?.();
      return;
    }
    await finishResetCleanup();
  };

  if (screen === 'link-fail') {
    // The floor for a persistent service failure: the same retry (resolved by
    // the current link kind), a human contact, and a way out — never a
    // one-button loop. The banner claims nothing about server state: a reply
    // lost after the server commits leaves a changed account behind this
    // screen, so "your account has not changed" would be false (#1533).
    return (
      <SignInContainer
        variant="page"
        title="We couldn’t check that link"
        description={
          <ContactMailText
            text="Try once more. If it keeps failing, contact us at ask@alethical.com and we’ll help."
            style={descriptionTextStyle}
          />
        }
      >
        <View style={styles.stack}>
          <FormError variant="banner" message="Something went wrong checking this link" />
          <LoadingButton label="Try again" busyLabel="Checking…" onPress={verifyLink} />
          <LoadingButton
            label="Continue to Alethical"
            busyLabel="Continuing…"
            tone="quiet"
            onPress={() => goToAlethical(true)}
          />
        </View>
      </SignInContainer>
    );
  }

  if (screen === 'dead') {
    const confirmationDead = kind === 'confirm';
    return (
      <SignInContainer
        variant="page"
        title="That link can’t be used"
        description={
          confirmationDead
            ? 'Enter your email address to request another confirmation link'
            : 'Start the Forgot password flow again and open the newest email'
        }
      >
        <View style={styles.stack}>
          <FormError variant="banner" message="This link has expired or has already been used" />
          {error && error !== 'This link has expired or has already been used' ? (
            <FormError variant="banner" message={error} />
          ) : null}
          {confirmationDead ? (
            <>
              <EmailField
                inputRef={emailRef}
                value={email}
                error={emailError}
                onChangeText={setEmail}
              />
              <ResendControl
                status={deadResendStatus}
                secondsRemaining={deadResendSeconds}
                sentMessage="If a confirmation email arrives, open the newest one"
                actionLabel="Send a new confirmation email"
                sendingLabel="Sending…"
                onResend={resendDeadConfirmation}
              />
              <LoadingButton
                label="Continue to sign in"
                busyLabel="Continuing…"
                tone="quiet"
                onPress={() => goToAlethical(true)}
              />
            </>
          ) : (
            <>
              <LoadingButton
                label="Go to Forgot password"
                busyLabel="Continuing…"
                onPress={goToForgotPassword}
              />
              <LoadingButton
                label="Continue"
                busyLabel="Continuing…"
                tone="quiet"
                onPress={() => goToAlethical(true)}
              />
            </>
          )}
        </View>
      </SignInContainer>
    );
  }

  if (screen === 'dead-sent') {
    return (
      <SignInContainer
        variant="page"
        title="Check your email"
        description="If a confirmation email arrives, open the newest one"
      >
        <LoadingButton
          label="Continue to sign in"
          busyLabel="Continuing…"
          onPress={() => goToAlethical(true)}
        />
      </SignInContainer>
    );
  }

  if (screen === 'deactivated') {
    return (
      <SignInContainer
        variant="page"
        title="This account has been deactivated"
        description={
          <ContactMailText text={SIGN_IN_ERROR_MESSAGES.deactivated} style={descriptionTextStyle} />
        }
      >
        <LoadingButton
          label="Back to sign in"
          busyLabel="Returning…"
          tone="quiet"
          onPress={() => goToAlethical(true)}
        />
      </SignInContainer>
    );
  }

  if (screen === 'confirmed' || screen === 'confirmed-other') {
    // The page moves only when the button is pressed, so the copy narrates no
    // action, and the button itself promises its destination (goal 6: the
    // original intent survives the detour).
    return (
      <SignInContainer
        variant="page"
        title="Email confirmed"
        description={
          screen === 'confirmed'
            ? 'You’re signed in'
            : 'That address is confirmed. Nothing about the account open here has changed.'
        }
      >
        <View style={styles.stack}>
          {screen === 'confirmed-other' && ordinaryAccount ? (
            <>
              <AccountCard
                label="This browser is still signed in as:"
                name={ordinaryAccount.name}
                email={ordinaryAccount.email}
              />
              <Text style={styles.note}>
                To switch accounts later, sign out from the normal account menu
              </Text>
            </>
          ) : null}
          <LoadingButton
            label={
              screen === 'confirmed-other'
                ? 'Continue to Alethical'
                : 'Continue to what you were doing'
            }
            busyLabel="Continuing…"
            onPress={() => window.location.replace(returnPath)}
          />
        </View>
      </SignInContainer>
    );
  }

  if (screen === 'new-password') {
    const different = ordinaryAccount && ordinaryAccount.id !== temporarySession.current?.user.id;
    return (
      <SignInContainer
        variant="page"
        title="Choose a new password"
        description={
          different
            ? `Change the password for ${verifiedEmail}. The account open in this browser will stay signed in.`
            : `For ${verifiedEmail}`
        }
      >
        <View style={styles.stack}>
          {different && ordinaryAccount ? (
            <AccountCard
              label="This browser will stay signed in as:"
              name={ordinaryAccount.name}
              email={ordinaryAccount.email}
            />
          ) : null}
          {error ? <FormError variant="banner" message={error} /> : null}
          <PasswordField
            inputRef={passwordRef}
            label="NEW PASSWORD"
            value={password}
            autoComplete="new-password"
            helper="Use at least 15 characters. A few words with spaces works well."
            error={passwordError}
            onChangeText={setPassword}
          />
          <PasswordField
            inputRef={confirmationRef}
            label="CONFIRM PASSWORD"
            value={confirmation}
            autoComplete="new-password"
            error={confirmationError}
            onChangeText={setConfirmation}
          />
          <LoadingButton label="Change password" busyLabel="Saving…" onPress={changePassword} />
        </View>
      </SignInContainer>
    );
  }

  if (screen === 'uncertain-save') {
    // The REQUEST FAILURE carve-out: success is unknown, so this skips the
    // "Password changed" screen and notice, and never re-offers the save.
    const differentOpen =
      ordinaryAccount && ordinaryAccount.id !== temporarySession.current?.user.id;
    return (
      <SignInContainer
        variant="page"
        title="Choose a new password"
        description={`For ${verifiedEmail}`}
      >
        <View style={styles.stack}>
          <FormError variant="banner" message={uncertainPasswordSaveMessage(verifiedEmail)} />
          {differentOpen && ordinaryAccount ? (
            <AccountCard
              label="This browser will stay signed in as:"
              name={ordinaryAccount.name}
              email={ordinaryAccount.email}
            />
          ) : null}
          <LoadingButton
            label={differentOpen ? 'Continue to Alethical' : 'Continue'}
            busyLabel="Continuing…"
            onPress={continueAfterUncertainSave}
          />
        </View>
      </SignInContainer>
    );
  }

  if (screen === 'finishing') {
    // Claims only the work this client is doing: its own two local clears.
    // Other sessions were revoked inside the password save itself, and a
    // device's already-issued access pass may keep working until it expires —
    // so no wording here may say other devices are already signed out.
    return (
      <SignInContainer
        variant="page"
        title="Password changed"
        description="Finishing up — closing this reset session"
      >
        <LoadingButton label="Finishing up…" busyLabel="Finishing up…" busy onPress={undefined} />
      </SignInContainer>
    );
  }

  return (
    <SignInContainer
      variant="page"
      title={kind === 'confirm' ? 'Confirm your email' : 'Reset your password'}
      description={
        kind === 'confirm'
          ? 'Press the button to confirm the email address from this message'
          : 'Press the button to check this reset link and choose a new password'
      }
    >
      <View style={styles.stack}>
        {error ? <FormError variant="banner" message={error} /> : null}
        <LoadingButton
          label={kind === 'confirm' ? 'Confirm email' : 'Continue to reset password'}
          busyLabel={kind === 'confirm' ? 'Confirming…' : 'Checking your link…'}
          busy={screen === 'checking'}
          onPress={verifyLink}
        />
      </View>
    </SignInContainer>
  );
}

const styles = StyleSheet.create({
  stack: { gap: 16 },
  note: {
    fontFamily: t.typography.body,
    fontSize: t.fontSizes.small,
    lineHeight: 21,
    color: t.colors.text.muted,
  },
});
