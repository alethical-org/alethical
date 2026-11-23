import { useEffect, useRef, useState, type FormEvent } from 'react';

import { proveSignInCode, requestSignInCode, signInResearch } from '../api/client';
import { forgetCodeRequest, readCodeRequest, rememberCodeRequest } from '../auth/codeRequest';
import { rememberReturnPath } from '../auth/returnPath';
import { useFinanceSession } from '../auth/session';
import { Link, navigate, useLocation } from '../router';
import { AccessPage } from './AccessPage';
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
export function SignIn({ investor = false }: { investor?: boolean }) {
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
  const [request, setRequest] = useState(() =>
    emailSignIn && !investor ? readCodeRequest() : null,
  );
  const [step, setStep] = useState<Step>(investor ? 'password' : request ? 'code' : 'options');
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
    <AccessPage>
      <h1 id="sign-in-heading" tabIndex={-1}>
        {investor ? 'Investor access' : 'Sign in'}
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
            <button
              type="button"
              className="google"
              onClick={continueWithGoogle}
              disabled={busy !== null}
            >
              <GoogleMark />
              {busy === 'google' ? 'Continuing with Google…' : 'Continue with Google'}
            </button>
          )}
          {emailSignIn && (
            <button
              type="button"
              onClick={() => {
                setError(null);
                goTo('email');
              }}
            >
              Sign in with email
            </button>
          )}
          {!googleSignIn && !emailSignIn && <p>Sign-in to Alethical.AI is not open yet.</p>}
        </div>
      )}

      {step === 'password' && (
        <form className="stack investor-access-form" onSubmit={passwordSignIn} noValidate>
          {error && error !== 'credentials' && error !== 'password-refused' && (
            <p role="alert" className="error-box">
              {error === 'rate-limited'
                ? 'Too many attempts. Wait a minute and try again.'
                : 'Couldn’t open investor access. Try again.'}
            </p>
          )}
          <label htmlFor="password">Code</label>
          <input
            id="password"
            type="text"
            autoComplete="off"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            disabled={busy !== null || finishing}
            aria-invalid={error === 'credentials' || error === 'password-refused'}
            aria-describedby={
              error === 'credentials' || error === 'password-refused' ? 'password-error' : undefined
            }
          />
          {(error === 'credentials' || error === 'password-refused') && (
            <p id="password-error" role="alert" className="error">
              {error === 'credentials' ? 'Enter your code' : 'That code is not right. Try again.'}
            </p>
          )}
          <button type="submit" disabled={busy !== null || finishing}>
            {busy === 'password' || finishing ? 'Opening…' : 'Enter'}
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
              Couldn’t send a code. Try again.
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
          <p>If {email.trim()} has access to Alethical.AI, a code is on its way to it.</p>
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
              Couldn’t send a code. Try again.
            </p>
          )}
          {error === 'check' && (
            <p id="code-error" role="alert" className="error">
              Couldn’t check the code. Try again.
            </p>
          )}
          {error === 'finish' && (
            <p id="code-error" role="alert" className="error">
              Couldn’t finish signing in. Send a new code and try again.
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
    </AccessPage>
  );
}

/** Google's mark beside Continue with Google (Access drawing). */
function GoogleMark() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true" focusable="false">
      <path
        fill="#EA4335"
        d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.6 5.4 2.6 13.2l7.9 6.2C12.4 13.6 17.7 9.5 24 9.5z"
      />
      <path
        fill="#4285F4"
        d="M46.1 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.4c-.5 2.9-2.2 5.3-4.6 6.9l7.4 5.8c4.3-4 6.9-9.9 6.9-17.2z"
      />
      <path
        fill="#FBBC05"
        d="M10.5 28.6c-.5-1.4-.8-3-.8-4.6s.3-3.2.8-4.6l-7.9-6.2C.9 16.6 0 20.2 0 24s.9 7.4 2.6 10.8l7.9-6.2z"
      />
      <path
        fill="#34A853"
        d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.4-5.8c-2.1 1.4-4.8 2.3-8.5 2.3-6.3 0-11.6-4.1-13.5-9.8l-7.9 6.2C6.6 42.6 14.6 48 24 48z"
      />
    </svg>
  );
}
