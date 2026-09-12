// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  CampaignMoneyCardTheme,
  CheckedByBlock,
  Figure,
  FilingStamp,
  MoneyInBlock,
  MoneyOutBlock,
} from '../MoneyCards';
import { CAMPAIGN_MONEY_COLORS as c } from '../../../lib/campaignMoneyColors';
import { MONEY_OUT_OFFICIAL_MISSING } from '../../../lib/committeeMoney';
import { theme as t } from '../../../theme/tokens';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;
let root: Root;
let mount: HTMLDivElement;

function Cards() {
  return (
    <>
      <FilingStamp
        line="Jan 1 to Jul 20, 2026"
        detail="The filing covers these dates."
        notes={['134 payments in 2026']}
        covered
        showLink
        isMobile={false}
      />
      <Figure label="Reported contributions" value="$1,000" note="Through Jul 20, 2026" isMobile />
      <MoneyInBlock
        surface="profile"
        split={{
          state: 'shown',
          reportedTotal: '1000',
          reportedThrough: '2026-07-20',
          namedTotal: '600',
          namedInKindTotal: '0',
          unnamedTotal: '400',
          statedSplitState: 'agrees',
          firstPaymentOn: '2026-01-10',
          lastPaymentOn: '2026-07-01',
        }}
        moneyIn={{
          state: 'reported',
          otherReceipts: [{ receiptType: 'Public Subsidy', total: '100', payments: 2 }],
          sourceUrl:
            'https://cfb.mn.gov/reports-and-data/self-help/data-downloads/campaign-finance/',
        }}
        isBallot={false}
        stampThrough="2026-07-20"
        isMobile={false}
      />
      <MoneyOutBlock surface="profile" moneyOut={null} stampThrough={null} isMobile={false} />
      <CheckedByBlock
        checked={{
          checkedOn: '2026-08-30',
          nameEvidence: 'exact',
          registerVerdict: 'same_seat',
          partyAgreement: 'agrees',
        }}
      />
    </>
  );
}

function exact(container: Element, text: string): HTMLElement {
  const matches = [...container.querySelectorAll<HTMLElement>('*')].filter(
    (element) => element.textContent === text,
  );
  expect(matches.length).toBeGreaterThan(0);
  return matches[matches.length - 1];
}

function fontFamily(value: string): string {
  const element = document.createElement('div');
  element.style.fontFamily = value;
  return element.style.fontFamily;
}

function color(value: string): string {
  const element = document.createElement('div');
  element.style.color = value;
  return element.style.color;
}

beforeEach(() => {
  mount = document.createElement('div');
  document.body.append(mount);
  root = createRoot(mount);
  act(() =>
    root.render(
      <>
        <div id="profile">
          <CampaignMoneyCardTheme>
            <Cards />
          </CampaignMoneyCardTheme>
        </div>
        <div id="default">
          <Cards />
        </div>
      </>,
    ),
  );
});

afterEach(() => {
  act(() => root.unmount());
  mount.remove();
});

describe('profile styling for shared money cards', () => {
  it('changes source-link color, touch height and focus only inside the profile wrapper', () => {
    const profile = mount.querySelector('#profile')!;
    const defaults = mount.querySelector('#default')!;
    expect(profile.textContent).toBe(defaults.textContent);
    const anchors = [...profile.querySelectorAll('a')];
    expect(anchors).toHaveLength(2);
    for (const anchor of anchors) {
      expect(getComputedStyle(anchor).color).toBe(color(c.link));
      expect(getComputedStyle(anchor).minHeight).toBe('44px');
      expect(anchor.getAttribute('href')).toMatch(/^https:\/\/cfb\.mn\.gov\//);
    }
    const oldLink = defaults.querySelector('a')!;
    expect(getComputedStyle(oldLink).color).toBe(color(t.colors.brand.base));
    expect(getComputedStyle(oldLink).minHeight).not.toBe('44px');
    act(() => anchors[0].focus());
    expect(getComputedStyle(anchors[0]).outlineColor).toBe(color(c.focus));
    expect(getComputedStyle(anchors[0]).outlineWidth).toBe('2px');
    act(() => anchors[0].blur());
    expect(getComputedStyle(anchors[0]).outlineWidth).not.toBe('2px');
  });

  it('uses Libre Franklin and tabular digits for amounts, dates and counts, keeping lettered labels mono', () => {
    const profile = mount.querySelector('#profile')!;
    const defaults = mount.querySelector('#default')!;
    for (const text of [
      '$1,000',
      'Through Jul 20, 2026',
      '134 payments in 2026',
      'Checked by Alethical on Aug 30, 2026',
      'Public Subsidy · 2 payments',
    ]) {
      const style = getComputedStyle(exact(profile, text));
      expect(style.fontFamily).toBe(fontFamily(t.typography.body));
      expect(style.fontWeight).toBe('800');
      expect(style.fontVariant).toBe('tabular-nums');
    }
    const period = getComputedStyle(exact(profile, 'Jan 1 to Jul 20, 2026'));
    expect(period.fontFamily).toBe(fontFamily(t.typography.body));
    expect(period.fontWeight).toBe('700');
    expect(period.color).toBe(color(c.text));
    expect(getComputedStyle(exact(defaults, 'Jan 1 to Jul 20, 2026')).fontFamily).toBe(
      fontFamily(t.typography.mono),
    );
    expect(getComputedStyle(exact(profile, 'WHAT A PERSON CHECKED')).fontFamily).toBe(
      fontFamily(t.typography.mono),
    );
    expect(getComputedStyle(exact(profile, 'The filing covers these dates.')).fontWeight).not.toBe(
      '800',
    );
  });

  it('keeps missing spending as words and every displayed text color in the profile palette', () => {
    const profile = mount.querySelector('#profile')!;
    const unavailable = exact(profile, MONEY_OUT_OFFICIAL_MISSING);
    expect(getComputedStyle(unavailable).fontSize).toBe('14px');
    expect(getComputedStyle(unavailable).color).toBe(color(c.secondary));
    const palette = new Set(Object.values(c).map(color));
    for (const element of profile.querySelectorAll<HTMLElement>('*')) {
      if ([...element.childNodes].some((child) => child.nodeType === Node.TEXT_NODE)) {
        expect(palette.has(getComputedStyle(element).color)).toBe(true);
      }
    }
  });
});
