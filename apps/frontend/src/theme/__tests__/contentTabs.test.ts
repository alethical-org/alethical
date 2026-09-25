import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { contentTabStyle, contentTabUnderline } from '../contentTabs';
import { theme as t } from '../tokens';

const TAB_OWNERS = [
  '../../components/billDetail/BillHeader.tsx',
  '../../components/campaignMoney/LegislatorProfileTabs.tsx',
  '../../components/campaignMoney/DonorPaymentList.tsx',
  '../../screens/redesign/CommitteeMoneyScreen.tsx',
  '../../screens/redesign/CommitteePaymentsScreen.tsx',
] as const;

describe('the sitewide selected content-tab treatment', () => {
  it('reserves a 3px underline and colors the selected tab green', () => {
    expect(contentTabUnderline.base).toEqual({
      borderBottomWidth: 3,
      borderBottomColor: 'transparent',
    });
    expect(contentTabUnderline.selected).toEqual({
      borderBottomColor: t.colors.brand.base,
      outlineStyle: 'none',
    });
  });

  it('adds no pointer-focus outline to the selected state', () => {
    const base = { paddingBottom: 12 } as const;
    const selected = { marginBottom: -1 } as const;

    expect(contentTabStyle(base, true, selected)).toEqual([
      base,
      contentTabUnderline.base,
      selected,
      contentTabUnderline.selected,
    ]);
    expect(contentTabStyle(base, false, selected)).toEqual([
      base,
      contentTabUnderline.base,
      false,
      false,
    ]);
  });

  it('adds a line inside only an inactive tab when it is hovered', () => {
    const base = { paddingBottom: 12 } as const;
    expect(contentTabStyle(base, false, undefined, true)).toEqual([
      base,
      contentTabUnderline.base,
      false,
      false,
      contentTabUnderline.hover,
    ]);
    expect(contentTabStyle(base, true, undefined, true)).toEqual([
      base,
      contentTabUnderline.base,
      undefined,
      contentTabUnderline.selected,
    ]);
    expect(contentTabUnderline.hover).toEqual({ borderBottomColor: 'rgba(17,21,15,0.2)' });
  });

  it.each(TAB_OWNERS)('%s uses the shared selected-state helper', (relativePath) => {
    const source = readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), 'utf8');
    expect(source).toContain("import { contentTabStyle } from '");
    expect(source).toContain('contentTabStyle(');
  });
});
