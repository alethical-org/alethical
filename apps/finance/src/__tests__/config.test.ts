import { describe, expect, it } from 'vitest';

import { readConfig } from '../config';

const base = {
  VITE_SUPABASE_URL: 'https://project.example.test',
  VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test',
  VITE_API_BASE_URL: 'https://api.example.test/',
};

describe('readConfig', () => {
  it('needs all 3 addresses and keys', () => {
    expect(readConfig({ ...base, VITE_API_BASE_URL: '' })).toBeNull();
    expect(readConfig({ ...base, VITE_SUPABASE_URL: undefined })).toBeNull();
  });

  it('turns each sign-in way on only for the exact word on', () => {
    expect(readConfig(base)).toEqual({
      supabaseUrl: 'https://project.example.test',
      supabasePublishableKey: 'sb_publishable_test',
      apiBaseUrl: 'https://api.example.test',
      googleSignIn: false,
      emailSignIn: false,
    });
    const on = readConfig({ ...base, VITE_GOOGLE_SIGN_IN: 'on', VITE_EMAIL_SIGN_IN: ' on ' });
    expect([on?.googleSignIn, on?.emailSignIn]).toEqual([true, true]);
    const other = readConfig({ ...base, VITE_GOOGLE_SIGN_IN: 'true', VITE_EMAIL_SIGN_IN: 'yes' });
    expect([other?.googleSignIn, other?.emailSignIn]).toEqual([false, false]);
  });
});
