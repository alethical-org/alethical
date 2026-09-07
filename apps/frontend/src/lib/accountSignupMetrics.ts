export type SignupPeriod = {
  startsAt: string;
  endsAt: string;
  previousStartsAt: string;
  previousEndsAt: string;
};
export type AccountSignupTotals = {
  currentAccountsCreated: number;
  currentConfirmedAccounts: number;
  currentUnconfirmedAccounts: number;
  created7d: number;
  created30d: number;
  previousCreated7d: number;
  previousCreated30d: number;
  periods7d: SignupPeriod;
  periods30d: SignupPeriod;
  asOf: string;
  source: 'supabase';
  scope: 'current_surviving_reader_accounts';
  definition: string;
  historyLimitation: string;
};

export function isAccountSignupTotals(value: unknown): value is AccountSignupTotals {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const v = value as Record<string, unknown>;
  const counts = [
    'currentAccountsCreated',
    'currentConfirmedAccounts',
    'currentUnconfirmedAccounts',
    'created7d',
    'created30d',
    'previousCreated7d',
    'previousCreated30d',
  ];
  const keys = [
    ...counts,
    'periods7d',
    'periods30d',
    'asOf',
    'source',
    'scope',
    'definition',
    'historyLimitation',
  ];
  if (Object.keys(v).length !== keys.length || !keys.every((k) => Object.hasOwn(v, k)))
    return false;
  if (!counts.every((k) => Number.isSafeInteger(v[k]) && Number(v[k]) >= 0)) return false;
  if (
    Number(v.currentConfirmedAccounts) + Number(v.currentUnconfirmedAccounts) !==
    v.currentAccountsCreated
  )
    return false;
  if (
    Number(v.created7d) > Number(v.created30d) ||
    Number(v.created30d) > Number(v.currentAccountsCreated)
  )
    return false;
  const date = (x: unknown): x is string => typeof x === 'string' && Number.isFinite(Date.parse(x));
  for (const days of [7, 30]) {
    const p = v[`periods${days}d`];
    if (!p || typeof p !== 'object' || Array.isArray(p)) return false;
    const period = p as Record<string, unknown>;
    if (
      Object.keys(period).length !== 4 ||
      !['startsAt', 'endsAt', 'previousStartsAt', 'previousEndsAt'].every((k) => date(period[k]))
    )
      return false;
    if (
      Date.parse(String(period.endsAt)) - Date.parse(String(period.startsAt)) !== days * 86400000 ||
      Date.parse(String(period.previousEndsAt)) !== Date.parse(String(period.startsAt)) ||
      Date.parse(String(period.previousEndsAt)) - Date.parse(String(period.previousStartsAt)) !==
        days * 86400000
    )
      return false;
  }
  return (
    date(v.asOf) &&
    v.source === 'supabase' &&
    v.scope === 'current_surviving_reader_accounts' &&
    typeof v.definition === 'string' &&
    typeof v.historyLimitation === 'string'
  );
}
