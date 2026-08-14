import { configDefaults, defineConfig } from 'vitest/config';

// `react-native` resolves to its native entry point, which Node can't load, so
// any module importing it (Platform, StyleSheet, a component) is untestable by
// default. Point it at react-native-web — already a dependency, and the exact
// implementation the web build ships — so the web behaviour under test is the
// real one. Everything else stays on vitest's defaults.
export default defineConfig({
  test: {
    // e2e/ holds Playwright specs with their own runner (just e2e); vitest
    // must not try to execute them.
    exclude: [...configDefaults.exclude, 'e2e/**'],
  },
  resolve: {
    alias: {
      'react-native': 'react-native-web',
    },
  },
});
