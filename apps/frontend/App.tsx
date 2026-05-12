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

    ensureManifest();
    ensureThemeColor();

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
