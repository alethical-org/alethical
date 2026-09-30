// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ArticleTitleText, useArticleTitleOverflow } from '../ArticleTitleText';
import { LOBBYIST_GIVING } from '../../lib/researchPieces/lobbyistGiving';

function Heading() {
  const overflow = useArticleTitleOverflow(LOBBYIST_GIVING.title);
  return (
    <h1 {...overflow} style={{ overflowX: 'auto', fontSize: 32 }}>
      <ArticleTitleText title={LOBBYIST_GIVING.title} />
    </h1>
  );
}

afterEach(() => vi.unstubAllGlobals());

describe('Keyboard access to exceptionally narrow titles', () => {
  it('adds a keyboard stop only for overflow and retains the exact unbroken title', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    let resize = () => {};
    const disconnect = vi.fn();
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(callback: () => void) {
          resize = callback;
        }
        observe() {}
        disconnect = disconnect;
      },
    );
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    await act(async () => root.render(<Heading />));
    const heading = host.querySelector('h1')!;
    const range = heading.querySelector('span')!;
    expect(heading.hasAttribute('tabindex')).toBe(false);
    expect(heading.textContent).toBe(LOBBYIST_GIVING.title);
    expect(range.textContent).toBe('2015–2026');
    expect(range.style.whiteSpace).toBe('nowrap');
    expect(heading.style.fontSize).toBe('32px');
    expect(heading.style.overflowX).toBe('auto');
    Object.defineProperty(heading, 'clientWidth', { configurable: true, value: 147 });
    Object.defineProperty(heading, 'scrollWidth', { configurable: true, value: 180 });
    await act(async () => resize());
    expect(heading.tabIndex).toBe(0);
    heading.focus();
    expect(document.activeElement).toBe(heading);
    Object.defineProperty(heading, 'clientWidth', { configurable: true, value: 280 });
    await act(async () => resize());
    expect(heading.hasAttribute('tabindex')).toBe(false);
    expect(heading.textContent).toBe(LOBBYIST_GIVING.title);
    await act(async () => root.unmount());
    expect(disconnect).toHaveBeenCalledOnce();
    host.remove();
  });
});
