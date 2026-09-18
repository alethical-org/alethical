import type { PressableStateCallbackType, StyleProp, TextStyle, ViewStyle } from 'react-native';

import { theme as t } from './tokens';

type YearFilterInteractionState = PressableStateCallbackType & {
  hovered?: boolean;
};

/**
 * Every year filter keeps the same state meanings while retaining the shape and
 * spacing owned by its surface. Pointer hover uses the brand-green boundary.
 * Selection remains the black active-control block with white text.
 */
export const yearFilterStates = {
  hover: {
    borderColor: t.colors.brand.base,
  } satisfies ViewStyle,
  selected: {
    backgroundColor: t.colors.text.primary,
    borderColor: t.colors.text.primary,
    ...({ outlineStyle: 'none' } as object),
  } satisfies ViewStyle,
  selectedLabel: {
    color: t.colors.surfaces.base,
  } satisfies TextStyle,
} as const;

/**
 * Pointer focus adds no local outline. App.tsx supplies the sitewide purple
 * `:focus-visible` ring when a keyboard user reaches the year choice.
 */
export function yearFilterButtonStyle(
  base: StyleProp<ViewStyle>,
  selected: boolean,
  state: YearFilterInteractionState,
): StyleProp<ViewStyle> {
  const hovered = Boolean('hovered' in state && state.hovered);
  return [
    base,
    !selected && hovered && yearFilterStates.hover,
    selected && yearFilterStates.selected,
  ];
}

export function yearFilterLabelStyle(
  base: StyleProp<TextStyle>,
  selected: boolean,
): StyleProp<TextStyle> {
  return [base, selected && yearFilterStates.selectedLabel];
}
