import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const source = (path: string) => readFileSync(resolve(here, path), 'utf8');

const webPopover = source('../../components/billDetail/SharePopover.tsx');
const phoneSheet = source('../../components/share/MobileShareSheet.tsx');
const billPhone = source('../../screens/redesign/BillDetailScreen.tsx');
const legislatorPhone = source('../../screens/redesign/LegislatorProfileMobileScreen.tsx');

describe('responsive Share controls', () => {
  it('uses the phone Share sheet whenever the shared popover appears on a small screen', () => {
    expect(webPopover).toContain("import { useResponsive } from '../../hooks/useResponsive'");
    expect(webPopover).toContain('<MobileShareSheet');
    expect(webPopover).toContain('!isDesktop ?');
  });

  it('uses the same phone Share sheet for bill and legislator pages', () => {
    expect(billPhone).toContain('<MobileShareSheet');
    expect(legislatorPhone).toContain('<MobileShareSheet');
  });

  it('uses 1 shared panel body for desktop and smaller screens', () => {
    expect(webPopover).toContain('<SharePanelContent');
    expect(phoneSheet).toContain('<SharePanelContent');
    expect(webPopover).not.toContain('<TextInput');
    expect(phoneSheet).not.toContain('<TextInput');
    expect(webPopover).not.toContain('buildShareIntents');
    expect(phoneSheet).not.toContain('buildShareIntents');
  });
});
