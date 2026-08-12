import { Platform, type ViewStyle } from 'react-native';

import { theme } from './tokens';

// @spec HOME-UI-001, HOME-UI-002, HOME-UI-003
export function getHomeDotVisibility(isWeb: boolean, isMobile: boolean) {
  return {
    hero: isWeb && !isMobile,
    finder: isWeb,
  };
}

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
