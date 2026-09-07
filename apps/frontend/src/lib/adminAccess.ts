export type AdminAccessState = 'loading' | 'signed-out' | 'allowed' | 'restricted' | 'error';
export interface AdminAccessResult {
  userId: string;
  accessToken: string;
  state: AdminAccessState;
}

/** Do not show a previous account's permission, even before effects clean up. */
export function currentAdminAccess(
  result: AdminAccessResult | null,
  auth: { isLoading: boolean; isSignedIn: boolean; userId?: string; accessToken: string | null },
): AdminAccessState {
  if (auth.isLoading) return 'loading';
  if (!auth.isSignedIn || !auth.userId || !auth.accessToken) return 'signed-out';
  if (result?.userId !== auth.userId || result?.accessToken !== auth.accessToken) return 'loading';
  return result.state;
}

export function adminAccessFromPayload(payload: unknown): boolean {
  const data = (payload as { data?: { is_admin?: unknown } } | null)?.data;
  if (!data || typeof data.is_admin !== 'boolean') throw new Error('Invalid admin access');
  return data.is_admin;
}
