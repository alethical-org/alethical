import { PropsWithChildren, useState } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';

import { createAppQueryClient } from '../lib/appQueryClient';
import { AuthProvider } from './AuthProvider';
import { SignInModalProvider } from './SignInModalProvider';
import { TrackedBillWriteProvider } from './TrackedBillWriteProvider';
import { PasswordChangedNotice } from '../components/auth/PasswordChangedNotice';
import { TrafficAnalytics } from '../components/TrafficAnalytics';

export function AppProviders({ children }: PropsWithChildren) {
  const [queryClient] = useState(createAppQueryClient);

  return (
    <SafeAreaProvider>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <TrackedBillWriteProvider>
            {/* Under AuthProvider so the one sign-in dialog can read the session,
                and above everything else so any button on any screen can open it. */}
            <SignInModalProvider>
              <StatusBar style="dark" />
              <TrafficAnalytics />
              {children}
              <PasswordChangedNotice />
            </SignInModalProvider>
          </TrackedBillWriteProvider>
        </AuthProvider>
      </QueryClientProvider>
    </SafeAreaProvider>
  );
}
