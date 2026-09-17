// @vitest-environment jsdom
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { SessionWatchCard } from '../SessionWatchCard';

vi.mock('react-native-svg', () => ({
  default: ({
    children,
    testID,
    ...props
  }: React.SVGProps<SVGSVGElement> & { testID?: string }) => (
    <svg data-testid={testID} {...props}>
      {children}
    </svg>
  ),
  Path: (props: React.SVGProps<SVGPathElement>) => <path {...props} />,
  Circle: (props: React.SVGProps<SVGCircleElement>) => <circle {...props} />,
}));

function render(state: 'failed' | 'tracking-nothing' | 'quiet') {
  const page = document.createElement('div');
  page.innerHTML = renderToStaticMarkup(
    <SessionWatchCard
      watch={{ state, rows: [], movedCount: 0, capCaption: '', heroLine: '', glyph: 'clock' }}
      onBill={vi.fn()}
      onAllTracked={vi.fn()}
      onSearchBills={vi.fn()}
      onWhatsMoving={vi.fn()}
      onRetry={vi.fn()}
    />,
  );
  return page;
}

describe('session watch actions and destination links', () => {
  it.each(['failed', 'tracking-nothing'] as const)(
    'keeps the original small arrow on the %s in-page jump',
    (state) => {
      const action = [...render(state).querySelectorAll('[role="link"]')].find(
        (element) => element.textContent === 'Or start from what’s moving now',
      )!;
      expect(action.hasAttribute('href')).toBe(false);
      expect(action.querySelector('[data-testid="link-arrow"]')).toBeNull();
      expect(action.querySelector('svg')?.getAttribute('width')).toBe('14');
      expect(action.querySelector('path')?.getAttribute('stroke-width')).toBe('1.8');
      expect(action.querySelector('path')?.getAttribute('d')).toBe(
        'M3.5 12 H19.5 M13 6 L19.5 12 L13 18',
      );
    },
  );

  it('keeps the approved destination arrow for All tracked bills', () => {
    const link = render('quiet').querySelector('a[href="/tracked"]')!;
    expect(link.textContent).toBe('All tracked bills');
    expect(link.querySelector('[data-testid="link-arrow"]')).not.toBeNull();
    expect(link.querySelector('svg')?.getAttribute('width')).toBe('19');
  });
});
