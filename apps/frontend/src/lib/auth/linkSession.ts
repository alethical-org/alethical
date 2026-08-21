import { AuthClient } from '@supabase/auth-js';

export type EmailLinkVerificationType = 'signup' | 'email' | 'recovery';

export interface EmailLinkMemoryData {
  tokenHash: string;
  type: EmailLinkVerificationType;
}

export interface ParsedEmailLink {
  link: EmailLinkMemoryData | null;
  cleanPath: string;
}

export type EmailLinkRoute = 'confirm' | 'reset';
export type RequestedSignInScreen = 'forgot' | 'sign-in';

export interface RequestedSignInState {
  screen: RequestedSignInScreen | undefined;
  cleanHash: string;
}

/** A non-secret address fallback keeps the requested screen when storage is blocked. */
export function requestedSignInState(
  storedScreen: string | null,
  hash: string,
): RequestedSignInState {
  const parameters = new URLSearchParams(hash.replace(/^#/, ''));
  const hashScreen = parameters.get('auth_screen');
  const requested = storedScreen ?? hashScreen;
  const screen = requested === 'forgot' || requested === 'sign-in' ? requested : undefined;

  // Nothing of ours in the fragment, so hand it back exactly as it arrived. It
  // is only a set of key=value pairs when we put them there; an ordinary
  // section link like #the-one-way-valve is one plain word, and re-serializing
  // it through URLSearchParams turns it into #the-one-way-valve=, which names
  // no section on the page (report contents rail).
  if (hashScreen === null) {
    return { screen, cleanHash: hash };
  }

  parameters.delete('auth_screen');
  return { screen, cleanHash: parameters.size ? `#${parameters.toString()}` : '' };
}

/**
 * Keep every email-link value after `#`. Browser fragments never leave the
 * device in the request sent to Alethical or Vercel.
 */
export function buildEmailLinkRedirectUrl(
  origin: string,
  route: EmailLinkRoute,
  pendingReference?: string,
): string {
  const url = new URL(`/${route}`, origin);
  const fragment = new URLSearchParams({ auth_action: route });
  if (pendingReference) fragment.set('pending', pendingReference);
  url.hash = fragment.toString();
  return url.toString();
}

const AUTH_ADDRESS_KEYS = [
  'token_hash',
  'token',
  'type',
  'code',
  'code_verifier',
  'access_token',
  'refresh_token',
  'provider_token',
  'provider_refresh_token',
  'error',
  'error_code',
  'error_description',
] as const;

function parameterHash(hash: string): URLSearchParams | null {
  const raw = hash.replace(/^#/, '');
  return raw.includes('=') ? new URLSearchParams(raw) : null;
}

/**
 * Copy the one-use secret into returned memory data, then return a path with
 * auth details removed. Callers can replace the visible address before render.
 */
export function parseEmailLinkUrl(href: string, expectedOrigin: string): ParsedEmailLink {
  const expected = new URL(expectedOrigin).origin;
  const url = new URL(href, expected);
  if (url.origin !== expected) {
    throw new Error('Email links must use the same Alethical origin.');
  }

  const hashParameters = parameterHash(url.hash);
  const rawHash = url.hash.replace(/^#/, '');
  const hashContainsAuthDetails = AUTH_ADDRESS_KEYS.some(
    (key) =>
      rawHash.startsWith(`${key}=`) || rawHash.includes(`&${key}=`) || rawHash.includes(`?${key}=`),
  );
  const hashUsesParameterShape =
    hashParameters !== null &&
    !rawHash.includes('?') &&
    AUTH_ADDRESS_KEYS.some((key) => hashParameters.has(key));
  // Query values have already reached the web server and its logs. Scrub them,
  // but accept a one-use token only from the private browser fragment.
  const tokenHash = hashParameters?.get('token_hash') ?? '';
  const rawType = hashParameters?.get('type') ?? '';
  const type: EmailLinkVerificationType | null =
    rawType === 'signup' || rawType === 'email' || rawType === 'recovery' ? rawType : null;

  for (const key of AUTH_ADDRESS_KEYS) {
    url.searchParams.delete(key);
    hashParameters?.delete(key);
  }
  if (hashContainsAuthDetails && !hashUsesParameterShape) {
    url.hash = '';
  } else if (hashParameters) {
    const cleanHash = hashParameters.toString();
    url.hash = cleanHash ? `#${cleanHash}` : '';
  }

  return {
    link: tokenHash && type ? { tokenHash, type } : null,
    cleanPath: `${url.pathname}${url.search}${url.hash}`,
  };
}

export const TEMPORARY_AUTH_STORAGE_PREFIX = 'alethical-link-session-';

type AuthClientOptions = ConstructorParameters<typeof AuthClient>[0];

function uniqueStorageSuffix(): string {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

export function buildTemporaryAuthClientOptions(
  supabaseUrl: string,
  publishableKey: string,
): AuthClientOptions {
  const baseUrl = new URL(`${supabaseUrl.replace(/\/+$/, '')}/`);
  return {
    url: new URL('auth/v1', baseUrl).toString(),
    headers: {
      Authorization: `Bearer ${publishableKey}`,
      apikey: publishableKey,
    },
    storageKey: `${TEMPORARY_AUTH_STORAGE_PREFIX}${uniqueStorageSuffix()}`,
    autoRefreshToken: false,
    persistSession: false,
    detectSessionInUrl: false,
    flowType: 'pkce',
  };
}

/** A separate client that cannot inspect or replace the ordinary saved session. */
export function createTemporaryAuthClient(
  supabaseUrl: string,
  publishableKey: string,
): InstanceType<typeof AuthClient> {
  return new AuthClient(buildTemporaryAuthClientOptions(supabaseUrl, publishableKey));
}

export type TemporarySessionRelationship = 'none' | 'same' | 'different';

export interface TemporarySessionCleanupDecision {
  relationship: TemporarySessionRelationship;
  handToOrdinaryClient: boolean;
  clearTemporarySession: boolean;
}

/**
 * Do not clear the temporary session after handing its refresh token to the
 * ordinary client. A local Supabase sign-out would revoke that handed-off token.
 */
export function decideTemporarySessionCleanup(
  ordinaryUserId: string | null,
  temporaryUserId: string,
): TemporarySessionCleanupDecision {
  if (!ordinaryUserId) {
    return {
      relationship: 'none',
      handToOrdinaryClient: true,
      clearTemporarySession: false,
    };
  }
  return {
    relationship: ordinaryUserId === temporaryUserId ? 'same' : 'different',
    handToOrdinaryClient: false,
    clearTemporarySession: true,
  };
}
