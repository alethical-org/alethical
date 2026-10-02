// @vitest-environment jsdom

import { createElement } from 'react';
import { TextInput } from 'react-native';
import { beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  BROWSER_FILL_STYLE_ID,
  browserFillCss,
  browserFillInputProps,
  browserFillTextInputProps,
  ensureBrowserFillStyles,
} from '../browserFill';

const TARGET = 'input[data-alethical-browser-fill="true"]';
const { renderToStaticMarkup } = require('react-dom/server') as {
  renderToStaticMarkup: (node: React.ReactNode) => string;
};

describe('approved browser-filled field treatment', () => {
  beforeEach(() => {
    document.head.innerHTML = '';
  });

  it('gives raw inputs and React Native Web inputs the same narrow marker', () => {
    expect(browserFillInputProps).toEqual({ 'data-alethical-browser-fill': 'true' });
    expect(browserFillTextInputProps).toEqual({
      dataSet: { alethicalBrowserFill: 'true' },
    });
    expect(renderToStaticMarkup(createElement('input', browserFillInputProps))).toContain(
      'data-alethical-browser-fill="true"',
    );
    expect(
      renderToStaticMarkup(createElement(TextInput, { ...browserFillTextInputProps })),
    ).toContain('data-alethical-browser-fill="true"');
  });

  it('keeps standard and WebKit browser-fill states in separate rules', () => {
    const standardRule = browserFillCss.slice(
      browserFillCss.indexOf(`${TARGET}:autofill`),
      browserFillCss.indexOf(`${TARGET}:-webkit-autofill`),
    );
    const webkitRule = browserFillCss.slice(
      browserFillCss.indexOf(`${TARGET}:-webkit-autofill`),
      browserFillCss.indexOf('@media (forced-colors: active)'),
    );

    for (const state of ['', ':hover', ':focus', ':active']) {
      expect(standardRule).toContain(`${TARGET}:autofill${state}`);
      expect(webkitRule).toContain(`${TARGET}:-webkit-autofill${state}`);
    }
    expect(standardRule).not.toContain(':-webkit-autofill');
    expect(webkitRule).not.toMatch(/(?<!-webkit-):autofill/);
    expect(browserFillCss).not.toMatch(/(^|[,{}]\s*)input:(?:autofill|-webkit-autofill)/m);
  });

  it('pins the white interior, dark value and caret, and system colors', () => {
    expect(browserFillCss).toContain('background-color: #ffffff !important;');
    expect(browserFillCss).toContain('box-shadow: 0 0 0 1000px #ffffff inset !important;');
    expect(browserFillCss).toContain('-webkit-box-shadow: 0 0 0 1000px #ffffff inset !important;');
    expect(browserFillCss).toContain('-webkit-text-fill-color: #11150f !important;');
    expect(browserFillCss).toContain('color: #11150f !important;');
    expect(browserFillCss).toContain('caret-color: #11150f !important;');
    expect(browserFillCss).not.toContain('border-radius');
    expect(browserFillCss).not.toContain('border-color');
    expect(browserFillCss).not.toContain('outline:');
    expect(browserFillCss).toContain('@media (forced-colors: active)');
    expect(browserFillCss).toContain('background-color: Canvas !important;');
    expect(browserFillCss).toContain('-webkit-text-fill-color: CanvasText !important;');
    expect(browserFillCss).toContain('color: CanvasText !important;');
    expect(browserFillCss).toContain('caret-color: CanvasText !important;');
  });

  it('installs one stable style element even when called more than once', () => {
    ensureBrowserFillStyles();
    ensureBrowserFillStyles();

    const styles = document.querySelectorAll(`#${BROWSER_FILL_STYLE_ID}`);
    expect(styles).toHaveLength(1);
    expect(styles[0]?.textContent).toBe(browserFillCss);
  });

  it('ships matching browser-fill CSS before the app starts without a startup injector', () => {
    const frontend = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
    const app = readFileSync(join(frontend, 'App.tsx'), 'utf8');
    const html = readFileSync(join(frontend, 'public/index.html'), 'utf8');
    const head = new DOMParser().parseFromString(html, 'text/html').head;
    const styles = head.querySelectorAll(`#${BROWSER_FILL_STYLE_ID}`);
    const compact = (css: string) => css.replace(/\s+/g, '');

    expect(styles).toHaveLength(1);
    expect(compact(styles[0]?.textContent ?? '')).toBe(compact(browserFillCss));
    expect(app).not.toContain('ensureBrowserFillStyles');
    expect(app).not.toContain('ensureFocusStyles');
    expect(app).not.toContain('ensureManifest');
    expect(app).not.toContain('ensureAppleTouchIcon');
    expect(app).not.toContain('ensureThemeColor');
  });

  it('ships unchanged install metadata and keyboard focus before any app download', () => {
    const html = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'public/index.html'),
      'utf8',
    );
    const head = new DOMParser().parseFromString(html, 'text/html').head;
    expect(head.querySelectorAll('link[rel="manifest"]')).toHaveLength(1);
    expect(head.querySelector('link[rel="manifest"]')?.getAttribute('href')).toBe(
      '/manifest.json?brand=twin-peaks',
    );
    expect(head.querySelectorAll('link[rel="apple-touch-icon"]')).toHaveLength(1);
    expect(head.querySelector('link[rel="apple-touch-icon"]')?.getAttribute('href')).toBe(
      '/apple-touch-icon.png?brand=twin-peaks',
    );
    expect(head.querySelectorAll('meta[name="theme-color"]')).toHaveLength(1);
    expect(head.querySelector('meta[name="theme-color"]')?.getAttribute('content')).toBe('#111111');
    const focusStyles = head.querySelectorAll('#alethical-focus-visible');
    expect(focusStyles).toHaveLength(1);
    expect(focusStyles[0]?.textContent?.replace(/\s+/g, '')).toBe(
      'a:not([data-arrow-focus]):focus-visible,button:not([data-arrow-focus]):focus-visible,[role="button"]:not([data-arrow-focus]):focus-visible,[role="link"]:not([data-arrow-focus]):focus-visible,[tabindex]:not(input):not(textarea):not(select):not([role="heading"]):not(h1):not(h2):not(h3):not(h4):not(h5):not(h6):not([data-arrow-focus]):focus-visible{outline:2pxsolid#7c5cff!important;outline-offset:2px!important;}',
    );
  });
});
