import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { yearFilterButtonStyle, yearFilterLabelStyle, yearFilterStates } from '../yearFilters';
import { theme as t } from '../tokens';

const YEAR_FILTER_OWNERS = [
  '../../components/campaignMoney/YearControl.tsx',
  '../../components/campaignMoney/CommitteeMixHistory.tsx',
  '../../screens/redesign/OutsideSpendingScreen.tsx',
  '../../screens/redesign/OutsideSpendingBrowseScreen.tsx',
] as const;

describe('the sitewide year-filter treatment', () => {
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
