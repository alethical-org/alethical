import { useEffect, useRef, useState, type FormEvent } from 'react';

import { proveSignInCode, requestSignInCode, signInResearch } from '../api/client';
import { forgetCodeRequest, readCodeRequest, rememberCodeRequest } from '../auth/codeRequest';
import { rememberReturnPath } from '../auth/returnPath';
import { useFinanceSession } from '../auth/session';
import { navigate, useLocation } from '../router';
import { safeReturnPath } from '../routes';

type Step = 'options' | 'email' | 'code' | 'password';

export const RESEND_WAIT_SECONDS = 60;

/**
 * Google or an emailed code for ordinary accounts; an operator-managed password
 * for shared research access. No sign-up: the
 * server sends a code only to an address on Finance's access list, and answers
 * every address alike, so this screen never says whether one is listed. A
 * reload within a code's lifetime returns to the code step for the same request.
 */
export function SignIn() {
  const {
    supabase,
    apiBaseUrl,
    googleSignIn,
    emailSignIn,
    screens,
    status,
    startResearchSession,
    beginOrdinarySignIn,
  } = useFinanceSession();
  const location = useLocation();
  const next = safeReturnPath(location.searchParams.get('next'), screens);
  const googleCancelled = location.searchParams.get('google') === 'cancelled';
  // This tab's newest code request; the code is proved with its challenge.
  const [request, setRequest] = useState(readCodeRequest);
  const [step, setStep] = useState<Step>(request ? 'code' : 'options');
  const [email, setEmail] = useState(request?.email ?? '');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState<'google' | 'send' | 'verify' | 'resend' | 'password' | null>(
    null,
  );
  const [error, setError] = useState<string | null>(googleCancelled ? 'google' : null);
  const [resent, setResent] = useState(false);
  const [waitUntil, setWaitUntil] = useState(
    request ? request.requestedAt + RESEND_WAIT_SECONDS * 1000 : 0,
  );
  const [now, setNow] = useState(() => Date.now());
  const [verified, setVerified] = useState(false);
  const moved = useRef(false);

  useEffect(() => {
    if (status === 'granted' || status === 'no-access') navigate(next, { replace: true });
    if (verified && status === 'signed-out') {
      setVerified(false);
      setError('finish');
    }
  }, [next, status, verified]);

  // Each step change puts keyboard focus where the next action is.
  useEffect(() => {
    if (!moved.current) return;
    const target =
      step === 'options'
        ? '#sign-in-heading'
        : step === 'email'
          ? '#email'
          : step === 'password'
            ? '#password'
            : '#code';
    document.querySelector<HTMLElement>(target)?.focus();
  }, [step]);

  // Back from Google can restore this page from the browser's cache mid-press.
  useEffect(() => {
    function restored(event: PageTransitionEvent) {
      if (event.persisted) setBusy(null);
    }
    window.addEventListener('pageshow', restored);
    return () => window.removeEventListener('pageshow', restored);
  }, []);

  function goTo(nextStep: Step) {
    moved.current = true;
    setStep(nextStep);
  }

  useEffect(() => {
    if (waitUntil <= now) return;
    const timer = window.setTimeout(() => setNow(Date.now()), 1000);
    return () => window.clearTimeout(timer);
  }, [now, waitUntil]);

  async function continueWithGoogle() {
    setBusy('google');
    setError(null);
    forgetCodeRequest();
    rememberReturnPath(next, screens);
    beginOrdinarySignIn();
    const { error: failure } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: `${window.location.origin}/auth/return?source=google`,
      },
    });
    if (failure) {
      setBusy(null);
      setError('google');
    }
  }

  async function sendCode(event?: FormEvent) {
    event?.preventDefault();
    const address = email.trim();
    if (!address) {
      setError('email');
      return;
    }
    setBusy(step === 'code' ? 'resend' : 'send');
    setError(null);
    setResent(false);
    const result = await requestSignInCode(apiBaseUrl, address);
    setBusy(null);
    if (result.kind === 'invalid-email') {
      setError(step === 'code' ? 'send' : 'email');
      return;
    }
    if (result.kind !== 'accepted') {
      setError('send');
      return;
    }
    const kept = rememberCodeRequest(address, result.challenge);
    setRequest(kept);
    if (step === 'code') setResent(true);
    setCode('');
    goTo('code');
    setWaitUntil(kept.requestedAt + RESEND_WAIT_SECONDS * 1000);
    setNow(Date.now());
  }

  async function verifyCode(event: FormEvent) {
    event.preventDefault();
    if (!code.trim()) {
      setError('code');
      return;
    }
    setBusy('verify');
    setError(null);
    // Alethical checks the code; Supabase turns the 1-time token into a session.
    const proof = await proveSignInCode(
      apiBaseUrl,
      email.trim(),
      code.trim(),
      request?.challenge ?? '',
    );
    if (proof.kind !== 'token') {
      setBusy(null);
      setError(proof.kind === 'refused' ? 'code' : 'check');
      return;
    }
    beginOrdinarySignIn();
    const { error: failure } = await supabase.auth.verifyOtp({
      token_hash: proof.tokenHash,
      type: proof.type,
    });
    setBusy(null);
    if (failure) {
      setError('finish');
      return;
    }
    forgetCodeRequest();
    setVerified(true);
  }

  async function passwordSignIn(event: FormEvent) {
    event.preventDefault();
    if (!password) {
      setError('credentials');
      return;
    }
    setBusy('password');
    setError(null);
    const result = await signInResearch(apiBaseUrl, password);
    if (result.kind !== 'session') {
      setBusy(null);
      setError(result.kind === 'refused' ? 'password-refused' : result.kind);
      return;
    }
    forgetCodeRequest();
    await startResearchSession(result.session);
    setPassword('');
    setVerified(true);
    setBusy(null);
  }

  const waitSeconds = Math.max(0, Math.ceil((waitUntil - now) / 1000));
  // Busy from the code check until the access answer arrives.
  const finishing = verified && (status === 'loading' || status === 'checking');

  return (
    <main className="access access--sign-in" id="main">
      <p className="lockup">
        Alethical <span>Finance</span>
      </p>
      <h1 id="sign-in-heading" tabIndex={-1}>
        Sign in
      </h1>

      {step === 'options' && (
        <div className="stack">
          {error === 'google' && (
            <p role="alert" className="error">
              {emailSignIn
                ? 'Google didn’t finish. Try again, or use email.'
                : 'Google didn’t finish. Try again.'}
            </p>
          )}
          {googleSignIn && (
            <button type="button" onClick={continueWithGoogle} disabled={busy !== null}>
              {busy === 'google' ? 'Continuing with Google…' : 'Continue with Google'}
            </button>
          )}
          {emailSignIn && (
            <button
              type="button"
              className={googleSignIn ? 'secondary' : undefined}
              onClick={() => {
                setError(null);
                goTo('email');
              }}
            >
              Sign in with email
            </button>
          )}
          {screens && (
            <button
              type="button"
              className={`secondary${googleSignIn || emailSignIn ? ' investor-sign-in' : ''}`}
              disabled={busy !== null}
              onClick={() => {
                setError(null);
                goTo('password');
              }}
            >
              Investor login
            </button>
          )}
          {!googleSignIn && !emailSignIn && !screens && (
            <p>Sign-in to Alethical Finance is not open yet.</p>
          )}
        </div>
      )}

      {step === 'password' && (
        <form className="stack" onSubmit={passwordSignIn} noValidate>
          <label htmlFor="password">Access code</label>
          <input
            id="password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            disabled={busy !== null || finishing}
            aria-invalid={error === 'credentials' || error === 'password-refused'}
            aria-describedby={error ? 'password-error' : undefined}
          />
          {error && (
            <p id="password-error" role="alert" className="error">
              {error === 'credentials'
                ? 'Enter your access code'
                : error === 'password-refused'
                  ? 'That access code is not right. Try again.'
                  : error === 'rate-limited'
                    ? 'Too many sign-in attempts. Wait a minute and try again.'
                    : 'We couldn’t sign you in. Try again.'}
            </p>
          )}
          <button type="submit" disabled={busy !== null || finishing}>
            {busy === 'password' || finishing ? 'Signing in…' : 'Sign in'}
          </button>
          <button
            type="button"
            className="link"
            disabled={busy !== null || finishing}
            onClick={() => {
              setError(null);
              setPassword('');
              goTo('options');
            }}
          >
            Back to sign-in options
          </button>
        </form>
      )}

      {step === 'email' && (
        <form className="stack" onSubmit={sendCode} noValidate>
          <label htmlFor="email">Email</label>
          <input
            id="email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            aria-invalid={error === 'email'}
            aria-describedby={error ? 'email-error' : undefined}
          />
          {error === 'email' && (
            <p id="email-error" role="alert" className="error">
              Enter an email address
            </p>
          )}
          {error === 'send' && (
            <p id="email-error" role="alert" className="error">
              We couldn’t send a code. Try again.
            </p>
          )}
          <button type="submit" disabled={busy !== null}>
            {busy === 'send' ? 'Sending…' : 'Continue'}
          </button>
          <button
            type="button"
            className="link"
            onClick={() => {
              setError(null);
              goTo('options');
            }}
          >
            Back to sign-in options
          </button>
        </form>
      )}

      {step === 'code' && (
        <form className="stack" onSubmit={verifyCode} noValidate>
          <h2>Enter the newest code</h2>
          <p>If {email.trim()} has access to Alethical Finance, a code is on its way to it.</p>
          {resent && <p role="status">New code requested</p>}
          <label htmlFor="code">Code</label>
          <input
            id="code"
            inputMode="numeric"
            autoComplete="one-time-code"
            value={code}
            onChange={(event) => setCode(event.target.value)}
            aria-invalid={error === 'code'}
            aria-describedby={error ? 'code-error' : undefined}
          />
          {error === 'code' && (
            <p id="code-error" role="alert" className="error">
              That code is wrong or expired. Enter the newest code or send a new one.
            </p>
          )}
          {error === 'send' && (
            <p id="code-error" role="alert" className="error">
              We couldn’t send a code. Try again.
            </p>
          )}
          {error === 'check' && (
            <p id="code-error" role="alert" className="error">
              We couldn’t check the code. Try again.
            </p>
          )}
          {error === 'finish' && (
            <p id="code-error" role="alert" className="error">
              We couldn’t finish signing in. Send a new code and try again.
            </p>
          )}
          <button type="submit" disabled={busy !== null || finishing}>
            {busy === 'verify' || finishing ? 'Signing in…' : 'Continue'}
          </button>
          <button
            type="button"
            className="secondary"
            onClick={() => sendCode()}
            disabled={busy !== null || waitSeconds > 0}
          >
            {busy === 'resend' ? 'Sending a new code…' : 'Send a new code'}
          </button>
          {waitSeconds > 0 && (
            <p className="note">You can ask for a new code in {waitSeconds} seconds.</p>
          )}
          <button
            type="button"
            className="link"
            onClick={() => {
              setError(null);
              setCode('');
              goTo('email');
            }}
          >
            Use another email
          </button>
        </form>
      )}
    </main>
  );
}
