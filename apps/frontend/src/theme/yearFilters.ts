import type { FocusEvent, KeyboardEvent, PointerEvent } from 'react';
import type { PressableStateCallbackType, StyleProp, TextStyle, ViewStyle } from 'react-native';

import { theme as t } from './tokens';

export const YEAR_FILTER_SELECT_ATTRIBUTE = 'data-alethical-year-filter';
export const YEAR_FILTER_POINTER_FOCUS_ATTRIBUTE = 'data-alethical-pointer-focus';
export const YEAR_FILTER_WEB_STYLE_ID = 'alethical-year-filter-states';

const yearFilterSelect = `select[${YEAR_FILTER_SELECT_ATTRIBUTE}]`;
const pointerFocusedYearFilter = `${yearFilterSelect}[${YEAR_FILTER_POINTER_FOCUS_ATTRIBUTE}="true"]`;

export const yearFilterWebCss =
  `${yearFilterSelect}{outline:none;}` +
  `@media (hover: hover) and (pointer: fine){${yearFilterSelect}:hover{border-color:${t.colors.brand.base} !important;}}` +
  `${yearFilterSelect}:focus-visible{outline:2px solid #7c5cff !important;outline-offset:2px !important;}` +
  `${pointerFocusedYearFilter}:focus-visible{outline:none !important;}`;

export const yearFilterSelectProps = {
  'data-alethical-year-filter': 'true',
  onPointerDown: (event: PointerEvent<HTMLSelectElement>) => {
    event.currentTarget.setAttribute(YEAR_FILTER_POINTER_FOCUS_ATTRIBUTE, 'true');
  },
  onKeyDown: (event: KeyboardEvent<HTMLSelectElement>) => {
    event.currentTarget.removeAttribute(YEAR_FILTER_POINTER_FOCUS_ATTRIBUTE);
  },
  onBlur: (event: FocusEvent<HTMLSelectElement>) => {
    event.currentTarget.removeAttribute(YEAR_FILTER_POINTER_FOCUS_ATTRIBUTE);
  },
} as const;

export function ensureYearFilterWebStyles(): void {
  if (typeof document === 'undefined' || document.getElementById(YEAR_FILTER_WEB_STYLE_ID)) {
    return;
  }
  const style = document.createElement('style');
  style.id = YEAR_FILTER_WEB_STYLE_ID;
  style.textContent = yearFilterWebCss;
  document.head.appendChild(style);
}

type YearFilterInteractionState = PressableStateCallbackType & {
  hovered?: boolean;
};

function finePointerCanHover(): boolean {
  return (
    typeof window !== 'undefined' &&
    window.matchMedia?.('(hover: hover) and (pointer: fine)').matches === true
  );
}

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
  const hovered = finePointerCanHover() && Boolean('hovered' in state && state.hovered);
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
