import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AuthClient, navigatorLock, processLock } from '@supabase/auth-js';
import { createClient } from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';

import { supabase, webAuthLock } from '../supabase.web';

const here = dirname(fileURLToPath(import.meta.url));

function source(relativePath: string) {
  return readFileSync(resolve(here, relativePath), 'utf8');
}

describe('the web authentication boundary', () => {
  it('keeps phone redirect helpers out of the web provider', () => {
    const webProvider = source('../../providers/AuthProvider.web.tsx');

    expect(webProvider).not.toContain('expo-auth-session');
    expect(webProvider).not.toContain('expo-web-browser');
    expect(webProvider).not.toContain("from 'react-native'");
    expect(webProvider).toContain('skipBrowserRedirect: false');
  });

  it('keeps phone storage and URL helpers out of the web client', () => {
    const webClient = source('../supabase.web.ts');

    expect(webClient).toContain("from '@supabase/auth-js'");
    expect(webClient).not.toContain("from '@supabase/supabase-js'");
    expect(webClient).not.toContain('react-native-url-polyfill');
    expect(webClient).not.toContain('@react-native-async-storage/async-storage');
    expect(webClient).not.toContain('expo-web-browser');
    expect(webClient).not.toContain("from 'react-native'");
    expect(webClient).toContain('detectSessionInUrl: true');
    expect(webClient).toContain('persistSession: true');
    expect(webClient).toContain('autoRefreshToken: true');
    expect(webClient).toContain("flowType: 'pkce'");
    expect(webClient).toContain('lock: webAuthLock');
    expect(webClient).toContain('lockAcquireTimeout: -1');
    expect(webClient).toContain('navigatorLock');
    expect(webClient).toContain("new URL('auth/v1', baseUrl)");
    expect(webClient).toContain('Authorization: `Bearer ${clientKey}`');
    expect(webClient).toContain('apikey: clientKey');
  });

  it('leaves the phone provider and client paths in place', () => {
    const phoneProvider = source('../../providers/AuthProvider.tsx');
    const phoneClient = source('../supabase.ts');

    expect(phoneProvider).toContain("from 'expo-auth-session'");
    expect(phoneProvider).toContain("from 'expo-web-browser'");
    expect(phoneProvider).toContain('WebBrowser.openAuthSessionAsync');
    expect(phoneProvider).toContain('supabase.auth.exchangeCodeForSession');
    expect(phoneProvider).toContain('signInErrorKindFromCallback(result.url)');
    expect(phoneClient).toContain("from '@react-native-async-storage/async-storage'");
    expect(phoneClient).toContain("import 'react-native-url-polyfill/auto'");
    expect(phoneClient).toContain('WebBrowser.maybeCompleteAuthSession()');
  });

  it('uses the same auth client and settings as the full web client', () => {
    const reference = createClient('http://localhost:54321', 'missing-publishable-key', {
      auth: {
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: true,
        flowType: 'pkce',
        lock: webAuthLock,
        lockAcquireTimeout: -1,
      },
    }).auth;
    const webAuth = supabase.auth;

    expect(webAuth).toBeInstanceOf(AuthClient);

    const settings = (client: unknown) =>
      client as unknown as {
        url: string;
        storageKey: string;
        autoRefreshToken: boolean;
        persistSession: boolean;
        detectSessionInUrl: boolean;
        flowType: string;
        lock: typeof processLock | typeof navigatorLock;
        lockAcquireTimeout: number;
        headers: Record<string, string>;
      };

    expect(settings(webAuth)).toMatchObject({
      url: settings(reference).url,
      storageKey: settings(reference).storageKey,
      autoRefreshToken: settings(reference).autoRefreshToken,
      persistSession: settings(reference).persistSession,
      detectSessionInUrl: settings(reference).detectSessionInUrl,
      flowType: settings(reference).flowType,
      lock: settings(reference).lock,
      headers: {
        Authorization: settings(reference).headers.Authorization,
        apikey: settings(reference).headers.apikey,
      },
    });
    expect(settings(webAuth).lockAcquireTimeout).toBe(-1);

    for (const method of [
      'getSession',
      'onAuthStateChange',
      'signInWithOAuth',
      'exchangeCodeForSession',
      'resetPasswordForEmail',
      'reauthenticate',
      'verifyOtp',
      'updateUser',
      'signOut',
    ] as const) {
      expect(typeof webAuth[method]).toBe('function');
      expect(typeof reference[method]).toBe('function');
    }
  });

  it('keeps password fresh proof inside the shared provider contract', () => {
    for (const provider of [
      source('../../providers/AuthProvider.web.tsx'),
      source('../../providers/AuthProvider.tsx'),
    ]) {
      expect(provider).toContain('expectedAccessToken?: string');
      expect(provider).toContain('savePasswordWithFreshProof(');
      expect(provider).toContain('passwordClientForOrdinarySession(');
      expect(provider).toContain('freshProofCode,');
    }
  });
});
