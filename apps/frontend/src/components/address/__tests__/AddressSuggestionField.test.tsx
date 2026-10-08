// @vitest-environment jsdom
import { act, useRef, useState } from 'react';
import { Pressable, Text } from 'react-native';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AddressSuggestionField, type AddressFieldHandle } from '../AddressSuggestionField';
vi.hoisted(() => {
  (globalThis as { __DEV__?: boolean }).__DEV__ = false;
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.useFakeTimers();
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
const suggest = async () =>
  Array.from({ length: 6 }, (_, index) => ({
    id: `${index}`,
    address: `${100 + index} Main St, Minneapolis, MN 55415`,
    value: index,
  }));
function Form() {
  const [address, setAddress] = useState('100 Ma');
  return (
    <>
      <label id="label">Full street address</label>
      <AddressSuggestionField
        address={address}
        onAddress={setAddress}
        suggest={suggest}
        onSubmit={() => {}}
        labelId="label"
        busy={false}
        mobile
      />
    </>
  );
}
it('reveals only needed phone space after viewport resize and respects manual scrolling', async () => {
  const viewport = Object.assign(new EventTarget(), { height: 400, offsetTop: 0 });
  vi.stubGlobal('visualViewport', viewport);
  const scroll = vi.spyOn(window, 'scrollBy').mockImplementation(() => {});
  act(() => root.render(<Form />));
  const field = host.querySelector('textarea')!;
  vi.spyOn(host.querySelector('label')!, 'getBoundingClientRect').mockReturnValue({
    top: 100,
  } as DOMRect);
  act(() => field.focus());
  await act(async () => vi.advanceTimersByTimeAsync(181));
  expect(host.querySelectorAll('[role="option"]')).toHaveLength(5);
  const panel = host.querySelector('[role="listbox"]')!.parentElement!;
  expect(panel.style.position).toBe('relative');
  vi.spyOn(panel, 'getBoundingClientRect').mockReturnValue({ bottom: 380 } as DOMRect);
  await act(async () => vi.advanceTimersByTimeAsync(20));
  expect(scroll).not.toHaveBeenCalled();
  viewport.height = 250;
  act(() => viewport.dispatchEvent(new Event('resize')));
  await act(async () => vi.advanceTimersByTimeAsync(20));
  expect(scroll).toHaveBeenCalledWith({ top: 88, behavior: 'instant' });
  scroll.mockClear();
  act(() => document.dispatchEvent(new WheelEvent('wheel', { deltaY: 50 })));
  act(() => viewport.dispatchEvent(new Event('resize')));
  await act(async () => vi.advanceTimersByTimeAsync(20));
  expect(scroll).not.toHaveBeenCalled();
  const revealRow = vi.fn();
  host.querySelector<HTMLElement>('[role="option"]')!.scrollIntoView = revealRow;
  act(() => field.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })));
  expect(revealRow).toHaveBeenCalledWith({ block: 'nearest', inline: 'nearest' });
});

function ExternalSubmitForm({
  address,
  busy,
  onAddress,
  suggestMatches,
}: {
  address: string;
  busy: boolean;
  onAddress(value: string): void;
  suggestMatches: typeof suggest;
}) {
  const fieldRef = useRef<AddressFieldHandle>(null);
  return (
    <>
      <label id="external-label">Full street address</label>
      <AddressSuggestionField
        address={address}
        onAddress={onAddress}
        suggest={suggestMatches}
        onSubmit={() => {}}
        fieldRef={fieldRef}
        labelId="external-label"
        busy={busy}
        mobile={false}
      />
      <Pressable accessibilityRole="button" onPress={() => fieldRef.current?.dismiss()}>
        <Text>Find</Text>
      </Pressable>
    </>
  );
}

it.each([
  ['unchanged', '100 Main St, Minneapolis, MN 55415, USA', 'edit'],
  ['canonicalized', '100 MAIN ST, MINNEAPOLIS, MN 55415', 'focus'],
] as const)(
  'keeps suggestions dismissed after external Find finishes with %s address text until deliberate interaction',
  async (_, resultAddress, resume) => {
    const suggestMatches = vi.fn(suggest);
    const onAddress = vi.fn();
    const initialAddress = '100 Main St, Minneapolis, MN 55415, USA';
    const render = (address: string, busy: boolean) =>
      root.render(
        <ExternalSubmitForm
          address={address}
          busy={busy}
          onAddress={onAddress}
          suggestMatches={suggestMatches}
        />,
      );
    act(() => render(initialAddress, false));
    const field = host.querySelector('textarea')!;
    act(() => field.focus());
    await act(async () => vi.advanceTimersByTimeAsync(181));
    expect(host.querySelector('[role="listbox"]')).not.toBeNull();
    expect(suggestMatches).toHaveBeenCalledOnce();
    // Pressable consumes the click, so document outside-click handling cannot
    // disable suggestions on behalf of the form's explicit dismissal.
    act(() => host.querySelector<HTMLElement>('[role="button"]')!.click());
    expect(host.querySelector('[role="listbox"]')).toBeNull();
    act(() => render(initialAddress, true));
    act(() => render(resultAddress, false));
    await act(async () => vi.advanceTimersByTimeAsync(181));
    expect(suggestMatches).toHaveBeenCalledOnce();
    expect(host.querySelector('[role="listbox"]')).toBeNull();
    expect(field.value).toBe(resultAddress);
    if (resume === 'edit') {
      const edited = '100 Main Street, Minneapolis, MN 55415';
      act(() => {
        Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(
          field,
          edited,
        );
        field.dispatchEvent(new Event('input', { bubbles: true }));
      });
      expect(onAddress).toHaveBeenCalledWith(edited);
      act(() => render(edited, false));
    } else {
      act(() => field.blur());
      act(() => field.focus());
    }
    await act(async () => vi.advanceTimersByTimeAsync(181));
    expect(suggestMatches).toHaveBeenCalledTimes(2);
    expect(host.querySelector('[role="listbox"]')).not.toBeNull();
  },
);
