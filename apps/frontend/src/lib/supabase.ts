import { AppState, Platform } from 'react-native';
import 'react-native-url-polyfill/auto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient, processLock } from '@supabase/supabase-js';
import * as WebBrowser from 'expo-web-browser';
import { clearStoredProviderSession } from './auth/sessionSafety';

WebBrowser.maybeCompleteAuthSession();

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
const supabasePublishableKey = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? '';

export const isSupabaseConfigured = Boolean(supabaseUrl && supabasePublishableKey);

export const supabaseAuthConfig = {
  url: supabaseUrl || 'http://localhost:54321',
  publishableKey: supabasePublishableKey || 'missing-publishable-key',
} as const;
const authStorageKey = `sb-${new URL(supabaseAuthConfig.url).hostname.split('.')[0]}-auth-token`;

/** Remove a provider session that Alethical has already proved is unsafe. */
export async function clearStoredSupabaseSession() {
  if (Platform.OS === 'web') {
    try {
      await clearStoredProviderSession(window.localStorage, authStorageKey);
    } catch {
      // If browser storage is unavailable, no durable browser session can survive.
    }
    return;
  }
  try {
    await clearStoredProviderSession(AsyncStorage, authStorageKey);
  } catch {
    // If device storage is unavailable, no durable device session can survive.
  }
}

export const supabase = createClient(supabaseAuthConfig.url, supabaseAuthConfig.publishableKey, {
  auth: {
    ...(Platform.OS !== 'web' ? { storage: AsyncStorage } : {}),
    storageKey: authStorageKey,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: Platform.OS === 'web',
    flowType: 'pkce',
    lock: processLock,
  },
});

if (Platform.OS !== 'web') {
  AppState.addEventListener('change', (state) => {
    if (state === 'active') {
      supabase.auth.startAutoRefresh();
    } else {
      supabase.auth.stopAutoRefresh();
    }
  });
}
