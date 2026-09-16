// @vitest-environment jsdom

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';

import { loadAndRemember, loadOnDemand } from '../loadOnDemand';

function Screen() {
  return <p>the screen</p>;
}

let container: HTMLDivElement | null = null;

afterEach(() => {
  container?.remove();
  container = null;
});

function drawOnce(Part: ReturnType<typeof loadOnDemand>) {
  container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(<Part />);
  });
  return container.textContent;
}

describe('loadOnDemand', () => {
  it('draws a piece the browser already holds on the very first draw', async () => {
    const load = () => Promise.resolve({ default: Screen });
    await loadAndRemember(load);

    // Nothing empty in between. An empty first draw is what costs every page
    // 300 ms: React holds back whatever replaces it for that long
    // (https://github.com/alethical-org/alethical/issues/2222).
    expect(drawOnce(loadOnDemand(load))).toBe('the screen');
  });

  it('waits for a piece nobody fetched ahead of time', async () => {
    const load = () => Promise.resolve({ default: Screen });

    expect(drawOnce(loadOnDemand(load))).toBe('');
  });

  it('remembers a piece per loader, not for every piece at once', async () => {
    const fetched = () => Promise.resolve({ default: Screen });
    const notFetched = () => Promise.resolve({ default: Screen });
    await loadAndRemember(fetched);

    expect(drawOnce(loadOnDemand(notFetched))).toBe('');
  });
});
