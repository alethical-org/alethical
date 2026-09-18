import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { contentTabUnderline } from '../contentTabs';
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
    expect(contentTabUnderline.selected.borderBottomColor).toBe(t.colors.brand.base);
  });

  it.each(TAB_OWNERS)('%s uses the shared underline', (relativePath) => {
    const source = readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), 'utf8');
    expect(source).toContain("import { contentTabUnderline } from '");
    expect(source).toContain('...contentTabUnderline.base');
    expect(source).toContain('...contentTabUnderline.selected');
  });
});
