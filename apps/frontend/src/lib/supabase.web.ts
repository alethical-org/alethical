import { AuthClient, processLock } from '@supabase/auth-js';

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
const supabasePublishableKey = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? '';

export const isSupabaseConfigured = Boolean(supabaseUrl && supabasePublishableKey);

const clientUrl = supabaseUrl || 'http://localhost:54321';
const clientKey = supabasePublishableKey || 'missing-publishable-key';
const baseUrl = new URL(`${clientUrl.replace(/\/+$/, '')}/`);

export const supabase = {
  auth: new AuthClient({
    url: new URL('auth/v1', baseUrl).toString(),
    headers: {
      Authorization: `Bearer ${clientKey}`,
      apikey: clientKey,
    },
    storageKey: `sb-${baseUrl.hostname.split('.')[0]}-auth-token`,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: true,
    flowType: 'pkce',
    lock: processLock,
  }),
};
