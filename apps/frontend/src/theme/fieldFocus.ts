import { useState } from 'react';
import { Platform } from 'react-native';

import { theme } from './tokens';

// Site-wide persistent focus glow for primary text-entry fields: while the caret
// is in the field, its bordered element shows the purple border + ring (matching
// the signed-out home ask/finder fields), easing in/out. Shared so every ask /
// search / address field gets the identical treatment.

const focusTransition =
  Platform.OS === 'web'
    ? ({
        transitionProperty: 'border-color, box-shadow',
        transitionDuration: '0.18s',
        transitionTimingFunction: 'ease',
      } as object)
    : null;

/**
 * Kills the browser's native focus outline (web) so only the purple ring shows.
 * Spread onto the TextInput's own style: `style={[styles.input, fieldOutlineReset]}`.
 */
export const fieldOutlineReset =
  Platform.OS === 'web' ? ({ outlineStyle: 'none' } as object) : null;

/** Tracks focus for one field. Spread `focusProps` onto the TextInput. */
export function useFieldFocus() {
  const [focused, setFocused] = useState(false);
  return {
    focused,
    focusProps: {
      onFocus: () => setFocused(true),
      onBlur: () => setFocused(false),
    },
  };
}

/**
 * Style fragments for a field's bordered element. Spread into its style array:
 * `style={[styles.wrapper, ...fieldFocusRing(focused)]}`. Adds the .18s transition
 * always (so it eases out on blur) and the purple border + ring while focused.
 */
export function fieldFocusRing(focused: boolean) {
  return [
    focusTransition,
    // Set both so it works for full-border pills and bottom-border fields
    // (which set borderBottomColor explicitly, so borderColor alone wouldn't win).
    focused && { borderColor: theme.colors.purple.base, borderBottomColor: theme.colors.purple.base },
    focused && (theme.shadows.focusPurple as object),
  ];
}
