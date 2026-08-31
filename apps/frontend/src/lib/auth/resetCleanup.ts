export type ResetAccountRelationship = 'none' | 'same' | 'different';

export interface ResetSignOutClient {
  signOut(options: { scope: 'local' }): Promise<{ error: unknown | null }>;
}

export interface OrdinaryResetSessionClient<Session> {
  clearSessionIfUnchanged(expected: Session): Promise<boolean>;
}

/**
 * The password save IS the cleanup: Supabase's UpdatePassword runs
 * LogoutAllExceptMe inside the same transaction, unconditionally, so the reset
 * account's other sessions are already revoked and can never renew (verified at
 * supabase/auth pin 0fb56ca9 — internal/api/user.go L206–220 wraps
 * user.UpdatePassword in db.Transaction, internal/models/user.go L434–463 runs
 * LogoutAllExceptMe on that same tx; proven live on this project, #1533).
 *
 * The client's remaining work is two local clears, and nothing here can fail in
 * a way worth a screen: this browser's own reset session, and — for a
 * SAME-account reset — the stored ordinary session too, because production
 * saves sessions to storage and restores them on load, so an uncleared
 * same-account session would come back looking signed in until its access pass
 * expires. A different account's session is untouched.
 */
export async function finishResetSignOuts<Session>(
  temporary: ResetSignOutClient,
  ordinary: OrdinaryResetSessionClient<Session> | null,
  relationship: ResetAccountRelationship,
  ordinarySession: Session | null = null,
): Promise<void> {
  // The link-only client never persists its session, so the hard load clears it
  // even when the provider cannot acknowledge this best-effort local close.
  await temporary.signOut({ scope: 'local' }).catch(() => undefined);

  if (relationship === 'same') {
    if (ordinary && ordinarySession) {
      await ordinary.clearSessionIfUnchanged(ordinarySession).catch(() => false);
    }
  }
}

/** A successful password change is never sent to the provider a second time. */
export async function updatePasswordOnce(
  completed: { current: boolean },
  update: () => Promise<{ error: unknown | null }>,
): Promise<{ error: unknown | null }> {
  if (completed.current) return { error: null };
  try {
    const result = await update();
    if (!result.error) completed.current = true;
    return { error: result.error };
  } catch (error) {
    return { error };
  }
}
