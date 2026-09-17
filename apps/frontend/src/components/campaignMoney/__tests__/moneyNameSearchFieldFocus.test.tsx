// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  (globalThis as { __DEV__?: boolean }).__DEV__ = false;
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
vi.mock('react-native-svg', () => ({ default: () => null, Circle: () => null, Path: () => null }));

import { MoneyNameSearchField } from '../MoneyNameSearchField';

let root: Root;
afterEach(() => {
  act(() => root?.unmount());
  document.body.innerHTML = '';
});

function mount(listAppearance = false) {
  const host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  const onSubmit = vi.fn();
  const onChangeText = vi.fn();
  act(() => {
    root.render(
      <MoneyNameSearchField
        value="Smith"
        onChangeText={onChangeText}
        onSubmit={onSubmit}
        placeholder="Search a name"
        appearance={listAppearance ? 'list' : 'default'}
        label={listAppearance ? 'Find a committee by name' : undefined}
        showSubmitButton
      />,
    );
  });
  return { host, onSubmit, onChangeText, input: host.querySelector('input')! };
}

describe('the whole visible name field focuses its input', () => {
  it('focuses the input when the surrounding box is clicked without submitting', () => {
    const { host, input, onSubmit } = mount();
    const box = input.parentElement!;
    expect(document.activeElement).not.toBe(input);
    act(() => box.click());
    expect(document.activeElement).toBe(input);
    expect(onSubmit).not.toHaveBeenCalled();
    // The clickable surround must not become a second button or keyboard stop.
    expect(box.tabIndex).toBe(-1);
    expect(box.getAttribute('role')).not.toBe('button');
    expect(host.querySelectorAll('button,[role="button"]')).toHaveLength(1);
  });

  it('keeps Enter and the Search button as submission paths', () => {
    const { host, input, onSubmit } = mount();
    act(() => {
      input.focus();
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    });
    expect(onSubmit).toHaveBeenCalledTimes(1);
    act(() => (host.querySelector('button,[role="button"]') as HTMLElement).click());
    expect(onSubmit).toHaveBeenCalledTimes(2);
  });
});

describe('the list search field', () => {
  it('keeps its label associated after typing and clearing without submitting', () => {
    const { host, input, onSubmit, onChangeText } = mount(true);
    const labelId = input.getAttribute('aria-labelledby');
    expect(labelId).toBeTruthy();
    expect(document.getElementById(labelId!)?.textContent).toBe('Find a committee by name');
    const clear = host.querySelector('[aria-label="Clear the field"]') as HTMLElement;
    expect(clear).not.toBeNull();
    act(() => clear.click());
    expect(onChangeText).toHaveBeenCalledWith('');
    expect(onSubmit).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(input);
  });
});
