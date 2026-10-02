// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { SignInModalProvider } from '../SignInModalProvider';
import { useSignInModal } from '../signInModalContext';

vi.mock('../../components/AppFailureDialog', () => ({
  AppFailureDialog: ({ onClose }: any) => (
    <div role="dialog">
      <button>Reload page</button>
      <button onClick={onClose}>Close</button>
    </div>
  ),
}));
vi.mock('react-native', () => ({
  Modal: ({ children }: any) => <div role="dialog">{children}</div>,
  Platform: { OS: 'web', select: (values: any) => values.web ?? values.default },
  StyleSheet: { create: (styles: any) => styles },
  View: ({ children }: any) => <div>{children}</div>,
  Text: ({ children }: any) => <span>{children}</span>,
  Pressable: ({ children, onPress }: any) => <button onClick={onPress}>{children}</button>,
}));
vi.mock('../../lib/auth/signInWorkPending', () => ({ signInWorkPendingOnLoad: () => false }));
vi.mock('../../lib/auth/loadSignInBundle', () => ({
  loadSignInBundle: () => Promise.reject(new Error('missing bundle')),
}));

function PublicPage() {
  const { openSignIn } = useSignInModal();
  return (
    <>
      <input defaultValue="unsent draft" />
      <button onClick={() => openSignIn({ intent: 'nav' })}>Sign in</button>
    </>
  );
}

it('shows a closable failure dialog and retains the public draft when sign-in cannot download', async () => {
  const quiet = vi.spyOn(console, 'error').mockImplementation(() => {});
  const mount = document.createElement('div');
  document.body.appendChild(mount);
  const root = createRoot(mount);
  await act(async () =>
    root.render(
      <SignInModalProvider>
        <PublicPage />
      </SignInModalProvider>,
    ),
  );
  const press = async (label: string) => {
    const button = Array.from(mount.querySelectorAll('button')).find(
      (el) => el.textContent === label,
    )!;
    expect(button).toBeTruthy();
    await act(async () => button.click());
  };
  await press('Sign in');
  expect(mount.querySelector('[role="dialog"]')?.textContent).toContain('Reload page');
  await press('Close');
  expect(mount.querySelector('[role="dialog"]')).toBeNull();
  expect(mount.querySelector('input')?.value).toBe('unsent draft');
  await press('Sign in');
  expect(mount.querySelector('[role="dialog"]')).not.toBeNull();
  await act(async () => root.unmount());
  mount.remove();
  quiet.mockRestore();
});
