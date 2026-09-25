// @vitest-environment jsdom

import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  (globalThis as { __DEV__?: boolean }).__DEV__ = false;
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
const mocks = vi.hoisted(() => ({ inspect: vi.fn(), stop: vi.fn() }));
vi.mock('../../../data/emailSubscriptions', () => ({
  inspectEmailUnsubscribeToken: mocks.inspect,
  unsubscribeFromEmail: mocks.stop,
}));
vi.mock('../../../hooks/useResponsive', () => ({
  useResponsive: () => ({ isMobile: false }),
}));
vi.mock('../../../theme/primitives', async () => {
  const { View } = await import('react-native');
  return {
    PageBackground: ({ children }: { children: ReactNode }) => <View>{children}</View>,
    Container: ({ children }: { children: ReactNode }) => <View>{children}</View>,
    TopNav: () => null,
    Footer: () => null,
  };
});

import { UnsubscribeScreen } from '../UnsubscribeScreen';

let host: HTMLElement;
let root: Root;
beforeEach(() => {
  window.history.replaceState(null, '', '/unsubscribe#unsubscribe=secret-example-token');
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  mocks.inspect.mockReset().mockResolvedValue(true);
  mocks.stop.mockReset().mockResolvedValue(true);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

it('only stops emails after the reader chooses a purpose', async () => {
  await act(async () => {
    root.render(<UnsubscribeScreen navigation={{ navigate: vi.fn() } as any} route={{} as any} />);
    await Promise.resolve();
  });
  expect(mocks.inspect).toHaveBeenCalledWith('secret-example-token');
  expect(mocks.stop).not.toHaveBeenCalled();
  expect(window.location.hash).toBe('');
  const action = [...host.querySelectorAll<HTMLElement>('[role="button"]')].find((button) =>
    button.textContent?.includes('Stop all research and feature emails'),
  );
  expect(action).toBeDefined();
  await act(async () => {
    action!.click();
    await Promise.resolve();
  });
  expect(mocks.stop).toHaveBeenCalledWith('secret-example-token', 'all');
  expect(host.textContent).toContain('Research and feature emails have stopped');
  expect(host.textContent).not.toContain('reader@example.com');
});
