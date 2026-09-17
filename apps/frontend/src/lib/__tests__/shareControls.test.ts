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

  it('uses the same contextual labels for triggers, dialogs, and visible panel headings', () => {
    const panel = source('../../components/share/SharePanelContent.tsx');
    expect(webPopover).toContain(
      'accessibilityLabel={shareDialogLabel(content.subject, content.resultsKind)}',
    );
    expect(webPopover).toContain(
      'aria-label={shareDialogLabel(content.subject, content.resultsKind)}',
    );
    expect(phoneSheet).toContain(
      'aria-label={shareDialogLabel(content.subject, content.resultsKind)}',
    );
    expect(panel).toContain('shareDialogLabel(content.subject, content.resultsKind)');
    for (const component of [webPopover, phoneSheet, panel]) {
      expect(component).not.toContain('shareDialogLabel(content.subject)');
    }
  });

  it('keeps the committee name in the share title and adds context without repeating it', () => {
    const committee = source('../../screens/redesign/CommitteeMoneyScreen.tsx');
    const shareContent = committee.slice(
      committee.indexOf('const shareContent: ShareContent'),
      committee.indexOf('return (', committee.indexOf('const shareContent: ShareContent')),
    );
    expect(shareContent).toContain('title: name');
    expect(shareContent).toContain('Campaign money from Minnesota’s official filings');
    expect(shareContent).not.toContain('${name}');
    expect(shareContent).not.toContain('— Alethical');
  });
});
