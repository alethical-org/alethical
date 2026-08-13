export type ResetAccountRelationship = 'none' | 'same' | 'different';

export interface ResetSignOutClient {
  signOut(options: { scope: 'others' | 'local' }): Promise<{ error: unknown | null }>;
}

/**
 * A reset session is removed only after the provider has handled its other
 * sessions. Any provider or local failure leaves the page on its retry screen.
 */
export async function finishResetSignOuts(
  temporary: ResetSignOutClient,
  ordinary: ResetSignOutClient | null,
  relationship: ResetAccountRelationship,
  clearOrdinarySession: (() => void | Promise<void>) | null = null,
): Promise<boolean> {
  try {
    const others = await temporary.signOut({ scope: 'others' });
    if (others.error) return false;
  } catch {
    return false;
  }

  // The link-only client never persists its session, so a hard load clears it
  // even when the provider cannot acknowledge this best-effort local close.
  await temporary.signOut({ scope: 'local' }).catch(() => undefined);

  if (relationship === 'same') {
    if (!ordinary) return false;
    try {
      const local = await ordinary.signOut({ scope: 'local' });
      if (local.error) await clearOrdinarySession?.();
    } catch {
      await clearOrdinarySession?.();
    }
  }
  return true;
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
