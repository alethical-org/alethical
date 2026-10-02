import { useEffect } from 'react';
import { Platform, StyleSheet, View } from 'react-native';

import { AppProviders } from './src/providers/AppProviders';
import { AppErrorBoundary } from './src/components/AppErrorBoundary';
import { CommentStateProvider } from './src/components/comments/CommentStateProvider';
import { unregisterServiceWorkers } from './src/lib/serviceWorkerCleanup';
import { loadSignInBundle } from './src/lib/auth/loadSignInBundle';
import { RootNavigator } from './src/navigation/RootNavigator';
import { loadOnDemand } from './src/lib/loadOnDemand';

/**
 * The page an email sign-in link lands on. It draws at 2 addresses out of 30
 * (`/confirm` and `/reset`), and it is the only page drawn outside the app's
 * providers, because a person arriving on one is finishing a sign-in rather than
 * reading a record.
 *
 * Fetched with the rest of sign-in rather than carried by every page (#1976),
 * and through the same download as the dialog rather than one of its own: 2
 * downloads would put everything they share, the sign-in client included, into
 * the file every page fetches. `lib/auth/signInBundle.ts` says why.
 */
const EmailLinkPage = loadOnDemand(
  () => loadSignInBundle().then((bundle) => ({ default: bundle.EmailLinkPage })),
  { kind: 'screen' },
);

export default function App() {
  const emailLinkKind =
    Platform.OS === 'web' && typeof window !== 'undefined'
      ? window.location.pathname === '/confirm'
        ? 'confirm'
        : window.location.pathname === '/reset'
          ? 'reset'
          : null
      : null;
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined') {
      return;
    }

    // Releases can change the JavaScript files a page needs. A saved-site worker
    // can keep serving an older page that requests files the new release no
    // longer has, leaving a direct link blank. The worker is retired, and this
    // removes registrations once this app can start.
    void unregisterServiceWorkers(navigator).catch(() => undefined);
  }, []);

  return (
    <AppErrorBoundary>
      <View style={styles.app}>
        {emailLinkKind ? (
          <EmailLinkPage kind={emailLinkKind} />
        ) : (
          <AppProviders>
            <CommentStateProvider>
              <RootNavigator />
            </CommentStateProvider>
          </AppProviders>
        )}
      </View>
    </AppErrorBoundary>
  );
}

const styles = StyleSheet.create({
  app: {
    flex: 1,
    ...(Platform.OS === 'web'
      ? ({
          minHeight: '100vh',
        } as any)
      : null),
  },
});
