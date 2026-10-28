import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from './App';
import { createFinanceSupabase } from './auth/supabase';
import { SessionProvider } from './auth/session';
import { readConfig, screensApproved } from './config';
import { PublicSite } from './landing/PublicSite';
import { NotConfigured } from './pages/Status';
import './styles.css';

const config = readConfig(import.meta.env);
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
      >
        {screensApproved(import.meta.env) ? <App /> : <PublicSite />}
      </SessionProvider>
    </StrictMode>,
  );
}
