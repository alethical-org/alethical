import { AuthClient } from '@supabase/auth-js';
import type { Session } from '@supabase/auth-js';

import { rejectProviderSession, sameProviderSessionLineage } from './providerSessionAcceptance';

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
export type RequestedSignInScreen = 'create' | 'recover' | 'sign-in';

export interface RequestedSignInState {
  screen: RequestedSignInScreen | undefined;
  cleanHash: string;
}

/** Expired links may start account recovery without closing a different open account. */
export function canOpenRequestedSignInScreen(
  screen: string | undefined,
  isSignedIn: boolean,
): boolean {
  if (!screen) return false;
  return !isSignedIn || screen === 'create' || screen === 'recover';
}

/** A non-secret address fallback keeps the requested screen when storage is blocked. */
export function requestedSignInState(
  storedScreen: string | null,
  hash: string,
): RequestedSignInState {
  const parameters = new URLSearchParams(hash.replace(/^#/, ''));
  const hashScreen = parameters.get('auth_screen');
  const requested = storedScreen ?? hashScreen;
  const screen =
    requested === 'forgot' || requested === 'recover'
      ? 'recover'
      : requested === 'create'
        ? 'create'
        : requested === 'sign-in'
          ? 'sign-in'
          : undefined;

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

export function temporarySessionRelationship(
  ordinaryAccountId: string | null,
  temporaryAccountId: string,
): TemporarySessionRelationship {
  if (!ordinaryAccountId) return 'none';
  return ordinaryAccountId === temporaryAccountId ? 'same' : 'different';
}

/**
 * Before the confirmation-time password guard is live, an old signup link may
 * still have the password the reader chose before confirming. Supabase reports
 * that exact re-entry as `same_password`; no other link kind earns this narrow
 * compatibility exception.
 */
export function legacyConfirmationPasswordMatches(
  route: EmailLinkRoute,
  verificationType: string | null,
  error: unknown,
): boolean {
  if (route !== 'confirm' || (verificationType !== 'signup' && verificationType !== 'email')) {
    return false;
  }
  if (!error || typeof error !== 'object') return false;
  return (error as { code?: unknown }).code === 'same_password';
}

/**
 * Do not clear the temporary session after handing its refresh token to the
 * ordinary client. A local Supabase sign-out would revoke that handed-off token.
 */
export function decideTemporarySessionAfterPassword({
  ordinaryAccountId,
  ordinaryProviderUserId,
  ordinaryProviderSessionWasCurrent = true,
  passwordChanged = true,
  temporaryAccountId,
  temporaryProviderUserId,
}: {
  ordinaryAccountId: string | null;
  ordinaryProviderUserId: string | null;
  ordinaryProviderSessionWasCurrent?: boolean;
  passwordChanged?: boolean;
  temporaryAccountId: string;
  temporaryProviderUserId: string;
}): TemporarySessionCleanupDecision {
  const relationship = temporarySessionRelationship(ordinaryAccountId, temporaryAccountId);
  const ordinaryProviderSessionWasRevoked =
    passwordChanged &&
    ordinaryProviderSessionWasCurrent &&
    ordinaryProviderUserId !== null &&
    ordinaryProviderUserId === temporaryProviderUserId;

  if (relationship === 'none' || ordinaryProviderSessionWasRevoked) {
    return {
      relationship,
      handToOrdinaryClient: true,
      clearTemporarySession: false,
    };
  }
  return {
    relationship,
    handToOrdinaryClient: false,
    clearTemporarySession: true,
  };
}

interface OrdinarySessionClient {
  setSessionIfUnchanged(
    expected: PasswordSession | null,
    tokens: { access_token: string; refresh_token: string },
  ): Promise<{
    changed: boolean;
    data: { session: PasswordSession | null };
    error: unknown | null;
  }>;
  clearSessionIfUnchanged(expected: PasswordSession): Promise<boolean>;
}

interface TemporarySessionClient {
  signOut(options: { scope: 'local' }): Promise<{ error: unknown | null }>;
}

interface PasswordSession {
  access_token: string;
  refresh_token: string;
  user: { id: string };
}

/**
 * Product account IDs decide what the reader sees. Provider user IDs decide
 * whether the password save revoked the exact ordinary session. Hand the
 * surviving temporary session over only when no account is open or that saved
 * provider session was revoked.
 */
export async function finishTemporarySessionAfterPassword({
  ordinary,
  ordinaryAccountId,
  ordinaryProviderUserId,
  ordinarySession,
  ordinarySessionAtPasswordMutation,
  passwordChanged,
  session,
  temporaryAccountId,
  temporary,
}: {
  ordinary: OrdinarySessionClient;
  ordinaryAccountId: string | null;
  ordinaryProviderUserId: string | null;
  ordinarySession: PasswordSession | null;
  ordinarySessionAtPasswordMutation?: PasswordSession | null;
  passwordChanged: boolean;
  session: PasswordSession;
  temporaryAccountId: string;
  temporary: TemporarySessionClient;
}): Promise<{ relationship: TemporarySessionRelationship; error: unknown | null }> {
  const sessionAtPasswordMutation =
    ordinarySessionAtPasswordMutation === undefined
      ? ordinarySession
      : ordinarySessionAtPasswordMutation;
  const decision = decideTemporarySessionAfterPassword({
    ordinaryAccountId,
    ordinaryProviderUserId,
    ordinaryProviderSessionWasCurrent: Boolean(
      ordinarySession &&
      sessionAtPasswordMutation &&
      sameProviderSessionLineage(ordinarySession as Session, sessionAtPasswordMutation as Session),
    ),
    passwordChanged,
    temporaryAccountId,
    temporaryProviderUserId: session.user.id,
  });
  if (decision.handToOrdinaryClient) {
    try {
      const handed = await ordinary.setSessionIfUnchanged(ordinarySession, {
        access_token: session.access_token,
        refresh_token: session.refresh_token,
      });
      if (handed.changed) {
        return {
          relationship: decision.relationship,
          error: new Error('The open account changed'),
        };
      }
      const saved = handed.data.session ?? session;
      if (handed.error) {
        rejectProviderSession(saved as Session);
        await ordinary.clearSessionIfUnchanged(saved);
        if (ordinarySession) await ordinary.clearSessionIfUnchanged(ordinarySession);
      }
      return { relationship: decision.relationship, error: handed.error };
    } catch (error) {
      rejectProviderSession(session as Session);
      await ordinary.clearSessionIfUnchanged(session);
      if (ordinarySession) await ordinary.clearSessionIfUnchanged(ordinarySession);
      return { relationship: decision.relationship, error };
    }
  }

  await temporary.signOut({ scope: 'local' }).catch(() => undefined);
  return { relationship: decision.relationship, error: null };
}
