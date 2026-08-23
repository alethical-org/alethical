import { useEffect } from 'react';
import { Platform, StyleSheet, View } from 'react-native';

import { AppProviders } from './src/providers/AppProviders';
import { AppErrorBoundary } from './src/components/AppErrorBoundary';
import { unregisterServiceWorkers } from './src/lib/serviceWorkerCleanup';
import { RootNavigator } from './src/navigation/RootNavigator';
import { EmailLinkPage } from './src/screens/auth/EmailLinkPage';
import { ensureBrowserFillStyles } from './src/theme/browserFill';

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

    const ensureManifest = () => {
      let link = document.querySelector<HTMLLinkElement>('link[rel="manifest"]');
      if (!link) {
        link = document.createElement('link');
        link.rel = 'manifest';
        document.head.appendChild(link);
      }
      link.href = '/manifest.json?brand=twin-peaks';
    };

    const ensureAppleTouchIcon = () => {
      let link = document.querySelector<HTMLLinkElement>('link[rel="apple-touch-icon"]');
      if (!link) {
        link = document.createElement('link');
        link.rel = 'apple-touch-icon';
        document.head.appendChild(link);
      }
      link.href = '/apple-touch-icon.png?brand=twin-peaks';
    };

    const ensureThemeColor = () => {
      let meta = document.querySelector('meta[name="theme-color"]');
      if (!meta) {
        meta = document.createElement('meta');
        meta.setAttribute('name', 'theme-color');
        document.head.appendChild(meta);
      }
      meta.setAttribute('content', '#111111');
    };

    // App-wide keyboard focus ring (WCAG 2.4.7, Focus Visible). Every focusable
    // Pressable renders as a role/tabindex element, so one :focus-visible rule
    // covers all controls (buttons, links, pills, dropdowns, chips, toggles)
    // without touching each component. :focus-visible = keyboard focus only, so
    // the ring never flashes on mouse click. Text fields are excluded — they
    // carry their own purple focus ring (see theme/fieldFocus.ts), so an outline
    // would double it. Rule: docs/design/design-principles.md §3, keyboard focus
    // (2px solid #7c5cff, offset 2px).
    const ensureFocusStyles = () => {
      if (document.getElementById('alethical-focus-visible')) {
        return;
      }
      const style = document.createElement('style');
      style.id = 'alethical-focus-visible';
      style.textContent = `a:focus-visible,button:focus-visible,[role="button"]:focus-visible,[role="link"]:focus-visible,[tabindex]:not(input):not(textarea):not(select):not([role="heading"]):not(h1):not(h2):not(h3):not(h4):not(h5):not(h6):focus-visible{outline:2px solid #7c5cff !important;outline-offset:2px !important;}`;
      document.head.appendChild(style);
    };

    ensureManifest();
    ensureAppleTouchIcon();
    ensureThemeColor();
    ensureFocusStyles();
    ensureBrowserFillStyles();

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
            <RootNavigator />
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
