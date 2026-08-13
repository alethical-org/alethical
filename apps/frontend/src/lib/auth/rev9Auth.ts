export const MIN_PASSWORD_LENGTH = 15;

export const REV9_AUTH_MESSAGES = {
  badCredentials: 'Email or password is incorrect.',
  invalidEmail: 'Enter a complete email address, like name@example.com.',
  passwordTooShort: 'Use at least 15 characters. A few words with spaces works well.',
  passwordMismatch: 'Passwords do not match.',
  leakedPassword: 'Choose a password that hasn’t appeared in a known data breach.',
  tooManyAttempts: 'Too many attempts. Wait a while, then try again.',
  requestFailure: 'We couldn’t complete that request. Check your connection and try again.',
  expiredOrUsedLink: 'This link has expired or has already been used.',
  matchFailed:
    'We couldn’t safely match this sign-in to your account. Sign in with the method you used before.',
  humanCheck: 'One more step — confirm you’re human, then press the button again.',
} as const;

const COMPLETE_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Keep every auth request and Alethical account match on the same email form. */
export function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

export function validateEmail(value: string): string | null {
  return COMPLETE_EMAIL.test(normalizeEmail(value)) ? null : REV9_AUTH_MESSAGES.invalidEmail;
}

/** Supabase owns the remaining password checks, including known-breach screening. */
export function validatePassword(value: string): string | null {
  return value.length >= MIN_PASSWORD_LENGTH ? null : REV9_AUTH_MESSAGES.passwordTooShort;
}

export function validatePasswordMatch(password: string, confirmation: string): string | null {
  return password === confirmation ? null : REV9_AUTH_MESSAGES.passwordMismatch;
}

interface ProviderAuthErrorLike {
  code?: unknown;
  reasons?: unknown;
}

export type PublicAuthErrorKind =
  | 'bad-credentials'
  | 'email-not-confirmed'
  | 'invalid-email'
  | 'weak-password'
  | 'leaked-password'
  | 'too-many-attempts'
  | 'expired-or-used-link'
  | 'match-failed'
  | 'deactivated'
  | 'human-check'
  | 'fresh-proof'
  | 'check-email'
  | 'request-failure';

export interface PublicAuthError {
  kind: PublicAuthErrorKind;
  message: string;
}

const BAD_CREDENTIAL_CODES = new Set([
  'invalid_credentials',
  'user_not_found',
  'user_banned',
  'email_provider_disabled',
  'provider_disabled',
]);

const RATE_LIMIT_CODES = new Set([
  'over_request_rate_limit',
  'over_email_send_rate_limit',
  'over_sms_send_rate_limit',
]);

const DEAD_LINK_CODES = new Set([
  'otp_expired',
  'otp_disabled',
  'flow_state_not_found',
  'flow_state_expired',
  'refresh_token_already_used',
]);

function errorCode(error: unknown): string | null {
  if (!error || typeof error !== 'object') return null;
  const code = (error as ProviderAuthErrorLike).code;
  return typeof code === 'string' ? code : null;
}

function weakPasswordReasons(error: unknown): string[] {
  if (!error || typeof error !== 'object') return [];
  const reasons = (error as ProviderAuthErrorLike).reasons;
  return Array.isArray(reasons)
    ? reasons.filter((reason): reason is string => typeof reason === 'string')
    : [];
}

/**
 * Turn provider failures into the fixed rev 9 messages. The provider's own
 * message is deliberately never read, so account details and internal errors
 * cannot reach the screen.
 */
export function mapProviderAuthError(error: unknown, email?: string): PublicAuthError {
  const code = errorCode(error);
  const safeEmail = email ? normalizeEmail(email) : '';

  if (code && BAD_CREDENTIAL_CODES.has(code)) {
    return { kind: 'bad-credentials', message: REV9_AUTH_MESSAGES.badCredentials };
  }
  if (code === 'email_not_confirmed') {
    return {
      kind: 'email-not-confirmed',
      message: safeEmail
        ? `Confirm ${safeEmail} before signing in.`
        : 'Confirm your email before signing in.',
    };
  }
  if (code === 'email_address_invalid' || code === 'validation_failed') {
    return { kind: 'invalid-email', message: REV9_AUTH_MESSAGES.invalidEmail };
  }
  if (code === 'weak_password') {
    return weakPasswordReasons(error).includes('pwned')
      ? { kind: 'leaked-password', message: REV9_AUTH_MESSAGES.leakedPassword }
      : { kind: 'weak-password', message: REV9_AUTH_MESSAGES.passwordTooShort };
  }
  if (code && RATE_LIMIT_CODES.has(code)) {
    return { kind: 'too-many-attempts', message: REV9_AUTH_MESSAGES.tooManyAttempts };
  }
  if (code && DEAD_LINK_CODES.has(code)) {
    return { kind: 'expired-or-used-link', message: REV9_AUTH_MESSAGES.expiredOrUsedLink };
  }
  if (
    code === 'provider_email_needs_verification' ||
    code === 'identity_already_exists' ||
    code === 'email_conflict_identity_not_deletable'
  ) {
    return { kind: 'match-failed', message: REV9_AUTH_MESSAGES.matchFailed };
  }
  if (code === 'captcha_failed') {
    return { kind: 'human-check', message: REV9_AUTH_MESSAGES.humanCheck };
  }
  if (code === 'reauthentication_needed') {
    return {
      kind: 'fresh-proof',
      message: safeEmail
        ? `Enter the code we sent to ${safeEmail} to confirm it’s you.`
        : 'Enter the code we sent to confirm it’s you.',
    };
  }
  if (code === 'email_exists' || code === 'user_already_exists') {
    return {
      kind: 'check-email',
      message: safeEmail
        ? `If this address can create an Alethical account, a confirmation link is on the way to ${safeEmail}.`
        : 'If this address can create an Alethical account, a confirmation link is on the way.',
    };
  }
  return { kind: 'request-failure', message: REV9_AUTH_MESSAGES.requestFailure };
}

/** Lock before a framework redraw, but only after local validation passes. */
export function createValidRequestGate() {
  let locked = false;
  return {
    tryStart(isValid: boolean): boolean {
      if (!isValid || locked) return false;
      locked = true;
      return true;
    },
    reset(): void {
      locked = false;
    },
    isLocked(): boolean {
      return locked;
    },
  };
}

const INTERNAL_PATH_ORIGIN = 'https://internal.alethical.invalid';

/** Accept one leading slash and reject paths browsers could treat as another website. */
export function isSafeInternalPath(value: string): boolean {
  if (!value.startsWith('/') || value.startsWith('//') || value.startsWith('/\\')) return false;
  if (/[\\\u0000-\u001f\u007f]/.test(value)) return false;

  try {
    const url = new URL(value, INTERNAL_PATH_ORIGIN);
    if (url.origin !== INTERNAL_PATH_ORIGIN) return false;
    const decodedPath = decodeURIComponent(url.pathname);
    return (
      decodedPath.startsWith('/') &&
      !decodedPath.startsWith('//') &&
      !decodedPath.startsWith('/\\') &&
      !decodedPath.includes('\\')
    );
  } catch {
    return false;
  }
}
