import { useMemo, useRef, useState } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';
import { AuthClient, type Session } from '@supabase/auth-js';

import { AccountCard } from '../../components/auth/AccountCard';
import { EmailField } from '../../components/auth/EmailField';
import { FormError } from '../../components/auth/FormError';
import { LoadingButton } from '../../components/auth/LoadingButton';
import { PasswordField } from '../../components/auth/PasswordField';
import { SignInContainer } from '../../components/auth/SignInContainer';
import { ApiError, completePendingTrackActionFromApi } from '../../data/api';
import { createTemporaryAuthClient } from '../../lib/auth/linkSession';
import { validateAlethicalSession } from '../../lib/auth/operations';
import {
  mapProviderAuthError,
  validateEmail,
  validatePassword,
  validatePasswordMatch,
} from '../../lib/auth/rev9Auth';
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
  | 'dead'
  | 'dead-sent'
  | 'confirmed'
  | 'confirmed-other'
  | 'new-password'
  | 'finishing'
  | 'cleanup-failed';

interface OrdinaryAccount {
  session: Session;
  id: string;
  name: string;
  email: string;
}

const OPEN_SIGN_IN_KEY = 'alethical.openSignIn';
const PASSWORD_NOTICE_KEY = 'alethical.passwordChangedNotice';

function publicOrigin() {
  return Platform.OS === 'web' && typeof window !== 'undefined' ? window.location.origin : '';
}

function goToAlethical(openSignIn = false) {
  if (typeof window === 'undefined') return;
  if (openSignIn) window.sessionStorage.setItem(OPEN_SIGN_IN_KEY, 'sign-in');
  window.location.replace('/');
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
}> {
  const module = await import('../../lib/supabase.web');
  const current = await module.supabase.auth.getSession();
  const session = current.data.session;
  if (!session) return { client: module.supabase.auth, account: null };

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
  const temporaryClient = useRef<InstanceType<typeof AuthClient> | null>(null);
  const temporarySession = useRef<Session | null>(null);
  const ordinaryClient = useRef<InstanceType<typeof AuthClient> | null>(null);
  const ordinaryAccountRef = useRef<OrdinaryAccount | null>(null);
  const passwordWasChanged = useRef(false);

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
          setError('We couldn’t complete that request. Check your connection and try again.');
          setScreen('gate');
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
      setError('We couldn’t complete that request. Check your connection and try again.');
      setScreen('gate');
      return;
    }

    if (relationship === 'none') {
      const handed = await ordinary.setSession({
        access_token: session.access_token,
        refresh_token: session.refresh_token,
      });
      if (handed.error) {
        setError('We couldn’t complete that request. Check your connection and try again.');
        setScreen('gate');
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
      setError('We couldn’t complete that request. Check your connection and try again.');
      setScreen('gate');
      return;
    }
    const safeAccount = await validateAlethicalSession(session);
    if (!safeAccount.ok) {
      if (safeAccount.error.kind !== 'request-failure') {
        await temporary.signOut({ scope: 'local' });
        temporarySession.current = null;
      }
      setError(safeAccount.error.message);
      setScreen('gate');
      return;
    }
    setVerifiedEmail(safeAccount.data.email || session.user.email || '');

    const ordinary = await ordinaryClientAndAccount();
    ordinaryClient.current = ordinary.client;
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
      setError('We couldn’t complete that request. Check your connection and try again.');
      setScreen('gate');
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
      setError(failure.message);
      setScreen(failure.kind === 'expired-or-used-link' ? 'dead' : 'gate');
      return;
    }

    temporarySession.current = verified.data.session;
    await continueVerifiedSession(verified.data.session);
  };

  const resendDeadConfirmation = async () => {
    const fieldFailure = validateEmail(email);
    setEmailError(fieldFailure ?? undefined);
    if (fieldFailure) return;
    const config = publicSupabaseConfig();
    const temporary = createTemporaryAuthClient(config.url, config.key);
    const result = await temporary.resend({
      type: 'signup',
      email: email.trim().toLowerCase(),
      options: { emailRedirectTo: `${publicOrigin()}/confirm?auth_action=confirm` },
    });
    if (result.error) {
      setError(mapProviderAuthError(result.error, email).message);
      return;
    }
    setError(null);
    setScreen('dead-sent');
  };

  const finishResetCleanup = async () => {
    const temporary = temporaryClient.current;
    const resetSession = temporarySession.current;
    if (!temporary || !resetSession) {
      setScreen('dead');
      return;
    }
    setScreen('finishing');
    const others = await temporary.signOut({ scope: 'others' });
    if (others.error) {
      setScreen('cleanup-failed');
      return;
    }

    await temporary.signOut({ scope: 'local' });
    const relationship = !ordinaryAccount
      ? 'none'
      : ordinaryAccount.id === resetSession.user.id
        ? 'same'
        : 'different';
    if (relationship === 'same') {
      await ordinaryClient.current?.signOut({ scope: 'local' });
    }
    if (relationship === 'different' && ordinaryAccount) {
      window.sessionStorage.setItem(
        PASSWORD_NOTICE_KEY,
        `Password changed for ${verifiedEmail}. You’re still signed in as ${ordinaryAccount.email}.`,
      );
      goToAlethical(false);
      return;
    }
    goToAlethical(true);
  };

  const changePassword = async () => {
    const firstFailure = validatePassword(password);
    const secondFailure = validatePasswordMatch(password, confirmation);
    setPasswordError(firstFailure ?? undefined);
    setConfirmationError(secondFailure ?? undefined);
    if (firstFailure || secondFailure || !temporaryClient.current) return;

    if (!passwordWasChanged.current) {
      const changed = await temporaryClient.current.updateUser({ password });
      if (changed.error) {
        const failure = mapProviderAuthError(changed.error, verifiedEmail);
        setPasswordError(
          failure.kind === 'weak-password' || failure.kind === 'leaked-password'
            ? failure.message
            : undefined,
        );
        setError(
          failure.kind === 'weak-password' || failure.kind === 'leaked-password'
            ? null
            : failure.message,
        );
        return;
      }
      passwordWasChanged.current = true;
    }
    await finishResetCleanup();
  };

  if (screen === 'dead') {
    const confirmationDead = kind === 'confirm';
    return (
      <SignInContainer
        variant="page"
        title="That link can’t be used"
        description={
          confirmationDead
            ? 'Enter your email address and we’ll send another confirmation link.'
            : 'Start the Forgot password flow again and open the newest email.'
        }
      >
        <View style={styles.stack}>
          <FormError variant="banner" message="This link has expired or has already been used." />
          {error && error !== 'This link has expired or has already been used.' ? (
            <FormError variant="banner" message={error} />
          ) : null}
          {confirmationDead ? (
            <>
              <EmailField value={email} error={emailError} onChangeText={setEmail} />
              <LoadingButton
                label="Send a new confirmation email"
                busyLabel="Sending…"
                onPress={resendDeadConfirmation}
              />
              <LoadingButton
                label="Continue"
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
                onPress={() => {
                  window.sessionStorage.setItem(OPEN_SIGN_IN_KEY, 'forgot');
                  goToAlethical(false);
                }}
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
        description="If this address can receive a confirmation email, we’ve sent one."
      >
        <LoadingButton
          label="Continue"
          busyLabel="Continuing…"
          onPress={() => goToAlethical(true)}
        />
      </SignInContainer>
    );
  }

  if (screen === 'confirmed' || screen === 'confirmed-other') {
    return (
      <SignInContainer
        variant="page"
        title="Email confirmed"
        description={
          screen === 'confirmed'
            ? 'You’re signed in. Taking you back to what you were doing.'
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
                To switch accounts later, sign out from the normal account menu.
              </Text>
            </>
          ) : null}
          <LoadingButton
            label={screen === 'confirmed-other' ? 'Continue to Alethical' : 'Continue'}
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
            : `For ${verifiedEmail}.`
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
            label="NEW PASSWORD"
            value={password}
            autoComplete="new-password"
            helper="Use at least 15 characters. A few words with spaces works well."
            error={passwordError}
            onChangeText={setPassword}
          />
          <PasswordField
            label="CONFIRM PASSWORD"
            value={confirmation}
            autoComplete="new-password"
            error={confirmationError}
            onChangeText={setConfirmation}
          />
          {different ? (
            <Text style={styles.note}>
              Only other sessions for {verifiedEmail} will be signed out.
            </Text>
          ) : null}
          <LoadingButton label="Change password" busyLabel="Saving…" onPress={changePassword} />
        </View>
      </SignInContainer>
    );
  }

  if (screen === 'finishing' || screen === 'cleanup-failed') {
    return (
      <SignInContainer
        variant="page"
        title="Password changed"
        description={
          screen === 'finishing'
            ? 'Finishing up — signing out your other devices and closing this reset session.'
            : 'Your new password already works.'
        }
      >
        <View style={styles.stack}>
          {screen === 'cleanup-failed' ? (
            <FormError
              variant="banner"
              message="Your password changed, but we couldn’t finish signing you out on other devices. Check your connection and try again."
            />
          ) : null}
          <LoadingButton
            label="Try again"
            busyLabel="Finishing up…"
            busy={screen === 'finishing'}
            onPress={finishResetCleanup}
          />
        </View>
      </SignInContainer>
    );
  }

  return (
    <SignInContainer
      variant="page"
      title={kind === 'confirm' ? 'Confirm your email' : 'Reset your password'}
      description={
        kind === 'confirm'
          ? 'Press the button to confirm the email address from this message.'
          : 'Press the button to check this reset link and choose a new password.'
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
