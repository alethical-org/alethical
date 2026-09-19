export const DIRECTORY_ROW_ATTRIBUTE = 'data-alethical-directory-row';
/**
 * React Native Web turns `dataSet` keys into `data-*` attributes; a raw `data-`
 * prop on a Pressable is dropped before it reaches the DOM. `arrowFocus` is the
 * sitewide opt-out from App.tsx's focus ring, taken here so this row can draw the
 * same ring inside its own edge rather than fight that rule on specificity.
 */
export const DIRECTORY_ROW_DATA_SET = {
  alethicalDirectoryRow: 'true',
  arrowFocus: 'true',
} as const;
export const DIRECTORY_ROW_WEB_STYLE_ID = 'alethical-directory-row-states';

/**
 * A result row runs the full width of its card, so the sitewide focus ring at
 * `outline-offset: 2px` would draw outside the card's own edge. The same ring
 * drawn inside the row keeps the marker on the thing that has focus.
 */
export const directoryRowWebCss = `a[${DIRECTORY_ROW_ATTRIBUTE}]:focus-visible{outline:2px solid #7c5cff !important;outline-offset:-2px !important;}`;

export function ensureDirectoryRowWebStyles(): void {
  if (typeof document === 'undefined' || document.getElementById(DIRECTORY_ROW_WEB_STYLE_ID)) {
    return;
  }
  const style = document.createElement('style');
  style.id = DIRECTORY_ROW_WEB_STYLE_ID;
  style.textContent = directoryRowWebCss;
  document.head.appendChild(style);
}
