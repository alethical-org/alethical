import { Platform, type ViewStyle } from 'react-native';

import { theme } from './tokens';

export type PageBackgroundVariant = 'page' | 'pageGreen';

export function getPageBackgroundStyle(
  isMobile: boolean,
  variant: PageBackgroundVariant,
): ViewStyle {
  const base = { backgroundColor: theme.colors.surfaces.s200 };

  if (Platform.OS !== 'web' || isMobile) {
    return base;
  }

  return {
    ...base,
    backgroundImage: variant === 'pageGreen' ? theme.gradients.pageGreen : theme.gradients.page,
  } as unknown as ViewStyle;
}
