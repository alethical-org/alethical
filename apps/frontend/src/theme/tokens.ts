import { Platform } from 'react-native';

export const theme = {
  colors: {
    ink: '#111111',
    mutedInk: '#525252',
    paper: '#F9F9F7',
    surface: '#F9F9F7',
    surfaceAlt: '#E5E5E0',
    border: '#111111',
    primary: '#111111',
    primarySoft: '#F1F1EC',
    accent: '#CC0000',
    accentSoft: '#F2E6E4',
    info: '#111111',
    infoSoft: '#EFEFEA',
    success: '#111111',
    warning: '#111111',
    danger: '#CC0000',
    focus: '#CC0000',
    white: '#F9F9F7',
  },
  spacing: {
    xs: 6,
    sm: 10,
    md: 16,
    lg: 24,
    xl: 32,
    xxl: 48,
  },
  radii: {
    sm: 0,
    md: 0,
    lg: 0,
    pill: 0,
  },
  typography: {
    title: Platform.select({
      web: '"Playfair Display", "Times New Roman", serif',
      ios: 'Georgia',
      default: 'serif',
    }),
    body: Platform.select({
      web: '"Lora", Georgia, serif',
      ios: 'Georgia',
      default: 'serif',
    }),
    ui: Platform.select({
      web: 'Inter, "Helvetica Neue", sans-serif',
      ios: 'System',
      default: 'sans-serif',
    }),
    mono: Platform.select({
      web: '"JetBrains Mono", "Courier New", monospace',
      ios: 'Courier',
      default: 'monospace',
    }),
  },
  shadows: {
    card: Platform.select({
      web: {},
      default: {},
    }),
  },
  layout: {
    maxWidth: 1280,
    railWidth: 320,
  },
};

export type Theme = typeof theme;
