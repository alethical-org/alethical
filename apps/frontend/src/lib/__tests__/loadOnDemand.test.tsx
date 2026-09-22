// @vitest-environment jsdom

import { Component, act, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { loadAndRemember, loadOnDemand } from '../loadOnDemand';

function Screen() {
  return <p>the screen</p>;
}

/** Stands in for the app's own error screen, so a thrown piece has somewhere to land. */
class Caught extends Component<{ children: ReactNode }, { failed: Error | null }> {
  state = { failed: null as Error | null };
  static getDerivedStateFromError(failed: Error) {
    return { failed };
  }
  render() {
    return this.state.failed ? this.state.failed.message : this.props.children;
  }
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

  // A piece that never arrives almost always means a release replaced it while
  // this tab was open, and the app's error screen is what a reader sees. Drawing
  // nothing for ever instead would leave a blank page with no way out.
  it('hands a piece that never arrives to the app error screen', async () => {
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {});
    const load = () => Promise.reject(new Error('the piece is gone'));
    const Part = loadOnDemand(load);
    container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => {
      root.render(
        <Caught>
          <Part />
        </Caught>,
      );
    });
    await act(async () => {
      await new Promise((settle) => setTimeout(settle, 10));
    });

    expect(container.textContent).toBe('the piece is gone');
    quiet.mockRestore();
  });

  it('remembers a piece per loader, not for every piece at once', async () => {
    const fetched = () => Promise.resolve({ default: Screen });
    const notFetched = () => Promise.resolve({ default: Screen });
    await loadAndRemember(fetched);

    expect(drawOnce(loadOnDemand(notFetched))).toBe('');
  });
});
