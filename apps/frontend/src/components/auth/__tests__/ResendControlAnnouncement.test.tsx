// @vitest-environment jsdom

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../LoadingButton', () => ({
  LoadingButton: ({ label, disabled }: { label: string; disabled?: boolean }) => (
    <button disabled={disabled}>{label}</button>
  ),
}));

import { ResendControl, type ResendStatus } from '../ResendControl';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

afterEach(() => {
  document.body.replaceChildren();
});

describe('email retry announcement', () => {
  it('marks a ready retry unavailable while another request is running', () => {
    const mount = document.createElement('div');
    document.body.append(mount);
    const root = createRoot(mount);

    act(() =>
      root.render(
        <ResendControl
          status="ready"
          sentMessage="Enter the newest code"
          actionLabel="Send a new code"
          disabled
          onResend={vi.fn()}
        />,
      ),
    );

    expect(mount.querySelector('button')?.disabled).toBe(true);
    act(() => root.unmount());
  });

  for (const previous of ['waiting', 'rate-limited'] as ResendStatus[]) {
    it(`announces readiness after ${previous}`, () => {
      const mount = document.createElement('div');
      document.body.append(mount);
      const root = createRoot(mount);
      const render = (status: ResendStatus) => (
        <ResendControl
          status={status}
          sentMessage="Enter the newest code"
          secondsRemaining={1}
          actionLabel="Send a new code"
          onResend={vi.fn()}
        />
      );

      act(() => root.render(render(previous)));
      act(() => root.render(render('ready')));

      expect(mount.textContent).toContain('You can try again now');
      act(() => root.unmount());
    });
  }
});
