// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('react-native-svg', () => ({
  default: ({ children }: { children?: React.ReactNode }) => <svg>{children}</svg>,
  Path: () => <path />,
}));

import {
  CampaignMoneyCardTheme,
  CheckedByBlock,
  Figure,
  FilingStamp,
  MoneyInBlock,
  MoneyOutBlock,
} from '../MoneyCards';
import { BOARD_RECORD_LINK_LABEL } from '../../../lib/boardRecordLink';
import { CAMPAIGN_MONEY_COLORS as c } from '../../../lib/campaignMoneyColors';
import {
  itemizedContributionsNote,
  MONEY_OUT_OFFICIAL_MISSING,
} from '../../../lib/committeeMoneyShared';
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
        boardRecordUrl="https://cfb.mn.gov/reports-and-data/viewers/campaign-finance/candidates/18430/2026/"
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
      expect(anchor.getAttribute('href')).toMatch(/^https:\/\/cfb\.mn\.gov\//);
    }
    // The stamp's link is the sentence's own subject, so it is body copy: underlined
    // the way a link inside a paragraph is, and never padded out to a row's 44px
    // target. The card's row links keep that target.
    const inline = anchors.find((a) => a.textContent === BOARD_RECORD_LINK_LABEL)!;
    const row = anchors.find((a) => a !== inline)!;
    expect(getComputedStyle(inline).minHeight).not.toBe('44px');
    expect(getComputedStyle(inline).textDecorationLine).toBe('underline');
    expect(inline.textContent).toBe(BOARD_RECORD_LINK_LABEL);
    expect(getComputedStyle(row).minHeight).toBe('44px');
    const oldLink = defaults.querySelector('a')!;
    expect(getComputedStyle(oldLink).color).toBe(color(t.colors.brand.base));
    expect(getComputedStyle(oldLink).minHeight).not.toBe('44px');
    act(() => row.focus());
    expect(getComputedStyle(row).outlineColor).toBe(color(c.focus));
    expect(getComputedStyle(row).outlineWidth).toBe('2px');
    act(() => row.blur());
    expect(getComputedStyle(row).outlineWidth).not.toBe('2px');
  });

  it('uses Libre Franklin and tabular digits for amounts, dates and counts', () => {
    const profile = mount.querySelector('#profile')!;
    const defaults = mount.querySelector('#default')!;
    for (const text of [
      '$1,000',
      'Through Jul 20, 2026',
      'Checked by Alethical on Aug 30, 2026',
      'Public Subsidy · 2 payments',
    ]) {
      const style = getComputedStyle(exact(profile, text));
      expect(style.fontFamily).toBe(fontFamily(t.typography.body));
      expect(style.fontWeight).toBe('800');
      expect(style.fontVariant).toBe('tabular-nums');
    }
    const note = getComputedStyle(exact(profile, '134 payments in 2026'));
    expect(note.fontWeight).toBe('400');
    expect(note.fontVariant).toBe('tabular-nums');
    const period = getComputedStyle(exact(profile, 'Jan 1 to Jul 20, 2026'));
    expect(period.fontFamily).toBe(fontFamily(t.typography.body));
    expect(period.fontWeight).toBe('700');
    expect(period.color).toBe(color(c.text));
    expect(getComputedStyle(exact(defaults, 'Jan 1 to Jul 20, 2026')).fontFamily).toBe(
      fontFamily(t.typography.body),
    );
    expect(profile.textContent).not.toContain('WHAT A PERSON CHECKED');
    expect(getComputedStyle(exact(profile, 'The filing covers these dates.')).fontWeight).not.toBe(
      '800',
    );
  });

  it('keeps supporting paragraphs regular when the sentence contains a dollar threshold', () => {
    const profile = mount.querySelector('#profile')!;
    const explanation = exact(profile, itemizedContributionsNote(false));
    expect(explanation.textContent).toContain('$200');
    expect(['normal', '400']).toContain(getComputedStyle(explanation).fontWeight);
    expect(getComputedStyle(exact(profile, '$1,000')).fontWeight).toBe('800');
  });

  it('opens the checked block on its date and aligns the plain evidence list beneath it', () => {
    const profile = mount.querySelector('#profile')!;
    const date = exact(profile, 'Checked by Alethical on Aug 30, 2026');
    const block = date.parentElement!;
    expect(block.firstElementChild).toBe(date);
    const dateStyle = getComputedStyle(date);
    expect(dateStyle.fontSize).toBe('15px');
    expect(dateStyle.fontWeight).toBe('800');
    expect(getComputedStyle(block).paddingTop).toBe('18px');
    // The outer card foot owns its spacing, outside the evidence block.
    expect(getComputedStyle(block).marginTop).toBe('0px');
    expect(getComputedStyle(block).borderTopColor).toBe('rgba(17, 21, 15, 0.08)');
    const evidence = date.nextElementSibling!;
    expect(evidence.getAttribute('role')).toBe('list');
    expect(getComputedStyle(evidence).paddingLeft).toBe('0px');
    expect(getComputedStyle(evidence).gap).toBe('4px');
    expect(evidence.children).toHaveLength(3);
    for (const sentence of evidence.children) {
      expect(sentence.getAttribute('role')).toBe('listitem');
      const sentenceStyle = getComputedStyle(sentence);
      expect(sentenceStyle.fontSize).toBe('15px');
      expect(sentenceStyle.fontWeight).toBe('400');
      expect(sentenceStyle.color).toBe(color(c.secondary));
    }
  });

  it('keeps the date and person link visible while committee evidence opens separately', () => {
    act(() =>
      root.render(
        <CheckedByBlock
          collapsibleEvidence
          checkerNamedAbove
          checked={{
            checkedOn: '2026-08-30',
            nameEvidence: 'exact',
            registerVerdict: 'same_seat',
            partyAgreement: 'agrees',
          }}
        >
          <a href="/legislators/example?tab=money&year=2026">See this person’s campaign money</a>
        </CheckedByBlock>,
      ),
    );
    const button = mount.querySelector('button')!;
    const content = document.getElementById(button.getAttribute('aria-controls')!)!;
    expect(button.textContent).toBe('How Alethical confirmed this');
    expect(button.getAttribute('aria-expanded')).toBe('false');
    expect(content.hidden).toBe(true);
    expect(exact(mount, 'Checked Aug 30, 2026').closest('[hidden]')).toBeNull();
    expect(mount.querySelector('a')?.closest('[hidden]')).toBeNull();
    expect(button.previousElementSibling?.tagName).toBe('A');
    act(() => button.click());
    expect(content.hidden).toBe(false);
    expect(button.getAttribute('aria-expanded')).toBe('true');
    expect(content.querySelectorAll('[role="listitem"]')).toHaveLength(3);
  });

  it('takes evidence state from the address when controlled', () => {
    const onEvidenceOpenChange = vi.fn();
    const draw = (evidenceOpen: boolean) =>
      act(() =>
        root.render(
          <CheckedByBlock
            collapsibleEvidence
            evidenceOpen={evidenceOpen}
            onEvidenceOpenChange={onEvidenceOpenChange}
            checked={{
              checkedOn: '2026-08-30',
              nameEvidence: 'exact',
              registerVerdict: 'same_seat',
              partyAgreement: 'agrees',
            }}
          />,
        ),
      );
    draw(true);
    const button = mount.querySelector('button')!;
    expect(button.getAttribute('aria-expanded')).toBe('true');
    act(() => button.click());
    expect(onEvidenceOpenChange).toHaveBeenLastCalledWith(false);
    draw(false);
    expect(button.getAttribute('aria-expanded')).toBe('false');
  });

  it('prints no checked block when no stored decision is held', () => {
    act(() => root.render(<CheckedByBlock checked={null} />));
    expect(mount.textContent).toBe('');
    expect(mount.querySelector('[role="list"]')).toBeNull();
  });

  it('keeps missing spending as words and every displayed text color in the profile palette', () => {
    const profile = mount.querySelector('#profile')!;
    const unavailable = exact(profile, MONEY_OUT_OFFICIAL_MISSING);
    expect(getComputedStyle(unavailable).fontSize).toBe('15px');
    expect(getComputedStyle(unavailable).color).toBe(color(c.secondary));
    const palette = new Set(Object.values(c).map(color));
    for (const element of profile.querySelectorAll<HTMLElement>('*')) {
      if ([...element.childNodes].some((child) => child.nodeType === Node.TEXT_NODE)) {
        expect(palette.has(getComputedStyle(element).color)).toBe(true);
      }
    }
  });
});
