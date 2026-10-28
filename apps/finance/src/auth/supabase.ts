import { createClient, type SupabaseClient } from '@supabase/supabase-js';

import type { FinanceConfig } from '../config';

/** Finance keeps its own saved session under its own storage key. */
export const STORAGE_KEY = 'alethical-finance-auth';

export function createFinanceSupabase(config: FinanceConfig): SupabaseClient {
  return createClient(config.supabaseUrl, config.supabasePublishableKey, {
    auth: {
      flowType: 'pkce',
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      storageKey: STORAGE_KEY,
    },
  });
}
