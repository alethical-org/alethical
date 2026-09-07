/** Private account data has no public fallback and never enters a shared query cache. */
export type AdminUserStatus = 'all' | 'confirmed' | 'pending';
export type AdminCreatedWithinDays = 7 | 30 | null;

export interface AdminUsersSearch {
  query: string;
  status: AdminUserStatus;
  created_within_days: AdminCreatedWithinDays;
  offset: number;
  limit: number;
}

export interface AdminUser {
  id: string;
  email: string | null;
  created_at: string;
  confirmed_at: string | null;
  sign_in_methods: string[];
}

export interface AdminUsersResult {
  data: AdminUser[];
  summary: {
    confirmed_accounts: number;
    pending_accounts: number;
    confirmed_today: number;
    confirmed_7d: number;
    confirmed_30d: number;
  };
  page: { offset: number; limit: number; total: number; has_more: boolean };
  as_of: string;
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Invalid admin response');
  return value as Record<string, unknown>;
}

function count(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0)
    throw new Error('Invalid admin count');
  return value;
}

function timestamp(value: unknown): string {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value)))
    throw new Error('Invalid admin date');
  return value;
}

/** Reject incomplete replies rather than turn missing data into convincing zeros. */
export function adminUsersFromPayload(payload: unknown): AdminUsersResult {
  const root = object(payload);
  const summary = object(root.summary);
  const page = object(root.page);
  if (!Array.isArray(root.data) || typeof page.has_more !== 'boolean')
    throw new Error('Invalid admin response');
  const data = root.data.map((value): AdminUser => {
    const row = object(value);
    if (
      typeof row.id !== 'string' ||
      !row.id ||
      (row.email !== null && typeof row.email !== 'string') ||
      !Array.isArray(row.sign_in_methods) ||
      row.sign_in_methods.some((method) => typeof method !== 'string')
    )
      throw new Error('Invalid admin account');
    return {
      id: row.id,
      email: row.email as string | null,
      created_at: timestamp(row.created_at),
      confirmed_at: row.confirmed_at === null ? null : timestamp(row.confirmed_at),
      sign_in_methods: [...row.sign_in_methods],
    };
  });
  const limit = count(page.limit);
  if (limit === 0) throw new Error('Invalid admin page');
  return {
    data,
    summary: {
      confirmed_accounts: count(summary.confirmed_accounts),
      pending_accounts: count(summary.pending_accounts),
      confirmed_today: count(summary.confirmed_today),
      confirmed_7d: count(summary.confirmed_7d),
      confirmed_30d: count(summary.confirmed_30d),
    },
    page: { offset: count(page.offset), limit, total: count(page.total), has_more: page.has_more },
    as_of: timestamp(root.as_of),
  };
}

export function adminSignInMethods(methods: string[]): string {
  return (
    methods
      .map((method) => (method === 'google' ? 'Google' : method === 'email' ? 'Email' : method))
      .join(', ') || 'Not available'
  );
}

export function adminAccountDate(value: string): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Chicago',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(value));
}
