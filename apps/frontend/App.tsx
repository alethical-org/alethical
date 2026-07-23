import { useEffect } from 'react';
import { Platform, StyleSheet, View } from 'react-native';

import { AppProviders } from './src/providers/AppProviders';
import { RootNavigator } from './src/navigation/RootNavigator';

export default function App() {
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined') {
      return;
    }

    const ensureManifest = () => {
      const existing = document.querySelector('link[rel="manifest"]');
      if (!existing) {
        const link = document.createElement('link');
        link.rel = 'manifest';
        link.href = '/manifest.json';
        document.head.appendChild(link);
      }
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

    const ensureFonts = () => {
      if (document.getElementById('alethical-fonts')) {
        return;
      }
      const preconnect = document.createElement('link');
      preconnect.rel = 'preconnect';
      preconnect.href = 'https://fonts.gstatic.com';
      preconnect.crossOrigin = 'anonymous';
      document.head.appendChild(preconnect);

      const link = document.createElement('link');
      link.id = 'alethical-fonts';
      link.rel = 'stylesheet';
      link.href =
        'https://fonts.googleapis.com/css2?family=Libre+Franklin:wght@300;400;500;600;700;800;900&family=JetBrains+Mono:wght@400;500;700&family=Sora:wght@500;600;700&family=Space+Grotesk:wght@500&display=swap';
      document.head.appendChild(link);
    };

    // App-wide keyboard focus ring (WCAG 2.4.7, Focus Visible). Every focusable
    // Pressable renders as a role/tabindex element, so one :focus-visible rule
    // covers all controls (buttons, links, pills, dropdowns, chips, toggles)
    // without touching each component. :focus-visible = keyboard focus only, so
    // the ring never flashes on mouse click. Text fields are excluded — they
    // carry their own purple focus ring (see theme/fieldFocus.ts), so an outline
    // would double it. Spec: docs/mockups/search-bills-v2/README.md, "Reusable
    // conventions" (2px solid #7c5cff, offset 2px).
    const ensureFocusStyles = () => {
      if (document.getElementById('alethical-focus-visible')) {
        return;
      }
      const style = document.createElement('style');
      style.id = 'alethical-focus-visible';
      style.textContent = `a:focus-visible,button:focus-visible,[role="button"]:focus-visible,[role="link"]:focus-visible,[tabindex]:not(input):not(textarea):not(select):focus-visible{outline:2px solid #7c5cff !important;outline-offset:2px !important;}`;
      document.head.appendChild(style);
    };

    ensureManifest();
    ensureThemeColor();
    ensureFonts();
    ensureFocusStyles();

    if (process.env.NODE_ENV !== 'production') {
      void navigator.serviceWorker?.getRegistrations().then((registrations) => {
        registrations.forEach((registration) => void registration.unregister());
      });
      return;
    }

    if ('serviceWorker' in navigator) {
      void navigator.serviceWorker.register('/sw.js').catch(() => undefined);
    }
  }, []);

  return (
    <View style={styles.app}>
      <AppProviders>
        <RootNavigator />
      </AppProviders>
    </View>
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
