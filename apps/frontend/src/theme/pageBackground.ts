import { Platform, type ViewStyle } from 'react-native';

import { theme } from './tokens';

export function getPageBackgroundStyle(isMobile: boolean): ViewStyle {
  const base = { backgroundColor: theme.colors.surfaces.s200 };

  if (Platform.OS !== 'web' || isMobile) {
    return base;
  }

  return {
    ...base,
    backgroundImage: theme.gradients.page,
  } as unknown as ViewStyle;
}
