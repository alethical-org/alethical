import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { createFinanceSupabase } from './auth/supabase';
import { SessionProvider } from './auth/session';
import { readConfig, screensApproved } from './config';
import { FinanceSite } from './landing/PublicSite';
import { NotConfigured } from './pages/Status';
import './styles.css';

const config = readConfig(import.meta.env);
const screens = screensApproved(import.meta.env);
const root = createRoot(document.getElementById('root')!);

if (!config) {
  root.render(<NotConfigured />);
} else {
  root.render(
    <StrictMode>
      <SessionProvider
        supabase={createFinanceSupabase(config)}
        apiBaseUrl={config.apiBaseUrl}
        googleSignIn={config.googleSignIn}
        emailSignIn={config.emailSignIn}
        screens={screens}
      >
        <FinanceSite screens={screens} />
      </SessionProvider>
    </StrictMode>,
  );
}
