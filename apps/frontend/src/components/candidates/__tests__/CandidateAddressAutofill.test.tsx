// @vitest-environment jsdom
import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { CandidateAddressForm } from '../CandidateAddressForm';
import type { CandidateSearchServices } from '../types';
vi.hoisted(() => {
  (globalThis as { __DEV__?: boolean }).__DEV__ = false;
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
vi.mock('react-native-svg', () => ({
  default: ({ children }: React.PropsWithChildren) => <svg>{children}</svg>,
  Path: () => <path />,
  Circle: () => <circle />,
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
});
const oldAddress = '100 Example Street, Minneapolis, MN 55415';
const newAddress = '200 Example Street, Minneapolis, MN 55415, United States';
const choice = { id: 'old', label: oldAddress, address: oldAddress };
function setup() {
  const onSubmit = vi.fn();
  let changeAddress!: (value: string) => void;
  const services: CandidateSearchServices = {
    getElections: async () => [],
    suggest: vi.fn(async () => [choice]),
    lookup: async () => ({ kind: 'no-match' }),
  };
  function Form() {
    const [address, setAddress] = useState(oldAddress);
    changeAddress = setAddress;
    return (
      <CandidateAddressForm
        services={services}
        address={address}
        onAddress={setAddress}
        onSubmit={onSubmit}
        busy={false}
        outcome={null}
      />
    );
  }
  act(() => root.render(<Form />));
  return { onSubmit, input: host.querySelector('textarea')!, changeAddress };
}
function fill(input: HTMLTextAreaElement, value: string) {
  Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(input, value);
}
function key(input: HTMLTextAreaElement, key: string) {
  act(() =>
    input.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })),
  );
}
it.each(['button', 'keyboard'])('uses current browser-filled address via %s', (method) => {
  const { input, onSubmit } = setup();
  fill(input, newAddress);
  if (method === 'keyboard') key(input, 'Enter');
  else act(() => (host.querySelector('button') as HTMLElement).click());
  expect(onSubmit).toHaveBeenCalledExactlyOnceWith(newAddress);
  expect(input.value).toBe(newAddress);
});
it('does not submit an old highlighted suggestion after browser fill changes the address', async () => {
  vi.useFakeTimers();
  const { input, onSubmit } = setup();
  act(() => input.focus());
  await act(async () => {
    await vi.advanceTimersByTimeAsync(181);
  });
  key(input, 'ArrowDown');
  fill(input, newAddress);
  key(input, 'Enter');
  expect(onSubmit).toHaveBeenCalledExactlyOnceWith(newAddress);
});
it('submits a deliberately selected current suggestion with its confirmation', async () => {
  vi.useFakeTimers();
  const { input, onSubmit } = setup();
  act(() => input.focus());
  await act(async () => {
    await vi.advanceTimersByTimeAsync(181);
  });
  key(input, 'ArrowDown');
  key(input, 'Enter');
  expect(onSubmit).toHaveBeenCalledExactlyOnceWith(oldAddress, choice);
});

it('keeps browser-filled text when tapping the search button blurs the field first', () => {
  const { input, onSubmit } = setup();
  act(() => input.focus());
  fill(input, newAddress);
  act(() => input.blur());
  act(() => (host.querySelector('button') as HTMLElement).click());
  expect(onSubmit).toHaveBeenCalledExactlyOnceWith(newAddress);
  expect(input.value).toBe(newAddress);
});

it('does not submit an old address when the browser cleared the visible field', () => {
  const { input, onSubmit } = setup();
  fill(input, '');
  key(input, 'Enter');
  expect(onSubmit).not.toHaveBeenCalled();
  expect(input.value).toBe('');
  expect(host.textContent).toContain('Enter your full Minnesota street address');
});
it('retains a browser-filled address when the field is focused again', () => {
  const { input, onSubmit } = setup();
  fill(input, newAddress);
  act(() => input.focus());
  key(input, 'Enter');
  expect(onSubmit).toHaveBeenCalledExactlyOnceWith(newAddress);
});

it('keeps browser-filled text when older suggestions finish loading', async () => {
  vi.useFakeTimers();
  const { input, onSubmit } = setup();
  act(() => input.focus());
  fill(input, newAddress);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(181);
  });
  expect(input.value).toBe(newAddress);
  key(input, 'Enter');
  expect(onSubmit).toHaveBeenCalledExactlyOnceWith(newAddress);
});

it('still reflects an explicit address change and clear from the search flow', () => {
  const { input, changeAddress } = setup();
  act(() => changeAddress(newAddress));
  expect(input.value).toBe(newAddress);
  act(() => changeAddress(''));
  expect(input.value).toBe('');
});
