import { act, lazy, type ComponentType } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { DeferredScreen, ScreenReady, useScreenFocus } from '../routeLoading';
import { navigate, useLocation } from '../router';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function delayedPage() {
  let resolve!: (value: { default: ComponentType }) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<{ default: ComponentType }>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  const load = vi.fn(() => promise);
  const Page = lazy(load);
  return { Page, load, resolve, reject, promise };
}

let container: HTMLDivElement;
let root: Root;
let scroll: ReturnType<typeof vi.fn>;

beforeEach(() => {
  window.history.replaceState(null, '', '/home');
  window.sessionStorage.clear();
  scroll = vi.fn();
  vi.stubGlobal('scrollTo', scroll);
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function harness(Page: ComponentType, reload = vi.fn()) {
  return function Harness({ allowed = true }: { allowed?: boolean }) {
    const location = useLocation();
    const ready = useScreenFocus(`${location.pathname}|${allowed}`);
    const content =
      location.pathname === '/home' || !allowed ? (
        <main>
          <h1 tabIndex={-1}>{allowed ? 'Home' : 'Access ended'}</h1>
        </main>
      ) : (
        <Page />
      );
    return (
      <>
        <header>
          <button>Navigation</button>
        </header>
        {allowed && location.pathname !== '/home' ? (
          <DeferredScreen onReady={ready} reload={reload} resetKey={location.pathname}>
            {content}
          </DeferredScreen>
        ) : (
          <ScreenReady onReady={ready}>{content}</ScreenReady>
        )}
      </>
    );
  };
}

const Destination = () => (
  <main>
    <h1 tabIndex={-1}>Destination</h1>
  </main>
);

it('keeps first-arrival focus, then focuses a delayed destination only when it exists', async () => {
  const chunk = delayedPage();
  const Harness = harness(chunk.Page);
  await act(async () => root.render(<Harness />));
  expect(document.activeElement).toBe(document.body);
  expect(scroll).not.toHaveBeenCalled();
  const nav = container.querySelector('button')!;
  nav.focus();
  await act(async () => navigate('/detail'));
  expect(chunk.load).toHaveBeenCalledTimes(1);
  expect(container.querySelector('main[aria-busy="true"]')?.textContent).toBe('Loading page…');
  expect(document.activeElement).toBe(nav);
  expect(scroll).not.toHaveBeenCalled();
  await act(async () => chunk.resolve({ default: Destination }));
  expect(document.activeElement).toBe(container.querySelector('main h1'));
  expect(scroll).toHaveBeenCalledExactlyOnceWith(0, 0);
});

it('does not autofocus a cold direct route when its code arrives', async () => {
  window.history.replaceState(null, '', '/detail');
  const chunk = delayedPage();
  const Harness = harness(chunk.Page);
  await act(async () => root.render(<Harness />));
  await act(async () => chunk.resolve({ default: Destination }));
  expect(document.activeElement).toBe(document.body);
  expect(scroll).not.toHaveBeenCalled();
});

it('does not mount an abandoned page or steal focus after navigation away', async () => {
  const chunk = delayedPage();
  const mount = vi.fn();
  const Harness = harness(chunk.Page);
  await act(async () => root.render(<Harness />));
  await act(async () => navigate('/detail'));
  await act(async () => navigate('/home'));
  const home = document.activeElement;
  scroll.mockClear();
  await act(async () =>
    chunk.resolve({
      default: () => {
        mount();
        return <Destination />;
      },
    }),
  );
  expect(mount).not.toHaveBeenCalled();
  expect(document.activeElement).toBe(home);
  expect(scroll).not.toHaveBeenCalled();
});

it('does not mount a pending private page when access ends', async () => {
  const chunk = delayedPage();
  const mount = vi.fn();
  const Harness = harness(chunk.Page);
  await act(async () => root.render(<Harness />));
  await act(async () => navigate('/detail'));
  await act(async () => root.render(<Harness allowed={false} />));
  await act(async () =>
    chunk.resolve({
      default: () => {
        mount();
        return <Destination />;
      },
    }),
  );
  expect(mount).not.toHaveBeenCalled();
  expect(container.textContent).toContain('Access ended');
});

it('restores saved history scroll after the destination commits', async () => {
  const chunk = delayedPage();
  const Harness = harness(chunk.Page);
  await act(async () => root.render(<Harness />));
  window.sessionStorage.setItem('alethical-finance-scroll:/detail', '480');
  await act(async () => {
    window.history.replaceState(null, '', '/detail');
    window.dispatchEvent(new PopStateEvent('popstate'));
  });
  expect(scroll).not.toHaveBeenCalled();
  await act(async () => chunk.resolve({ default: Destination }));
  expect(scroll).toHaveBeenCalledExactlyOnceWith(0, 480);
  expect(document.activeElement).toBe(container.querySelector('h1'));
});

it('preserves search focus on an explicitly in-place address change', async () => {
  const Search = () => (
    <main>
      <h1 tabIndex={-1}>Search</h1>
      <input />
    </main>
  );
  const Harness = harness(Search);
  await act(async () => root.render(<Harness />));
  await act(async () => navigate('/search/first'));
  const input = container.querySelector('input')!;
  input.focus();
  scroll.mockClear();
  await act(async () => navigate('/search/next', { preserveFocus: true, replace: true }));
  expect(document.activeElement).toBe(input);
  expect(scroll).not.toHaveBeenCalled();
});

it('offers an explicit current-page reload after a rejected chunk, without a reload loop', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  const chunk = delayedPage();
  const reload = vi.fn();
  const Harness = harness(chunk.Page, reload);
  await act(async () => root.render(<Harness />));
  await act(async () => navigate('/detail'));
  await act(async () => chunk.reject(new Error('missing deployment chunk')));
  expect(container.querySelector('[role="alert"]')?.textContent).toContain('Reload this page');
  expect(document.activeElement).toBe(container.querySelector('h1'));
  expect(reload).not.toHaveBeenCalled();
  const button = [...container.querySelectorAll('button')].find(
    (item) => item.textContent === 'Reload page',
  )!;
  await act(async () => button.click());
  expect(reload).toHaveBeenCalledTimes(1);
});

it('recovers from one record render error when opening another record in the same family', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  const Record = () => {
    if (window.location.pathname === '/records/broken') throw new Error('Record unavailable');
    return <Destination />;
  };
  const Harness = harness(Record);
  await act(async () => root.render(<Harness />));
  await act(async () => navigate('/records/broken'));
  expect(container.textContent).toContain('Couldn’t load this page');
  await act(async () => navigate('/records/valid'));
  expect(container.textContent).toContain('Destination');
  expect(container.querySelector('[role="alert"]')).toBeNull();
  expect(document.activeElement).toBe(container.querySelector('h1'));
});

it('keeps later destinations behind Reload after a failed Vite CSS or script preload', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  const mounted = vi.fn();
  const Page = () => {
    mounted();
    return <Destination />;
  };
  const Harness = harness(Page);
  await act(async () => root.render(<Harness />));
  await act(async () => navigate('/elections/first'));
  mounted.mockClear();
  const error = new Event('vite:preloadError', { cancelable: true });
  await act(async () => window.dispatchEvent(error));
  expect(error.defaultPrevented).toBe(false);
  expect(container.textContent).toContain('Reload page');
  await act(async () => navigate('/elections/second'));
  expect(mounted).not.toHaveBeenCalled();
  expect(container.textContent).toContain('Reload page');
  expect(container.textContent).not.toContain('Destination');
});
