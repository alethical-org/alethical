// @vitest-environment jsdom
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import {
  HOME_PUBLIC_MONEY_BODY,
  HOME_PUBLIC_MONEY_CTA,
  MONEY_PROMO_BODY,
  MONEY_PROMO_COUNT_UNIT,
  MONEY_PROMO_CTA,
} from '../../../lib/homepage';
import { MoneyPromoCard, type MoneyPromoVariant } from '../MoneyPromoCard';

vi.mock('react-native-svg', () => ({
  default: () => null,
  Path: () => null,
}));

function render(variant: MoneyPromoVariant, filerCount: number | null, countLoading = false) {
  const page = document.createElement('div');
  page.innerHTML = renderToStaticMarkup(
    <MoneyPromoCard
      variant={variant}
      filerCount={filerCount}
      countLoading={countLoading}
      onPress={vi.fn()}
    />,
  );
  return page;
}

describe('public money card variants', () => {
  it.each(['desktopSignedOut', 'tabletSignedOut', 'phoneSignedOut'] as const)(
    '%s links the whole card without a nested action',
    (variant) => {
      const page = render(variant, 1603);
      const links = page.querySelectorAll('a');
      expect(links).toHaveLength(1);
      const card = links[0];
      expect(card.getAttribute('href')).toBe('/money');
      expect(card.getAttribute('tabindex')).toBe('0');
      expect(card.textContent).toContain('Follow the money');
      expect(card.textContent).toContain(HOME_PUBLIC_MONEY_BODY);
      expect(card.textContent).toContain(HOME_PUBLIC_MONEY_CTA);
      expect(card.textContent).toContain(`1,603 ${MONEY_PROMO_COUNT_UNIT}`);
      expect(card.querySelectorAll('a, button, [role="button"], [tabindex="0"]')).toHaveLength(0);
    },
  );

  it.each(['desktopSignedOut', 'tabletSignedOut', 'phoneSignedOut'] as const)(
    '%s hides unavailable counts rather than presenting zero',
    (variant) => {
      const page = render(variant, null);
      expect(page.textContent).not.toContain(MONEY_PROMO_COUNT_UNIT);
      expect(page.textContent).not.toContain('1,603');
      expect(page.textContent).not.toContain('0 registered');
      expect(page.querySelector('[aria-busy]')).toBeNull();
      expect(page.querySelector('a')?.textContent).toContain(HOME_PUBLIC_MONEY_CTA);
    },
  );

  it('announces a pending count without claiming a number', () => {
    const page = render('phoneSignedOut', null, true);
    expect(page.querySelector('[aria-busy="true"]')?.getAttribute('aria-label')).toBe(
      'Loading how many filers the register holds',
    );
    expect(page.textContent).not.toContain(MONEY_PROMO_COUNT_UNIT);
    expect(page.textContent).not.toContain('0 registered');
  });
});

describe('signed-in money card remains unchanged', () => {
  it.each(['desktop', 'tabletSignedIn', 'phoneSignedIn'] as const)(
    '%s keeps its existing copy and action-only link',
    (variant) => {
      const page = render(variant, 1603);
      expect(page.textContent).toContain(MONEY_PROMO_BODY);
      expect(page.textContent).not.toContain(HOME_PUBLIC_MONEY_BODY);
      const links = page.querySelectorAll('a');
      expect(links).toHaveLength(1);
      const action = links[0];
      expect(action.getAttribute('href')).toBe('/money');
      expect(action.textContent).toBe(MONEY_PROMO_CTA);
      expect(action.textContent).not.toContain('Follow the money');
      expect(page.textContent).not.toContain(HOME_PUBLIC_MONEY_CTA);
    },
  );
});
