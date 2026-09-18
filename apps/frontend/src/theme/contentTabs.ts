import type { ViewStyle } from 'react-native';

import { theme as t } from './tokens';

/**
 * Every horizontal content tab reserves the same underline space and uses the
 * Alethical green underline when selected. Keeping the transparent line on the
 * inactive tabs prevents the row from moving when the selection changes.
 */
export const contentTabUnderline = {
  base: {
    borderBottomWidth: 3,
    borderBottomColor: 'transparent',
  } satisfies ViewStyle,
  selected: {
    borderBottomColor: t.colors.brand.base,
  } satisfies ViewStyle,
} as const;
