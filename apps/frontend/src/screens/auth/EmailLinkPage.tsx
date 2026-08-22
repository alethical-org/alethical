import { useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { AuthClient, type Session } from '@supabase/auth-js';

import { AccountCard } from '../../components/auth/AccountCard';
import { ContactMailText } from '../../components/auth/ContactMailText';
import { FormError } from '../../components/auth/FormError';
import { LoadingButton } from '../../components/auth/LoadingButton';
import { PasswordField } from '../../components/auth/PasswordField';
import { SignInContainer, descriptionTextStyle } from '../../components/auth/SignInContainer';
import { ApiError, completePendingTrackActionFromApi } from '../../data/api';
import {
  createTemporaryAuthClient,
  finishTemporarySessionAfterPassword,
  legacyConfirmationPasswordMatches,
  temporarySessionRelationship,
} from '../../lib/auth/linkSession';
import { validateAlethicalSession, type AuthUser } from '../../lib/auth/operations';
import {
  sameProviderSession,
  sameProviderSessionLineage,
} from '../../lib/auth/providerSessionAcceptance';
import { finishResetSignOuts, updatePasswordOnce } from '../../lib/auth/resetCleanup';
import {
  REV9_AUTH_MESSAGES,
  emailLinkFailureScreen,
  isUncertainPasswordSave,
  mapProviderAuthError,
  uncertainPasswordSaveMessage,
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

function goToCreateAccount() {
  if (typeof window === 'undefined') return;
  window.location.replace('/#auth_screen=create');
}

function publicSupabaseConfig() {
  return {
    url: process.env.EXPO_PUBLIC_SUPABASE_URL ?? '',
    key: process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? '',
  };
}

async function ordinaryClientAndAccount(): Promise<{
  client: {
    setSessionIfUnchanged: typeof import('../../lib/supabase.web').setOrdinarySessionIfUnchanged;
    clearSessionIfUnchanged: typeof import('../../lib/supabase.web').clearOrdinarySessionIfUnchanged;
  };
  account: OrdinaryAccount | null;
}> {
  const module = await import('../../lib/supabase.web');
  let current = await module.supabase.auth.getSession();
  if (current.error) throw current.error;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const session = current.data.session;
    if (!session) {
      return {
        client: {
          setSessionIfUnchanged: module.setOrdinarySessionIfUnchanged,
          clearSessionIfUnchanged: module.clearOrdinarySessionIfUnchanged,
        },
        account: null,
      };
    }

    const validated = await validateAlethicalSession(session);
    if (!validated.ok) throw new Error('The open account could not be checked');
    const latest = await module.supabase.auth.getSession();
    if (latest.error) throw latest.error;
    if (sameProviderSession(latest.data.session, session)) {
      return {
        client: {
          setSessionIfUnchanged: module.setOrdinarySessionIfUnchanged,
          clearSessionIfUnchanged: module.clearOrdinarySessionIfUnchanged,
        },
        account: {
          session,
          id: validated.data.id,
          name: validated.data.name,
          email: validated.data.email,
        },
      };
    }
    current = latest;
  }

  throw new Error('The open account changed while it was being checked');
}

export function EmailLinkPage({ kind }: { kind: LinkKind }) {
  const memory = typeof window !== 'undefined' ? window.__alethicalEmailLink : undefined;
  const [screen, setScreen] = useState<Screen>('gate');
  const [error, setError] = useState<string | null>(null);
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [passwordError, setPasswordError] = useState<string | undefined>();
  const [confirmationError, setConfirmationError] = useState<string | undefined>();
  const [verifiedEmail, setVerifiedEmail] = useState('');
  const [ordinaryAccount, setOrdinaryAccount] = useState<OrdinaryAccount | null>(null);
  const [returnPath, setReturnPath] = useState('/');
  const temporaryClient = useRef<InstanceType<typeof AuthClient> | null>(null);
  const temporarySession = useRef<Session | null>(null);
  const verifiedAccount = useRef<AuthUser | null>(null);
  const passwordWasChanged = useRef(false);
  const ordinarySessionMayBeRevoked = useRef(false);
  const ordinarySessionAtPasswordMutation = useRef<Session | null>(null);
  const passwordRef = useRef<any>(null);
  const confirmationRef = useRef<any>(null);

  const refreshOrdinaryAccount = async () => {
    try {
      const currentOrdinary = await ordinaryClientAndAccount();
      setOrdinaryAccount(currentOrdinary.account);
      return currentOrdinary;
    } catch {
      setScreen('link-fail');
      return null;
    }
  };

  const finishConfirmation = async (session: Session) => {
    // Re-read the ordinary account at the last possible moment. Another tab may
    // have signed in while this password form was open.
    const currentOrdinary = await refreshOrdinaryAccount();
    const targetAccount = verifiedAccount.current;
    const temporary = temporaryClient.current;
    if (!currentOrdinary || !targetAccount || !temporary) {
      setScreen('link-fail');
      return;
    }

    const finished = await finishTemporarySessionAfterPassword({
      ordinary: currentOrdinary.client,
      ordinaryAccountId: currentOrdinary.account?.id ?? null,
      ordinaryProviderUserId: currentOrdinary.account?.session.user.id ?? null,
      ordinarySession: currentOrdinary.account?.session ?? null,
      ordinarySessionAtPasswordMutation: ordinarySessionAtPasswordMutation.current,
      passwordChanged: ordinarySessionMayBeRevoked.current,
      session,
      temporaryAccountId: targetAccount.id,
      temporary,
    });
    if (finished.error) {
      setScreen('link-fail');
      return;
    }

    temporarySession.current = null;
    setScreen(finished.relationship === 'different' ? 'confirmed-other' : 'confirmed');
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
    verifiedAccount.current = safeAccount.data;
    setVerifiedEmail(safeAccount.data.email || session.user.email || '');

    // The held action belongs to this proved account even if the following
    // password save gets an uncertain reply. Complete it now so that exit cannot
    // silently lose what brought the reader through sign-in.
    if (kind === 'confirm' && memory?.pendingReference) {
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

    if (!(await refreshOrdinaryAccount())) return;
    if (kind === 'confirm' && passwordWasChanged.current) {
      setScreen('finishing');
      await finishConfirmation(session);
      return;
    }
    setScreen('new-password');
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

  const resetRelationship = (openAccount: OrdinaryAccount | null) => {
    const targetAccount = verifiedAccount.current;
    if (!targetAccount) return null;
    return temporarySessionRelationship(openAccount?.id ?? null, targetAccount.id);
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
    const currentOrdinary = await refreshOrdinaryAccount();
    if (!currentOrdinary) return;
    const relationship = resetRelationship(currentOrdinary.account);
    if (!relationship) {
      setScreen('link-fail');
      return;
    }
    const ordinaryProviderMatchesTarget =
      ordinarySessionMayBeRevoked.current &&
      currentOrdinary.account?.session.user.id === resetSession.user.id &&
      Boolean(
        currentOrdinary.account?.session &&
        ordinarySessionAtPasswordMutation.current &&
        sameProviderSessionLineage(
          currentOrdinary.account.session,
          ordinarySessionAtPasswordMutation.current,
        ),
      );
    await finishResetSignOuts(
      temporary,
      currentOrdinary.client,
      ordinaryProviderMatchesTarget ? 'same' : currentOrdinary.account ? 'different' : 'none',
      currentOrdinary.account?.session ?? null,
    );
    if (relationship === 'different' && currentOrdinary.account) {
      try {
        window.sessionStorage.setItem(
          PASSWORD_NOTICE_KEY,
          JSON.stringify({
            resetEmail: verifiedEmail,
            ordinaryEmail: currentOrdinary.account.email,
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
    const currentOrdinary = await refreshOrdinaryAccount();
    if (!currentOrdinary) return;
    const relationship = resetRelationship(currentOrdinary.account);
    const resetSession = temporarySession.current;
    if (!relationship || !resetSession) {
      setScreen('link-fail');
      return;
    }
    if (temporary) {
      const ordinaryProviderMatchesTarget =
        currentOrdinary.account?.session.user.id === resetSession.user.id &&
        Boolean(
          currentOrdinary.account?.session &&
          ordinarySessionAtPasswordMutation.current &&
          sameProviderSessionLineage(
            currentOrdinary.account.session,
            ordinarySessionAtPasswordMutation.current,
          ),
        );
      await finishResetSignOuts(
        temporary,
        currentOrdinary.client,
        ordinaryProviderMatchesTarget ? 'same' : currentOrdinary.account ? 'different' : 'none',
        currentOrdinary.account?.session ?? null,
      );
    }
    goToAlethical(relationship !== 'different');
  };

  const finishConfirmedPassword = async () => {
    const session = temporarySession.current;
    if (!session) {
      setScreen('link-fail');
      return;
    }
    setScreen('finishing');
    await finishConfirmation(session);
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
    const ordinaryBeforePassword = await refreshOrdinaryAccount();
    if (!ordinaryBeforePassword) return;
    ordinarySessionAtPasswordMutation.current = ordinaryBeforePassword.account?.session ?? null;
    const changed = await updatePasswordOnce(passwordWasChanged, () =>
      temporary.updateUser({ password }),
    );
    const previousSession = temporarySession.current;
    let currentTemporarySession: Session | null = null;
    try {
      const current = await temporary.getSession();
      if (
        !current.error &&
        current.data.session &&
        previousSession &&
        sameProviderSessionLineage(current.data.session, previousSession)
      ) {
        currentTemporarySession = current.data.session;
        temporarySession.current = current.data.session;
      }
    } catch {
      // The password result below still decides whether another save is safe.
    }
    const finishesPasswordFlow =
      !changed.error ||
      legacyConfirmationPasswordMatches(kind, memory?.type ?? null, changed.error) ||
      (changed.error as { code?: unknown } | null)?.code === 'same_password';
    if (finishesPasswordFlow && !currentTemporarySession) {
      if (!changed.error) passwordWasChanged.current = true;
      setError(REV9_AUTH_MESSAGES.requestFailure);
      return;
    }
    if (changed.error) {
      if (legacyConfirmationPasswordMatches(kind, memory?.type ?? null, changed.error)) {
        passwordWasChanged.current = true;
        ordinarySessionMayBeRevoked.current = false;
        await finishConfirmedPassword();
        return;
      }
      if ((changed.error as { code?: unknown } | null)?.code === 'same_password') {
        passwordWasChanged.current = true;
        ordinarySessionMayBeRevoked.current = false;
        if (kind === 'reset') {
          const ordinaryBeforeOtherSessionSignOut = await refreshOrdinaryAccount();
          if (!ordinaryBeforeOtherSessionSignOut) return;
          ordinarySessionAtPasswordMutation.current =
            ordinaryBeforeOtherSessionSignOut.account?.session ?? null;
          const ended = await temporary.signOut({ scope: 'others' });
          if (ended.error) {
            setError(REV9_AUTH_MESSAGES.requestFailure);
            return;
          }
          ordinarySessionMayBeRevoked.current = true;
          await finishResetCleanup();
          return;
        }
      }
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
      const fieldError = failure.kind === 'weak-password' || failure.kind === 'password-too-long';
      setPasswordError(fieldError ? failure.message : undefined);
      setError(fieldError ? null : failure.message);
      if (fieldError) passwordRef.current?.focus?.();
      return;
    }
    ordinarySessionMayBeRevoked.current = true;
    if (kind === 'confirm') {
      await finishConfirmedPassword();
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
        focusKey={screen}
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
        focusKey={screen}
        variant="page"
        title="That link can’t be used"
        description={
          confirmationDead
            ? 'Start Create account again to request a new code'
            : 'Start Recover account again to request a new code'
        }
      >
        <View style={styles.stack}>
          <FormError variant="banner" message="This link has expired or has already been used" />
          {confirmationDead ? (
            <>
              <LoadingButton
                label="Go to Create account"
                busyLabel="Continuing…"
                onPress={goToCreateAccount}
              />
            </>
          ) : (
            <>
              <LoadingButton
                label="Go to Recover account"
                busyLabel="Continuing…"
                onPress={goToForgotPassword}
              />
            </>
          )}
          <LoadingButton
            label="Continue"
            busyLabel="Continuing…"
            tone="quiet"
            onPress={() => goToAlethical(true)}
          />
        </View>
      </SignInContainer>
    );
  }

  if (screen === 'deactivated') {
    return (
      <SignInContainer
        focusKey={screen}
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
        focusKey={screen}
        variant="page"
        title="Password saved"
        description={
          screen === 'confirmed'
            ? 'Your email is confirmed. You’re signed in'
            : `${verifiedEmail} is confirmed. The account open here has not changed`
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
    const different = Boolean(
      ordinaryAccount &&
      verifiedAccount.current &&
      ordinaryAccount.id !== verifiedAccount.current.id,
    );
    return (
      <SignInContainer
        focusKey={screen}
        variant="page"
        title={kind === 'confirm' ? 'Choose a password' : 'Choose a new password'}
        description={
          different
            ? `${kind === 'confirm' ? 'Set' : 'Change'} the password for ${verifiedEmail}. The account open in this browser will stay signed in.`
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
            helper={REV9_AUTH_MESSAGES.passwordTooShort}
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
          <LoadingButton
            label={kind === 'confirm' ? 'Save password' : 'Change password'}
            busyLabel="Saving…"
            onPress={changePassword}
          />
        </View>
      </SignInContainer>
    );
  }

  if (screen === 'uncertain-save') {
    // The REQUEST FAILURE carve-out: success is unknown, so this skips the
    // "Password changed" screen and notice, and never re-offers the save.
    const differentOpen = Boolean(
      ordinaryAccount &&
      verifiedAccount.current &&
      ordinaryAccount.id !== verifiedAccount.current.id,
    );
    return (
      <SignInContainer
        focusKey={screen}
        variant="page"
        title="We couldn’t confirm the password was saved"
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
        focusKey={screen}
        variant="page"
        title={kind === 'confirm' ? 'Password saved' : 'Password changed'}
        description={
          kind === 'confirm' ? 'Finishing sign-in' : 'Finishing up — closing this reset session'
        }
      >
        <LoadingButton label="Finishing up…" busyLabel="Finishing up…" busy onPress={undefined} />
      </SignInContainer>
    );
  }

  return (
    <SignInContainer
      focusKey="gate"
      variant="page"
      title={kind === 'confirm' ? 'Confirm your email' : 'Reset your password'}
      description={
        kind === 'confirm'
          ? 'Confirm this email, then choose the password you’ll use to sign in'
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
