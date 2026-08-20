// @vitest-environment jsdom

import { act, ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

const auth = vi.hoisted(() => ({
  setPassword: vi.fn(async () => ({ ok: true }) as const),
  signOut: vi.fn(async () => ({ ok: true }) as const),
}));
const responsive = vi.hoisted(() => ({ isMobile: true, width: 390 }));

vi.mock('../../../providers/AuthProvider', () => ({
  useAuth: () => ({
    user: {
      id: '1',
      name: 'Marissa Chen',
      email: 'marissa@example.com',
      signInMethods: { google: true, password: false },
    },
    setPassword: auth.setPassword,
    signOut: auth.signOut,
  }),
}));

vi.mock('react-native-svg', () => ({
  default: ({ children }: { children?: ReactNode }) => <svg>{children}</svg>,
  Circle: () => <circle />,
  Path: () => <path />,
}));

// AccountControl's Tracked Bills row reads the watchlist and the navigator
// (#1698). Both are mocked at the boundary, like the auth provider above: the
// real `@react-navigation/native` and the query layer that reaches it pull in a
// React Native source file Node cannot parse, so importing this module at all
// would fail before a single assertion ran.
vi.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: vi.fn() }),
}));

vi.mock('../../../hooks/useAppQueries', () => ({
  useTrackedBills: () => ({ data: undefined }),
}));

vi.mock('../../../hooks/useResponsive', () => ({
  useResponsive: () => ({
    width: responsive.width,
    isMobile: responsive.isMobile,
    isTablet: false,
    isDesktop: !responsive.isMobile,
  }),
}));

vi.mock('../../../hooks/useReducedMotion', () => ({
  useReducedMotion: () => true,
}));

import { SetPasswordDialog } from '../AccountControl';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

class PhoneViewport extends EventTarget {
  height = 844;
}

afterEach(() => {
  document.body.replaceChildren();
  Reflect.deleteProperty(HTMLElement.prototype, 'scrollIntoView');
  responsive.isMobile = true;
  responsive.width = 390;
  vi.restoreAllMocks();
});

describe('phone password action visibility', () => {
  it('reveals both actions when confirmation is focused before or after the keyboard opens', () => {
    const phoneViewport = new PhoneViewport();
    Object.defineProperty(window, 'visualViewport', {
      configurable: true,
      value: phoneViewport,
    });
    const scrollIntoView = vi.fn();
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value: scrollIntoView,
    });
    const mount = document.createElement('div');
    document.body.append(mount);
    const root = createRoot(mount);

    act(() => root.render(<SetPasswordDialog open onClose={vi.fn()} />));

    const actions = [...document.querySelectorAll<HTMLElement>('div')].find(
      (element) => element.textContent === 'Save passwordCancel' && element.children.length === 2,
    );
    if (!actions?.parentElement?.parentElement?.parentElement) {
      throw new Error('Password sheet scroll parents were not rendered');
    }
    const formWrapper = actions.parentElement;
    const contentWrapper = formWrapper.parentElement!;
    const sheetScroller = contentWrapper.parentElement!;
    for (const [element, clientHeight, scrollHeight] of [
      [formWrapper, 355, 355],
      [contentWrapper, 624, 624],
      [sheetScroller, 422, 624],
    ] as const) {
      Object.defineProperties(element, {
        clientHeight: { configurable: true, value: clientHeight },
        scrollHeight: { configurable: true, value: scrollHeight },
      });
    }
    let sheetScrollTop = 0;
    Object.defineProperty(sheetScroller, 'scrollTop', {
      configurable: true,
      get: () => sheetScrollTop,
      set: (value: number) => {
        sheetScrollTop = Math.min(value, 624 - 422);
      },
    });

    const confirmation = document.querySelectorAll<HTMLInputElement>(
      'input[autocomplete="new-password"]',
    )[1];
    expect(confirmation).not.toBeNull();

    act(() => confirmation?.focus());

    expect(document.activeElement).toBe(confirmation);
    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'end', inline: 'nearest' });
    expect((scrollIntoView.mock.instances[0] as HTMLElement).textContent).toContain(
      'Save passwordCancel',
    );
    expect(formWrapper.scrollTop).toBe(0);
    expect(contentWrapper.scrollTop).toBe(0);
    expect(sheetScroller.scrollTop).toBe(202);

    scrollIntoView.mockClear();
    act(() => {
      phoneViewport.height = 520;
      phoneViewport.dispatchEvent(new Event('resize'));
    });

    expect(document.activeElement).toBe(confirmation);
    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'end', inline: 'nearest' });

    scrollIntoView.mockClear();
    act(() => {
      phoneViewport.height = 844;
      phoneViewport.dispatchEvent(new Event('resize'));
    });
    expect(scrollIntoView).not.toHaveBeenCalled();

    act(() => root.unmount());
  });

  it('leaves the desktop dialog in place', () => {
    responsive.isMobile = false;
    responsive.width = 1200;
    const phoneViewport = new PhoneViewport();
    Object.defineProperty(window, 'visualViewport', {
      configurable: true,
      value: phoneViewport,
    });
    const scrollIntoView = vi.fn();
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value: scrollIntoView,
    });
    const mount = document.createElement('div');
    document.body.append(mount);
    const root = createRoot(mount);

    act(() => root.render(<SetPasswordDialog open onClose={vi.fn()} />));
    const confirmation = document.querySelectorAll<HTMLInputElement>(
      'input[autocomplete="new-password"]',
    )[1];
    act(() => confirmation?.focus());
    act(() => {
      phoneViewport.height = 520;
      phoneViewport.dispatchEvent(new Event('resize'));
    });

    expect(document.activeElement).toBe(confirmation);
    expect(scrollIntoView).not.toHaveBeenCalled();

    act(() => root.unmount());
  });
});
