// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { HomeLegislatorFinder } from '../HomeLegislatorFinder';

vi.hoisted(() => {
  (globalThis as { __DEV__?: boolean }).__DEV__ = false;
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
vi.mock('react-native-svg', () => ({
  default: ({ children }: React.PropsWithChildren) => <svg>{children}</svg>,
  Circle: () => <circle />,
  Path: () => <path />,
  Polygon: () => <polygon />,
}));

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
const address = '350 S 5th St, Minneapolis, MN 55415';
function type(value: string) {
  const input = host.querySelector<HTMLTextAreaElement>('textarea')!;
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(
      input,
      value,
    );
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  return input;
}
function findButton() {
  return [...host.querySelectorAll<HTMLElement>('[role="button"]')].find((button) =>
    /^(Find|Find my legislator)$/.test(button.textContent ?? ''),
  )!;
}

it.each(['phone', 'tablet', 'desktop'] as const)(
  'clears the homepage %s field without navigation, then accepts a replacement address',
  (layout) => {
    const navigate = vi.fn();
    act(() => root.render(<HomeLegislatorFinder layout={layout} onNavigate={navigate} />));
    const input = type(address);
    expect(findButton().textContent).toBe(layout === 'desktop' ? 'Find' : 'Find my legislator');
    const clear = host.querySelector<HTMLButtonElement>('[aria-label="Clear address"]')!;
    expect(clear.style.visibility).not.toBe('hidden');
    act(() => clear.click());
    expect(input.value).toBe('');
    expect(document.activeElement).toBe(input);
    expect(navigate).not.toHaveBeenCalled();
    type('100 Replacement St, Minneapolis MN 55415');
    act(() => findButton().click());
    expect(navigate).toHaveBeenCalledWith(
      expect.objectContaining({
        address: '100 Replacement St, Minneapolis MN 55415',
        lookupAddress: true,
      }),
    );
    expect(host.textContent).not.toContain('No match for that address');
  },
);

it('shows clear for silent browser fill without starting a lookup', () => {
  vi.useFakeTimers();
  const navigate = vi.fn();
  act(() => root.render(<HomeLegislatorFinder layout="desktop" onNavigate={navigate} />));
  const input = host.querySelector<HTMLTextAreaElement>('textarea')!;
  Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(
    input,
    address,
  );
  act(() => vi.advanceTimersByTime(500));
  expect(
    host.querySelector<HTMLButtonElement>('[aria-label="Clear address"]')!.style.visibility,
  ).not.toBe('hidden');
  expect(navigate).not.toHaveBeenCalled();
  act(() => host.querySelector<HTMLButtonElement>('[aria-label="Clear address"]')!.click());
  expect(input.value).toBe('');
});

it('normalizes pasted line breaks and submits Enter without inserting a newline', () => {
  const navigate = vi.fn();
  act(() => root.render(<HomeLegislatorFinder layout="phone" onNavigate={navigate} />));
  const input = type('350 S 5th St\nMinneapolis, MN 55415');
  expect(input.value).toBe(address.replace(', Minneapolis', ' Minneapolis'));
  act(() =>
    input.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
    ),
  );
  expect(navigate).toHaveBeenCalledWith(
    expect.objectContaining({ address: input.value, lookupAddress: true }),
  );
  expect(input.value).not.toContain('\n');
});

it('keeps the location waiting message and ignores its response after leaving the homepage', () => {
  let finish!: PositionCallback;
  vi.stubGlobal('navigator', {
    ...navigator,
    geolocation: {
      getCurrentPosition: (success: PositionCallback) => {
        finish = success;
      },
    },
  });
  const navigate = vi.fn();
  act(() => root.render(<HomeLegislatorFinder layout="phone" onNavigate={navigate} />));
  type(address);
  const location = [...host.querySelectorAll<HTMLElement>('[role="button"]')].find(
    (button) => button.textContent === 'Use my location',
  )!;
  act(() => location.click());
  expect(host.textContent).toContain('Finding your location…');
  expect(
    host.querySelector<HTMLButtonElement>('[aria-label="Clear address"]')!.style.visibility,
  ).toBe('hidden');
  act(() => root.render(<div>Another screen</div>));
  act(() => finish({ coords: { latitude: 44.9, longitude: -93.2 } } as GeolocationPosition));
  expect(navigate).not.toHaveBeenCalled();
});
