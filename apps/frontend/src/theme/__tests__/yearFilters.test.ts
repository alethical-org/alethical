// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FocusEvent, KeyboardEvent, PointerEvent } from 'react';

import { describe, expect, it } from 'vitest';

import {
  YEAR_FILTER_SELECT_ATTRIBUTE,
  YEAR_FILTER_POINTER_FOCUS_ATTRIBUTE,
  YEAR_FILTER_WEB_STYLE_ID,
  ensureYearFilterWebStyles,
  yearFilterButtonStyle,
  yearFilterLabelStyle,
  yearFilterStates,
  yearFilterSelectProps,
  yearFilterWebCss,
} from '../yearFilters';
import { theme as t } from '../tokens';

const YEAR_FILTER_OWNERS = [
  '../../components/campaignMoney/YearControl.tsx',
  '../../components/campaignMoney/CommitteeMixHistory.tsx',
  '../../screens/redesign/OutsideSpendingScreen.tsx',
  '../../screens/redesign/OutsideSpendingBrowseScreen.tsx',
] as const;

describe('the sitewide year-filter treatment', () => {
  it('gives compact year menus the same pointer and keyboard states', () => {
    expect(YEAR_FILTER_SELECT_ATTRIBUTE).toBe('data-alethical-year-filter');
    expect(YEAR_FILTER_POINTER_FOCUS_ATTRIBUTE).toBe('data-alethical-pointer-focus');
    expect(yearFilterWebCss).toContain('select[data-alethical-year-filter]{outline:none;}');
    expect(yearFilterWebCss).toContain(
      'select[data-alethical-year-filter]:hover{border-color:#2ed47e !important;}',
    );
    expect(yearFilterWebCss).toContain(
      'select[data-alethical-year-filter]:focus-visible{outline:2px solid #7c5cff !important;outline-offset:2px !important;}',
    );
    expect(yearFilterWebCss).toContain(
      'select[data-alethical-year-filter][data-alethical-pointer-focus="true"]:focus-visible{outline:none !important;}',
    );
  });

  it('switches compact year menus between pointer and keyboard focus', () => {
    const select = document.createElement('select');
    yearFilterSelectProps.onPointerDown({
      currentTarget: select,
    } as PointerEvent<HTMLSelectElement>);
    expect(select.getAttribute(YEAR_FILTER_POINTER_FOCUS_ATTRIBUTE)).toBe('true');

    yearFilterSelectProps.onKeyDown({ currentTarget: select } as KeyboardEvent<HTMLSelectElement>);
    expect(select.hasAttribute(YEAR_FILTER_POINTER_FOCUS_ATTRIBUTE)).toBe(false);

    yearFilterSelectProps.onPointerDown({
      currentTarget: select,
    } as PointerEvent<HTMLSelectElement>);
    yearFilterSelectProps.onBlur({ currentTarget: select } as FocusEvent<HTMLSelectElement>);
    expect(select.hasAttribute(YEAR_FILTER_POINTER_FOCUS_ATTRIBUTE)).toBe(false);
  });

  it('installs 1 compact year-menu rule', () => {
    document.head.innerHTML = '';
    ensureYearFilterWebStyles();
    ensureYearFilterWebStyles();

    const styles = document.querySelectorAll(`#${YEAR_FILTER_WEB_STYLE_ID}`);
    expect(styles).toHaveLength(1);
    expect(styles[0]?.textContent).toBe(yearFilterWebCss);
  });

  it('installs the compact year-menu rule with the compact Year menu', () => {
    const screen = readFileSync(
      resolve(process.cwd(), 'src/screens/redesign/OutsideSpendingBrowseScreen.tsx'),
      'utf8',
    );
    expect(screen).toContain('ensureYearFilterWebStyles,');
    expect(screen).toContain('ensureYearFilterWebStyles();');
  });

  it('uses green for pointer hover and black for selection', () => {
    expect(yearFilterStates.hover).toEqual({ borderColor: t.colors.brand.base });
    expect(yearFilterStates.selected).toEqual({
      backgroundColor: t.colors.text.primary,
      borderColor: t.colors.text.primary,
      outlineStyle: 'none',
    });
    expect(yearFilterStates.selectedLabel).toEqual({ color: t.colors.surfaces.base });
  });

  it('keeps the black selected block above the green hover boundary', () => {
    const base = { minHeight: 44 } as const;
    expect(yearFilterButtonStyle(base, false, { pressed: false, hovered: true })).toEqual([
      base,
      yearFilterStates.hover,
      false,
    ]);
    expect(yearFilterButtonStyle(base, true, { pressed: false, hovered: true })).toEqual([
      base,
      false,
      yearFilterStates.selected,
    ]);
    expect(yearFilterLabelStyle({ fontSize: 15 }, true)).toEqual([
      { fontSize: 15 },
      yearFilterStates.selectedLabel,
    ]);
  });

  it.each(YEAR_FILTER_OWNERS)('%s uses the shared year-filter states', (relativePath) => {
    const source = readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), 'utf8');
    expect(source).toContain("from '../../theme/yearFilters'");
    expect(source).toContain('yearFilterButtonStyle(');
    expect(source).toContain('yearFilterLabelStyle(');
  });
});
