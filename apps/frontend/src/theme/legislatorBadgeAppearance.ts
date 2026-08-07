import type { TextStyle, ViewStyle } from 'react-native';

import { theme as t } from './tokens';

type BadgeAppearance = {
  container: ViewStyle;
  text: TextStyle;
};

export const profilePartyBadgeAppearance = {
  web: {
    container: {
      paddingVertical: 6,
      paddingHorizontal: 14,
      backgroundColor: t.colors.surfaces.s400,
      borderRadius: 999,
      flexShrink: 0,
    },
    text: {
      fontFamily: t.typography.ui,
      fontSize: 14,
      fontWeight: t.fontWeights.bold,
      letterSpacing: 0.84,
      color: t.colors.text.secondary,
    },
  },
  phone: {
    container: {
      paddingVertical: 5,
      paddingHorizontal: 12,
      backgroundColor: t.colors.surfaces.s400,
      borderRadius: 999,
      flexShrink: 0,
    },
    text: {
      fontFamily: t.typography.ui,
      fontSize: 12,
      fontWeight: t.fontWeights.bold,
      letterSpacing: 0.72,
      color: t.colors.text.secondary,
    },
  },
} satisfies Record<'web' | 'phone', BadgeAppearance>;
