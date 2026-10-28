import { describe, expect, it, vi } from 'vitest';

const createClient = vi.fn(() => ({}));
vi.mock('@supabase/supabase-js', () => ({ createClient }));

describe('the Finance sign-in client', () => {
  it('uses PKCE, its own storage name, and finishes sign-in from the address', async () => {
    const { createFinanceSupabase, STORAGE_KEY } = await import('../auth/supabase');
    createFinanceSupabase({
      supabaseUrl: 'https://project.example.test',
      supabasePublishableKey: 'sb_publishable_test',
      apiBaseUrl: 'https://api.example.test',
      googleSignIn: false,
    });
    expect(createClient).toHaveBeenCalledWith(
      'https://project.example.test',
      'sb_publishable_test',
      {
        auth: {
          flowType: 'pkce',
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: true,
          storageKey: STORAGE_KEY,
        },
      },
    );
    expect(STORAGE_KEY).toBe('alethical-finance-auth');
  });
});
