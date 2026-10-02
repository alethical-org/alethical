// @vitest-environment jsdom

import { Component, act, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { loadAndRemember, loadOnDemand } from '../loadOnDemand';
import { markScreenDrawn, requestReleaseReload } from '../releaseReload';
vi.mock('../releaseReload', () => ({
  requestReleaseReload: vi.fn(() => false),
  markScreenDrawn: vi.fn(),
}));
vi.mock('../../components/AppErrorBoundary', () => ({
  AppFailureView: () => <p>This page hit a problem</p>,
}));

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
    expect(drawOnce(loadOnDemand(load, { kind: 'screen' }))).toBe('the screen');
  });

  it('waits for a piece nobody fetched ahead of time', async () => {
    const load = () => Promise.resolve({ default: Screen });

    expect(drawOnce(loadOnDemand(load, { kind: 'screen' }))).toBe('');
  });

  // A piece that never arrives almost always means a release replaced it while
  // this tab was open, and the app's error screen is what a reader sees. Drawing
  // nothing for ever instead would leave a blank page with no way out.
  it('hands a piece that never arrives to the app error screen', async () => {
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {});
    const load = () => Promise.reject(new Error('the piece is gone'));
    const Part = loadOnDemand(load, { kind: 'screen' });
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

    expect(container.textContent).toBe('This page hit a problem');
    quiet.mockRestore();
  });

  it('remembers a piece per loader, not for every piece at once', async () => {
    const fetched = () => Promise.resolve({ default: Screen });
    const notFetched = () => Promise.resolve({ default: Screen });
    await loadAndRemember(fetched);

    expect(drawOnce(loadOnDemand(notFetched, { kind: 'screen' }))).toBe('');
  });
});

it('ignores an abandoned download failure after usable results replace it', async () => {
  let reject!: (error: Error) => void;
  const Part = loadOnDemand(
    () =>
      new Promise((_resolve, fail) => {
        reject = fail;
      }),
    { kind: 'screen' },
  );
  container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => root.render(<Part />));
  await act(async () => root.render(<p>Successful candidate results</p>));
  vi.mocked(requestReleaseReload).mockClear();
  await act(async () => reject(new Error('late abandoned download')));
  expect(container.textContent).toBe('Successful candidate results');
  expect(requestReleaseReload).not.toHaveBeenCalled();
  await act(async () => root.unmount());
});

it('marks a ready route as drawn before later downloads can reload it', async () => {
  vi.mocked(markScreenDrawn).mockClear();
  const load = () => Promise.resolve({ default: Screen });
  await loadAndRemember(load);
  drawOnce(loadOnDemand(load, { kind: 'screen' }));
  expect(markScreenDrawn).toHaveBeenCalledOnce();
});

it.each(['section', 'optional'] as const)(
  'keeps surrounding content on a failed %s download',
  async (kind) => {
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(requestReleaseReload).mockClear();
    const Part = loadOnDemand(() => Promise.reject(new Error('missing')), { kind });
    container = document.createElement('div');
    const root = createRoot(container);
    await act(async () =>
      root.render(
        <Caught>
          <p>Saved results</p>
          <Part />
        </Caught>,
      ),
    );
    expect(container.textContent).toContain('Saved results');
    expect(container.textContent).not.toContain('missing');
    expect(requestReleaseReload).not.toHaveBeenCalled();
    if (kind === 'section') expect(container.textContent).toContain('This page hit a problem');
    await act(async () => root.unmount());
    quiet.mockRestore();
  },
);

it('uses a caller recovery message once when an optional dialog cannot download', async () => {
  const quiet = vi.spyOn(console, 'error').mockImplementation(() => {});
  const notify = vi.fn();
  const Part = loadOnDemand(() => Promise.reject(new Error('missing')), {
    kind: 'optional',
    onFailure: (props) => props.notify(),
  });
  container = document.createElement('div');
  const root = createRoot(container);
  await act(async () => root.render(<Part notify={notify} />));
  expect(notify).toHaveBeenCalledOnce();
  await act(async () => root.unmount());
  quiet.mockRestore();
});
