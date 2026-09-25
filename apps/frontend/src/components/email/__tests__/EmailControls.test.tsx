// @vitest-environment jsdom

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';

vi.hoisted(() => {
  (globalThis as { __DEV__?: boolean }).__DEV__ = false;
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

import { EmailButton, EmailCheckbox } from '../EmailControls';

it('announces busy and locked controls without removing keyboard focus', () => {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  const press = vi.fn();
  const change = vi.fn();
  const render = (busy: boolean) =>
    act(() =>
      root.render(
        <>
          <EmailButton label={busy ? 'Saving…' : 'Save'} busy={busy} onPress={press} />
          <EmailCheckbox label="Research" value={false} locked={busy} onChange={change} />
        </>,
      ),
    );
  try {
    render(false);
    const button = host.querySelector<HTMLElement>('[role="button"]')!;
    const checkbox = host.querySelector<HTMLElement>('[role="checkbox"]')!;
    act(() => button.focus());
    render(true);
    expect(document.activeElement).toBe(button);
    expect(button.getAttribute('aria-busy')).toBe('true');
    expect(button.getAttribute('aria-disabled')).toBe('true');
    expect(checkbox.getAttribute('aria-disabled')).toBe('true');
    act(() => {
      button.click();
      checkbox.click();
    });
    expect(press).not.toHaveBeenCalled();
    expect(change).not.toHaveBeenCalled();
    render(false);
    expect(button.getAttribute('aria-disabled')).not.toBe('true');
    expect(checkbox.getAttribute('aria-disabled')).not.toBe('true');
    act(() => button.click());
    expect(press).toHaveBeenCalledOnce();
  } finally {
    act(() => root.unmount());
    host.remove();
  }
});

it('leaves input-aware keyboard focus to the app instead of adding an outline on every focus', () => {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  try {
    act(() =>
      root.render(
        <>
          <EmailCheckbox label="Research" value={false} onChange={() => {}} />
          <EmailButton label="Save" onPress={() => {}} />
        </>,
      ),
    );
    for (const control of host.querySelectorAll<HTMLElement>('[tabindex="0"]')) {
      act(() => control.focus());
      expect(document.activeElement).toBe(control);
      expect(getComputedStyle(control).outlineWidth).not.toBe('2px');
    }
  } finally {
    act(() => root.unmount());
    host.remove();
  }
});
