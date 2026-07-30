import { defineConfig } from 'vitest/config';

// `react-native` resolves to its native entry point, which Node can't load, so
// any module importing it (Platform, StyleSheet, a component) is untestable by
// default. Point it at react-native-web — already a dependency, and the exact
// implementation the web build ships — so the web behaviour under test is the
// real one. Everything else stays on vitest's defaults.
export default defineConfig({
  resolve: {
    alias: {
      'react-native': 'react-native-web',
    },
  },
});
