import type { StyleProp, ViewStyle } from 'react-native';

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
  hover: {
    borderBottomColor: 'rgba(17,21,15,0.2)',
  } satisfies ViewStyle,
  selected: {
    borderBottomColor: t.colors.brand.base,
    ...({ outlineStyle: 'none' } as object),
  } satisfies ViewStyle,
} as const;

/**
 * Compose every content tab from the same selected-state treatment. Pointer
 * focus adds no local outline; App.tsx supplies the sitewide purple
 * `:focus-visible` ring when a keyboard user reaches the tab.
 */
export function contentTabStyle(
  base: StyleProp<ViewStyle>,
  selected: boolean,
  selectedStyle?: StyleProp<ViewStyle>,
  hovered = false,
): StyleProp<ViewStyle> {
  const style: StyleProp<ViewStyle>[] = [
    base,
    contentTabUnderline.base,
    selected && selectedStyle,
    selected && contentTabUnderline.selected,
  ];
  if (hovered && !selected) style.push(contentTabUnderline.hover);
  return style;
}
