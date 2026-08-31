import type { Session } from '@supabase/auth-js';
import { AuthClient } from '@supabase/auth-js';

import type { AuthOperationResult, AuthUser } from './operations';
import { authFailure, authSuccess } from './operations';
import {
  rejectProviderSession,
  sameProviderSession,
  sameProviderSessionLineage,
} from './providerSessionAcceptance';
import {
  isUncertainPasswordSave,
  mapProviderAuthError,
  normalizeEmail,
  type PublicAuthError,
} from './rev9Auth';

export type AccountCodePurpose = 'create' | 'recover';
export type AccountCodeRelationship = 'none' | 'same' | 'different';
export type AccountCodePasswordStatus = 'not-started' | 'saved' | 'already-set' | 'unknown';

export interface OrdinaryAccountSnapshot {
  session: Session;
  account: AuthUser;
}

interface OrdinaryAccountClient {
  getSession(): Promise<{ data: { session: Session | null }; error: unknown | null }>;
  setSessionIfUnchanged(
    expected: Session | null,
    tokens: { access_token: string; refresh_token: string },
  ): Promise<{
    changed: boolean;
    data: { session: Session | null };
    error: unknown | null;
  }>;
  clearSessionIfUnchanged(expected: Session): Promise<boolean>;
}

export async function readStableOrdinaryAccount(
  ordinary: Pick<OrdinaryAccountClient, 'getSession'>,
  validateSession: (session: Session) => Promise<AuthOperationResult<AuthUser>>,
): Promise<OrdinaryAccountSnapshot | null> {
  let current = await ordinary.getSession();
  if (current.error) throw current.error;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const session = current.data.session;
    if (!session) return null;
    const validated = await validateSession(session);
    if (!validated.ok) throw new Error('The open account could not be checked');
    const latest = await ordinary.getSession();
    if (latest.error) throw latest.error;
    if (sameProviderSession(latest.data.session, session)) {
      return { session, account: validated.data };
    }
    current = latest;
  }

  throw new Error('The open account changed while it was being checked');
}

export interface AccountCodeFinishOutcome {
  relationship: AccountCodeRelationship;
  passwordStatus: Exclude<AccountCodePasswordStatus, 'not-started'>;
  requiresAccountChoice: boolean;
  handedToOrdinaryClient: boolean;
}

export type AccountCodePasswordResult =
  | { ok: true; data: AccountCodeFinishOutcome }
  | {
      ok: false;
      error: PublicAuthError;
      canRetryPassword: boolean;
      passwordStatus: AccountCodePasswordStatus;
    };

export function accountCodeRelationship(
  ordinaryAccountId: string | null,
  targetAccountId: string,
): AccountCodeRelationship {
  if (!ordinaryAccountId) return 'none';
  return ordinaryAccountId === targetAccountId ? 'same' : 'different';
}

export async function requestAccountCode(
  client: InstanceType<typeof AuthClient>,
  email: string,
  emailRedirectTo: string,
): Promise<AuthOperationResult> {
  const safeEmail = normalizeEmail(email);
  try {
    const { error } = await client.signInWithOtp({
      email: safeEmail,
      options: { emailRedirectTo, shouldCreateUser: true },
    });
    return error ? authFailure(error, safeEmail) : authSuccess();
  } catch (error) {
    return authFailure(error, safeEmail);
  }
}

export async function verifyAccountCode(
  client: InstanceType<typeof AuthClient>,
  email: string,
  code: string,
): Promise<AuthOperationResult<Session>> {
  const safeEmail = normalizeEmail(email);
  try {
    const verified = await client.verifyOtp({
      email: safeEmail,
      token: code.trim(),
      type: 'email',
    });
    if (!verified.error && verified.data.session) return authSuccess(verified.data.session);

    const failure = mapProviderAuthError(verified.error, safeEmail);
    if (
      failure.kind === 'expired-or-used-link' ||
      failure.kind === 'bad-credentials' ||
      failure.kind === 'invalid-email'
    ) {
      return {
        ok: false,
        error: {
          kind: 'wrong-or-expired-code',
          message: 'That code is wrong or expired. Enter the newest code or send a new one.',
        },
      };
    }
    return { ok: false, error: failure };
  } catch (error) {
    return authFailure(error, safeEmail);
  }
}

function errorCode(error: unknown): string | null {
  if (!error || typeof error !== 'object') return null;
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' ? code : null;
}

function requestFailure(): PublicAuthError {
  return {
    kind: 'request-failure',
    message: 'We couldn’t complete that request. Check your connection and try again.',
  };
}

/**
 * One isolated client owns the proved-email session from code request through
 * the final explicit account choice. The ordinary saved session is read only
 * at the two decision points and is never replaced by surprise.
 */
export class AccountCodeAccessController {
  private session: Session | null = null;
  private account: AuthUser | null = null;
  private passwordStatus: AccountCodePasswordStatus = 'not-started';
  private pendingCompleted = false;
  private handedOff = false;
  private disposed = false;
  private invalid = false;
  private ordinaryMayBeRevoked = false;
  private ordinarySessionAtPasswordMutation: Session | null = null;
  private needsOtherSessionSignOut = false;
  private lastOutcome: AccountCodeFinishOutcome | null = null;
  private readonly pendingAbort = new AbortController();
  private ordinaryWrite: Promise<void> | null = null;
  private pendingOrdinaryHandoff: Session | null = null;
  private passwordMutation: Promise<void> | null = null;

  readonly email: string;

  constructor(
    readonly purpose: AccountCodePurpose,
    email: string,
    private readonly temporary: InstanceType<typeof AuthClient>,
    private readonly ordinary: OrdinaryAccountClient,
    private readonly validateSession: (session: Session) => Promise<AuthOperationResult<AuthUser>>,
    private readonly readOrdinaryAccount: () => Promise<OrdinaryAccountSnapshot | null>,
    private readonly completePending: (
      session: Session,
      signal: AbortSignal,
    ) => Promise<void> = async () => undefined,
  ) {
    this.email = normalizeEmail(email);
  }

  async request(emailRedirectTo: string): Promise<AuthOperationResult> {
    if (this.disposed) return authFailure(null, this.email);
    const result = await requestAccountCode(this.temporary, this.email, emailRedirectTo);
    return this.disposed ? authFailure(null, this.email) : result;
  }

  async verify(
    code: string,
  ): Promise<AuthOperationResult<{ session: Session; account: AuthUser }>> {
    if (this.invalid || this.disposed) return authFailure(null, this.email);
    if (!this.session) {
      const verified = await verifyAccountCode(this.temporary, this.email, code);
      if (!verified.ok) return verified;
      if (this.disposed) {
        await this.closeTemporarySession(verified.data);
        return authFailure(null, this.email);
      }
      this.session = verified.data;
      const returnedEmail = normalizeEmail(verified.data.user.email ?? '');
      if (!returnedEmail || returnedEmail !== this.email) {
        this.invalid = true;
        await this.dispose();
        return authFailure(null, this.email);
      }
    }

    if (!this.account) {
      const validated = await this.validateSession(this.session);
      if (this.disposed) {
        await this.closeTemporarySession();
        return authFailure(null, this.email);
      }
      if (!validated.ok) {
        if (validated.error.kind === 'deactivated') {
          this.invalid = true;
          await this.dispose();
        }
        return validated;
      }
      this.account = validated.data;
    }

    if (!this.pendingCompleted) {
      if (this.disposed) return authFailure(null, this.email);
      try {
        await this.completePending(this.session, this.pendingAbort.signal);
        if (this.disposed) {
          await this.closeTemporarySession();
          return authFailure(null, this.email);
        }
        this.pendingCompleted = true;
      } catch {
        return authFailure(null, this.email);
      }
    }

    return authSuccess({ session: this.session, account: this.account });
  }

  async savePassword(password: string): Promise<AccountCodePasswordResult> {
    if (this.disposed) return this.closedPasswordResult();
    if (!this.session || !this.account || this.passwordStatus !== 'not-started') {
      return this.finish();
    }

    let relationship: AccountCodeRelationship;
    let ordinaryBeforeSave: Session | null;
    let ordinaryProviderMatchesTarget = false;
    try {
      const ordinary = await this.readOrdinaryAccount();
      ordinaryBeforeSave = ordinary?.session ?? null;
      this.ordinarySessionAtPasswordMutation = ordinaryBeforeSave;
      relationship = accountCodeRelationship(ordinary?.account.id ?? null, this.account.id);
      ordinaryProviderMatchesTarget = ordinaryBeforeSave?.user.id === this.session.user.id;
      if (this.disposed) return this.closedPasswordResult();
    } catch {
      return {
        ok: false,
        error: requestFailure(),
        canRetryPassword: true,
        passwordStatus: this.passwordStatus,
      };
    }

    const mutation = this.runPasswordMutation(async () => {
      let updateError: unknown = null;
      try {
        const updated = await this.temporary.updateUser({ password });
        updateError = updated.error;
      } catch (error) {
        updateError = error;
      }
      if (this.disposed) {
        this.passwordStatus = 'unknown';
        if (
          ordinaryProviderMatchesTarget &&
          (!updateError || isUncertainPasswordSave(updateError))
        ) {
          await this.clearOrdinaryIfMatches(ordinaryBeforeSave);
        }
        await this.closeTemporarySession();
        return { updateError, closed: true };
      }
      return { updateError, closed: false };
    });
    const { updateError, closed } = await mutation;

    if (closed || this.disposed) return this.closedPasswordResult();

    if (!updateError) {
      this.passwordStatus = 'saved';
      this.ordinaryMayBeRevoked = ordinaryProviderMatchesTarget;
    } else if (errorCode(updateError) === 'same_password') {
      this.passwordStatus = 'already-set';
      if (this.purpose === 'recover') {
        this.needsOtherSessionSignOut = true;
        this.ordinaryMayBeRevoked = ordinaryProviderMatchesTarget;
      }
    } else if (isUncertainPasswordSave(updateError)) {
      this.passwordStatus = 'unknown';
      this.ordinaryMayBeRevoked = ordinaryProviderMatchesTarget;
    } else {
      return {
        ok: false,
        error: mapProviderAuthError(updateError, this.email, { passwordSave: true }),
        canRetryPassword: true,
        passwordStatus: this.passwordStatus,
      };
    }

    return this.finish();
  }

  async retryFinish(): Promise<AccountCodePasswordResult> {
    if (this.disposed) return this.closedPasswordResult();
    return this.finish();
  }

  /** Create changes nothing when its proved account is already open before password entry. */
  async finishCreateIfSameAccountOpen(): Promise<AuthOperationResult<boolean>> {
    if (this.purpose !== 'create' || !this.session || this.disposed) return authSuccess(false);
    try {
      const ordinary = await this.readOrdinaryAccount();
      if (this.disposed) return authFailure(null, this.email);
      if (!this.account || ordinary?.account.id !== this.account.id) return authSuccess(false);
      this.passwordStatus = 'already-set';
      const outcome: AccountCodeFinishOutcome = {
        relationship: 'same',
        passwordStatus: 'already-set',
        requiresAccountChoice: false,
        handedToOrdinaryClient: false,
      };
      this.lastOutcome = outcome;
      await this.dispose();
      return authSuccess(true);
    } catch (error) {
      return authFailure(error, this.email);
    }
  }

  async keepCurrentAccount(): Promise<void> {
    await this.dispose();
  }

  async switchAccount(): Promise<AuthOperationResult> {
    if (!this.session || this.disposed) return authFailure(null, this.email);
    return this.runOrdinaryWrite(this.session, async () => {
      let originalSession: Session | null = null;
      let savedSession: Session | null = null;
      try {
        originalSession = await this.readOrdinarySession();
        if (this.disposed) return authFailure(null, this.email);
        const handed = await this.ordinary.setSessionIfUnchanged(originalSession, {
          access_token: this.session!.access_token,
          refresh_token: this.session!.refresh_token,
        });
        if (handed.changed) return authFailure(null, this.email);
        const saved = handed.data.session ?? this.session!;
        savedSession = saved;
        if (handed.error) {
          await this.rollbackOrdinaryHandoff(saved, originalSession);
          await this.closeTemporarySession();
          return authFailure(handed.error, this.email);
        }
        this.pendingOrdinaryHandoff = saved;
        if (this.disposed) {
          await this.rollbackOrdinaryHandoff(saved, originalSession);
          await this.closeTemporarySession();
          return authFailure(null, this.email);
        }
        this.handedOff = true;
        return authSuccess();
      } catch (error) {
        if (savedSession) await this.rollbackOrdinaryHandoff(savedSession, originalSession);
        await this.closeTemporarySession();
        return authFailure(error, this.email);
      }
    });
  }

  async dispose(): Promise<void> {
    if (this.disposed || this.handedOff) return;
    this.disposed = true;
    if (this.pendingOrdinaryHandoff) rejectProviderSession(this.pendingOrdinaryHandoff);
    this.pendingAbort.abort();
    await this.closeTemporarySession();
    await this.passwordMutation;
    await this.ordinaryWrite;
  }

  get targetAccountId(): string | null {
    return this.account?.id ?? null;
  }

  get status(): AccountCodePasswordStatus {
    return this.passwordStatus;
  }

  private async readOrdinarySession(): Promise<Session | null> {
    const current = await this.ordinary.getSession();
    if (current.error) throw current.error;
    return current.data.session;
  }

  private async finish(): Promise<AccountCodePasswordResult> {
    if (this.disposed) return this.closedPasswordResult();
    if (this.handedOff && this.lastOutcome) return { ok: true, data: this.lastOutcome };
    if (!this.session || this.passwordStatus === 'not-started') {
      return {
        ok: false,
        error: requestFailure(),
        canRetryPassword: this.passwordStatus === 'not-started',
        passwordStatus: this.passwordStatus,
      };
    }
    const refreshed = await this.refreshTemporarySession();
    if (!refreshed) {
      return {
        ok: false,
        error: requestFailure(),
        canRetryPassword: false,
        passwordStatus: this.passwordStatus,
      };
    }
    const session = this.session;
    const passwordStatus = this.passwordStatus;

    if (this.needsOtherSessionSignOut) {
      try {
        const ordinaryBeforeOtherSessionSignOut = await this.readOrdinaryAccount();
        this.ordinarySessionAtPasswordMutation = ordinaryBeforeOtherSessionSignOut?.session ?? null;
        this.ordinaryMayBeRevoked = Boolean(
          this.ordinarySessionAtPasswordMutation?.user.id === session.user.id,
        );
        const signedOut = await this.temporary.signOut({ scope: 'others' });
        if (signedOut.error) throw signedOut.error;
        this.needsOtherSessionSignOut = false;
      } catch {
        return {
          ok: false,
          error: requestFailure(),
          canRetryPassword: false,
          passwordStatus: this.passwordStatus,
        };
      }
    }

    let relationship: AccountCodeRelationship;
    let ordinaryBeforeFinish: Session | null;
    try {
      const ordinary = await this.readOrdinaryAccount();
      ordinaryBeforeFinish = ordinary?.session ?? null;
      relationship = accountCodeRelationship(ordinary?.account.id ?? null, this.account!.id);
    } catch {
      return {
        ok: false,
        error: requestFailure(),
        canRetryPassword: false,
        passwordStatus,
      };
    }

    if (relationship === 'different') {
      this.lastOutcome = {
        relationship,
        passwordStatus: this.passwordStatus,
        requiresAccountChoice: true,
        handedToOrdinaryClient: false,
      };
      return { ok: true, data: this.lastOutcome };
    }

    const currentOrdinaryMayBeRevoked = Boolean(
      this.ordinaryMayBeRevoked &&
      ordinaryBeforeFinish &&
      this.ordinarySessionAtPasswordMutation &&
      sameProviderSessionLineage(ordinaryBeforeFinish, this.ordinarySessionAtPasswordMutation),
    );
    const keepSameOrdinary = relationship === 'same' && !currentOrdinaryMayBeRevoked;
    if (keepSameOrdinary) {
      await this.dispose();
      this.lastOutcome = {
        relationship,
        passwordStatus,
        requiresAccountChoice: false,
        handedToOrdinaryClient: false,
      };
      return { ok: true, data: this.lastOutcome };
    }

    return this.runOrdinaryWrite(session, async () => {
      try {
        if (this.disposed) return this.closedPasswordResult();
        const handed = await this.ordinary.setSessionIfUnchanged(ordinaryBeforeFinish, {
          access_token: session.access_token,
          refresh_token: session.refresh_token,
        });
        if (handed.changed) {
          return {
            ok: false,
            error: requestFailure(),
            canRetryPassword: false,
            passwordStatus,
          };
        }
        const saved = handed.data.session ?? session;
        if (handed.error) {
          rejectProviderSession(saved);
          await this.clearOrdinaryIfMatches(saved);
          if (relationship === 'same') await this.clearOrdinaryIfMatches(ordinaryBeforeFinish);
          await this.closeTemporarySession();
          return {
            ok: false,
            error: requestFailure(),
            canRetryPassword: false,
            passwordStatus,
          };
        }
        this.pendingOrdinaryHandoff = saved;
        if (this.disposed) {
          rejectProviderSession(saved);
          await this.clearOrdinaryIfMatches(saved);
          await this.closeTemporarySession();
          return this.closedPasswordResult();
        }
        this.handedOff = true;
        const outcome: AccountCodeFinishOutcome = {
          relationship,
          passwordStatus,
          requiresAccountChoice: false,
          handedToOrdinaryClient: true,
        };
        this.lastOutcome = outcome;
        return { ok: true as const, data: outcome };
      } catch {
        rejectProviderSession(session);
        await this.clearOrdinaryIfMatches(session);
        if (relationship === 'same') await this.clearOrdinaryIfMatches(ordinaryBeforeFinish);
        await this.closeTemporarySession();
        return {
          ok: false,
          error: requestFailure(),
          canRetryPassword: false,
          passwordStatus,
        };
      }
    });
  }

  private async runOrdinaryWrite<T>(session: Session, work: () => Promise<T>): Promise<T> {
    this.pendingOrdinaryHandoff = session;
    const operation = work();
    const settled = operation.then(
      () => undefined,
      () => undefined,
    );
    this.ordinaryWrite = settled;
    try {
      return await operation;
    } finally {
      if (this.ordinaryWrite === settled) this.ordinaryWrite = null;
      if (this.pendingOrdinaryHandoff === session) this.pendingOrdinaryHandoff = null;
    }
  }

  private async runPasswordMutation<T>(work: () => Promise<T>): Promise<T> {
    const operation = work();
    const settled = operation.then(
      () => undefined,
      () => undefined,
    );
    this.passwordMutation = settled;
    try {
      return await operation;
    } finally {
      if (this.passwordMutation === settled) this.passwordMutation = null;
    }
  }

  private async closeTemporarySession(session: Session | null = this.session): Promise<void> {
    if (!session) return;
    await this.temporary.signOut({ scope: 'local' }).catch(() => undefined);
  }

  private async refreshTemporarySession(): Promise<boolean> {
    const previous = this.session;
    if (!previous) return false;
    try {
      const current = await this.temporary.getSession();
      if (
        current.error ||
        !current.data.session ||
        !sameProviderSessionLineage(current.data.session, previous)
      ) {
        return false;
      }
      this.session = current.data.session;
      return true;
    } catch {
      return false;
    }
  }

  private async clearOrdinaryIfMatches(expected: Session | null): Promise<void> {
    if (!expected) return;
    rejectProviderSession(expected);
    await this.ordinary.clearSessionIfUnchanged(expected);
  }

  private async rollbackOrdinaryHandoff(saved: Session, original: Session | null): Promise<void> {
    rejectProviderSession(saved);
    try {
      if (!original) {
        await this.clearOrdinaryIfMatches(saved);
        return;
      }
      const restored = await this.ordinary.setSessionIfUnchanged(saved, {
        access_token: original.access_token,
        refresh_token: original.refresh_token,
      });
      if (!restored.changed && restored.error) await this.clearOrdinaryIfMatches(saved);
    } catch {
      await this.clearOrdinaryIfMatches(saved);
    }
  }

  private closedPasswordResult(): AccountCodePasswordResult {
    return {
      ok: false,
      error: requestFailure(),
      canRetryPassword: false,
      passwordStatus: this.passwordStatus,
    };
  }
}
