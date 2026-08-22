import { Platform } from 'react-native';

export const BROWSER_FILL_STYLE_ID = 'alethical-browser-fill';

export const browserFillInputProps = {
  'data-alethical-browser-fill': 'true',
} as const;

export const browserFillTextInputProps: object =
  Platform.OS === 'web'
    ? {
        dataSet: { alethicalBrowserFill: 'true' },
      }
    : {};

const target = 'input[data-alethical-browser-fill="true"]';
const standardSelectors = ['', ':hover', ':focus', ':active'].map(
  (state) => `${target}:autofill${state}`,
);
const webkitSelectors = ['', ':hover', ':focus', ':active'].map(
  (state) => `${target}:-webkit-autofill${state}`,
);
const filledDeclarations = `
  background-color: #ffffff !important;
  -webkit-box-shadow: 0 0 0 1000px #ffffff inset !important;
  box-shadow: 0 0 0 1000px #ffffff inset !important;
  -webkit-text-fill-color: #11150f !important;
  color: #11150f !important;
  caret-color: #11150f !important;
`;
const forcedColorDeclarations = `
  background-color: Canvas !important;
  -webkit-box-shadow: none !important;
  box-shadow: none !important;
  -webkit-text-fill-color: CanvasText !important;
  color: CanvasText !important;
  caret-color: CanvasText !important;
`;

export const browserFillCss = `${standardSelectors.join(',\n')} {${filledDeclarations}}
${webkitSelectors.join(',\n')} {${filledDeclarations}}
@media (forced-colors: active) {
  ${standardSelectors.join(',\n  ')} {${forcedColorDeclarations}  }
  ${webkitSelectors.join(',\n  ')} {${forcedColorDeclarations}  }
}`;

export function ensureBrowserFillStyles(targetDocument?: Document) {
  if (Platform.OS !== 'web') return;
  const webDocument = targetDocument ?? (typeof document === 'undefined' ? undefined : document);
  if (!webDocument || webDocument.getElementById(BROWSER_FILL_STYLE_ID)) return;

  const style = webDocument.createElement('style');
  style.id = BROWSER_FILL_STYLE_ID;
  style.textContent = browserFillCss;
  webDocument.head.appendChild(style);
}
