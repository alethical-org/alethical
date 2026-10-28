/** Publishable settings, read once at build time. Missing values stop the app. */
export interface FinanceConfig {
  supabaseUrl: string;
  supabasePublishableKey: string;
  apiBaseUrl: string;
  /** On only once Supabase accepts Finance's return address; otherwise Google
   * would hand the reader back to the project's default site. */
  googleSignIn: boolean;
  /** On only once the server's code route ships; otherwise every code request
   * would fail. */
  emailSignIn: boolean;
}

export function readConfig(env: Record<string, string | undefined>): FinanceConfig | null {
  const supabaseUrl = env.VITE_SUPABASE_URL?.trim();
  const supabasePublishableKey = env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim();
  const apiBaseUrl = env.VITE_API_BASE_URL?.trim().replace(/\/+$/, '');
  if (!supabaseUrl || !supabasePublishableKey || !apiBaseUrl) return null;
  return {
    supabaseUrl,
    supabasePublishableKey,
    apiBaseUrl,
    googleSignIn: env.VITE_GOOGLE_SIGN_IN?.trim() === 'on',
    emailSignIn: env.VITE_EMAIL_SIGN_IN?.trim() === 'on',
  };
}

/** On only once Finance's signed-in screens are approved for the public address;
 * until then the app serves the landing page and sign-in alone. */
export function screensApproved(env: Record<string, string | undefined>): boolean {
  return env.VITE_FINANCE_SCREENS?.trim() === 'on';
}
