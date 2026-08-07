import { PropsWithChildren, useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';

import { AuthProvider } from './AuthProvider';
import { SignInModalProvider } from './SignInModalProvider';
import { TrackedBillWriteProvider } from './TrackedBillWriteProvider';

export function AppProviders({ children }: PropsWithChildren) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            // Data we've already fetched (a bill, a legislator, a filtered list)
            // stays "fresh" for 5 min and lingers in memory for 30 min, so
            // reopening a page you just viewed — or navigating Back — is instant
            // instead of re-hitting the API. Mutations (track, chat) invalidate
            // their own keys explicitly, so this never serves stale writes.
            staleTime: 5 * 60_000,
            gcTime: 30 * 60_000,
            refetchOnWindowFocus: false,
          },
        },
      }),
  );

  return (
    <SafeAreaProvider>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <TrackedBillWriteProvider>
            {/* Under AuthProvider so the one sign-in dialog can read the session,
                and above everything else so any button on any screen can open it. */}
            <SignInModalProvider>
              <StatusBar style="dark" />
              {children}
            </SignInModalProvider>
          </TrackedBillWriteProvider>
        </AuthProvider>
      </QueryClientProvider>
    </SafeAreaProvider>
  );
}
