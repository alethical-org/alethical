import type { Session } from '@supabase/auth-js';
import { AuthClient } from '@supabase/auth-js';

import type { AuthOperationResult, AuthUser } from './operations';
import { authFailure, authSuccess } from './operations';
import { rejectProviderSession, sameProviderSessionLineage } from './providerSessionAcceptance';
import { normalizeEmail } from './rev9Auth';

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

/**
 * Passwords are checked in an isolated client. The ordinary saved account is
 * changed only after Alethical validates the result and only while this exact
 * dialog request still owns the handoff.
 */
export class PasswordSignInController {
  private session: Session | null = null;
  private disposed = false;
  private handedOff = false;
  private ordinaryWrite: Promise<void> | null = null;
  private pendingOrdinaryHandoff: Session | null = null;

  constructor(
    private readonly temporary: InstanceType<typeof AuthClient>,
    private readonly ordinary: OrdinaryAccountClient,
    private readonly validateSession: (session: Session) => Promise<AuthOperationResult<AuthUser>>,
  ) {}

  async signIn(email: string, password: string): Promise<AuthOperationResult<AuthUser>> {
    const safeEmail = normalizeEmail(email);
    let signedIn: Awaited<ReturnType<InstanceType<typeof AuthClient>['signInWithPassword']>>;
    try {
      signedIn = await this.temporary.signInWithPassword({ email: safeEmail, password });
    } catch (error) {
      return authFailure(error, safeEmail);
    }
    if (signedIn.error || !signedIn.data.session) {
      return authFailure(signedIn.error, safeEmail);
    }
    this.session = signedIn.data.session;
    if (this.disposed) {
      await this.closeTemporarySession();
      return authFailure(null, safeEmail);
    }

    const validated = await this.validateSession(this.session);
    if (this.disposed) {
      await this.closeTemporarySession();
      return authFailure(null, safeEmail);
    }
    if (!validated.ok) {
      await this.closeTemporarySession();
      return validated;
    }

    let ordinaryBefore: Session | null;
    try {
      const current = await this.ordinary.getSession();
      if (current.error) throw current.error;
      ordinaryBefore = current.data.session;
    } catch (error) {
      await this.closeTemporarySession();
      return authFailure(error, safeEmail);
    }
    if (this.disposed) {
      await this.closeTemporarySession();
      return authFailure(null, safeEmail);
    }

    // A newer sign-in in this or another tab wins. Never replace it with this
    // older request after its password and account checks finally return.
    if (ordinaryBefore) {
      await this.closeTemporarySession();
      return authSuccess(validated.data);
    }

    return this.runOrdinaryWrite(this.session, async () => {
      const target = this.session!;
      try {
        const handed = await this.ordinary.setSessionIfUnchanged(ordinaryBefore, {
          access_token: target.access_token,
          refresh_token: target.refresh_token,
        });
        if (handed.changed) {
          await this.closeTemporarySession();
          return authSuccess(validated.data);
        }
        const saved = handed.data.session ?? target;
        if (handed.error) {
          rejectProviderSession(saved);
          await this.clearOrdinaryIfMatches(saved);
          await this.closeTemporarySession();
          return authFailure(handed.error, safeEmail);
        }
        this.pendingOrdinaryHandoff = saved;
        if (this.disposed) {
          rejectProviderSession(saved);
          await this.clearOrdinaryIfMatches(saved);
          await this.closeTemporarySession();
          return authFailure(null, safeEmail);
        }

        const current = await this.ordinary.getSession().catch(() => null);
        if (this.disposed) {
          rejectProviderSession(saved);
          await this.clearOrdinaryIfMatches(saved);
          await this.closeTemporarySession();
          return authFailure(null, safeEmail);
        }
        if (current && !current.error && !sameProviderSessionLineage(current.data.session, saved)) {
          await this.closeTemporarySession();
          return authSuccess(validated.data);
        }
        this.handedOff = true;
        return authSuccess(validated.data);
      } catch (error) {
        await this.closeTemporarySession();
        return authFailure(error, safeEmail);
      }
    });
  }

  async dispose(): Promise<void> {
    if (this.disposed || this.handedOff) return;
    this.disposed = true;
    if (this.pendingOrdinaryHandoff) rejectProviderSession(this.pendingOrdinaryHandoff);
    await this.closeTemporarySession();
    await this.ordinaryWrite;
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

  private async closeTemporarySession(): Promise<void> {
    if (!this.session || this.handedOff) return;
    await this.temporary.signOut({ scope: 'local' }).catch(() => undefined);
  }

  private async clearOrdinaryIfMatches(expected: Session): Promise<void> {
    rejectProviderSession(expected);
    await this.ordinary.clearSessionIfUnchanged(expected);
  }
}
