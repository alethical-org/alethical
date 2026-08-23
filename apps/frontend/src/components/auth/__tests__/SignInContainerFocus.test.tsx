// @vitest-environment jsdom

import { act, ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';

vi.mock('react-native-svg', () => ({
  default: ({ children }: { children?: ReactNode }) => <svg>{children}</svg>,
  Path: () => <path />,
}));

vi.mock('../../../hooks/useResponsive', () => ({
  useResponsive: () => ({
    width: 390,
    isMobile: true,
    isTablet: false,
    isDesktop: false,
  }),
}));

vi.mock('../../../hooks/useReducedMotion', () => ({
  useReducedMotion: () => true,
}));

import { SignInContainer } from '../SignInContainer';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

function passwordDialog(onClose: () => void) {
  return (
    <SignInContainer open title="Change password" onClose={onClose}>
      <input aria-label="NEW PASSWORD" />
    </SignInContainer>
  );
}

describe('phone password focus', () => {
  it('keeps the field focused across a phone resize and uses the newest close action', () => {
    const mount = document.createElement('div');
    const opener = document.createElement('button');
    opener.textContent = 'Account';
    document.body.append(opener, mount);
    opener.focus();

    const firstClose = vi.fn();
    const newestClose = vi.fn();
    const root = createRoot(mount);

    act(() => root.render(passwordDialog(firstClose)));

    const password = document.querySelector<HTMLInputElement>('input[aria-label="NEW PASSWORD"]');
    expect(password).not.toBeNull();
    act(() => password?.focus());

    // Android changes the available page size when its keyboard opens. The
    // parent redraws with a new close action, but the field must keep focus.
    act(() => root.render(passwordDialog(newestClose)));

    expect(document.activeElement).toBe(password);

    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });

    expect(firstClose).not.toHaveBeenCalled();
    expect(newestClose).toHaveBeenCalledTimes(1);

    act(() => root.unmount());
    expect(document.activeElement).toBe(opener);
    opener.remove();
    mount.remove();
  });

  it('moves focus to the new heading when a full-page auth step changes', () => {
    const mount = document.createElement('div');
    document.body.append(mount);
    const root = createRoot(mount);

    act(() =>
      root.render(
        <SignInContainer variant="page" focusKey="gate" title="Confirm your email">
          <button>Confirm email</button>
        </SignInContainer>,
      ),
    );
    expect(document.activeElement).toBe(document.querySelector('[role="heading"]'));

    act(() =>
      root.render(
        <SignInContainer variant="page" focusKey="password" title="Choose a password">
          <button>Save password</button>
        </SignInContainer>,
      ),
    );
    expect(document.activeElement).toBe(document.querySelector('[role="heading"]'));

    act(() => root.unmount());
    mount.remove();
  });

  it('returns focus to the page opener after the dialog changes steps', () => {
    const mount = document.createElement('div');
    const opener = document.createElement('button');
    opener.textContent = 'Sign in';
    document.body.append(opener, mount);
    opener.focus();
    const root = createRoot(mount);

    act(() =>
      root.render(
        <SignInContainer
          open
          accountPanel
          focusKey="create"
          title="Create your account"
          onClose={vi.fn()}
        >
          <button>Continue</button>
        </SignInContainer>,
      ),
    );
    expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(1);
    expect(document.querySelector('[role="dialog"]')?.getAttribute('aria-labelledby')).toBe(
      document.querySelector('[role="heading"]')?.id,
    );
    expect(document.activeElement).toBe(document.querySelector('[role="dialog"] [role="heading"]'));
    act(() =>
      root.render(
        <SignInContainer
          open
          accountPanel
          focusKey="code"
          title="Enter your code"
          onClose={vi.fn()}
        >
          <button>Continue</button>
        </SignInContainer>,
      ),
    );
    expect(document.activeElement).toBe(document.querySelector('[role="dialog"] [role="heading"]'));
    act(() => root.unmount());

    expect(document.activeElement).toBe(opener);
    opener.remove();
    mount.remove();
  });

  it('keeps focus on the busy action while the same full-page step is checking', () => {
    const mount = document.createElement('div');
    document.body.append(mount);
    const root = createRoot(mount);

    act(() =>
      root.render(
        <SignInContainer variant="page" focusKey="gate" title="Confirm your email">
          <button>Confirm email</button>
        </SignInContainer>,
      ),
    );
    const button = mount.querySelector('button');
    act(() => button?.focus());

    act(() =>
      root.render(
        <SignInContainer variant="page" focusKey="gate" title="Confirm your email">
          <button>Confirming…</button>
        </SignInContainer>,
      ),
    );

    expect(document.activeElement).toBe(mount.querySelector('button'));

    act(() => root.unmount());
    mount.remove();
  });
});
