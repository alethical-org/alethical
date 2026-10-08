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
  suggestMatches: (value: string, signal: AbortSignal) => ReturnType<typeof suggest>;
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

it('starts immediately when idle and waits for the latest edit during a typing burst', async () => {
  const suggestMatches = vi.fn(suggest);
  const render = (address: string) =>
    root.render(
      <ExternalSubmitForm
        address={address}
        busy={false}
        onAddress={() => {}}
        suggestMatches={suggestMatches}
      />,
    );
  act(() => render('100 Ma'));
  act(() => host.querySelector('textarea')!.focus());
  await act(async () => vi.advanceTimersByTimeAsync(0));
  expect(suggestMatches).toHaveBeenCalledOnce();
  act(() => render('100 Mai'));
  await act(async () => vi.advanceTimersByTimeAsync(40));
  act(() => render('100 Main'));
  await act(async () => vi.advanceTimersByTimeAsync(179));
  expect(suggestMatches).toHaveBeenCalledOnce();
  await act(async () => vi.advanceTimersByTimeAsync(1));
  expect(suggestMatches).toHaveBeenLastCalledWith('100 Main', expect.any(AbortSignal));
  expect(suggestMatches).toHaveBeenCalledTimes(2);
  await act(async () => vi.advanceTimersByTimeAsync(180));
  act(() => render('100 Main St'));
  await act(async () => vi.advanceTimersByTimeAsync(0));
  expect(suggestMatches).toHaveBeenLastCalledWith('100 Main St', expect.any(AbortSignal));
  expect(suggestMatches).toHaveBeenCalledTimes(3);
});

it('reuses only exact recent input and forgets it after clearing or expiry', async () => {
  const suggestMatches = vi.fn(suggest);
  const render = (address: string) =>
    root.render(
      <ExternalSubmitForm
        address={address}
        busy={false}
        onAddress={() => {}}
        suggestMatches={suggestMatches}
      />,
    );
  act(() => render('100 Ma'));
  act(() => host.querySelector('textarea')!.focus());
  await act(async () => vi.advanceTimersByTimeAsync(181));
  act(() => render('100 Main'));
  await act(async () => vi.advanceTimersByTimeAsync(181));
  act(() => render('100 Ma'));
  expect(host.querySelector('[role="listbox"]')).not.toBeNull();
  expect(suggestMatches).toHaveBeenCalledTimes(2);
  act(() => render(''));
  act(() => render('100 Ma'));
  await act(async () => vi.advanceTimersByTimeAsync(181));
  expect(suggestMatches).toHaveBeenCalledTimes(3);
  await act(async () => vi.advanceTimersByTimeAsync(60_001));
  act(() => render('100 Main'));
  await act(async () => vi.advanceTimersByTimeAsync(181));
  act(() => render('100 Ma'));
  await act(async () => vi.advanceTimersByTimeAsync(181));
  expect(suggestMatches).toHaveBeenCalledTimes(5);
});

it('groups 140ms typing and replacement bursts instead of spending a request on each letter', async () => {
  const suggestMatches = vi.fn(suggest);
  function TypingForm() {
    const [address, setAddress] = useState('');
    return (
      <ExternalSubmitForm
        address={address}
        busy={false}
        onAddress={setAddress}
        suggestMatches={suggestMatches}
      />
    );
  }
  act(() => root.render(<TypingForm />));
  const field = host.querySelector('textarea')!;
  act(() => field.focus());
  const change = (value: string) =>
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(
        field,
        value,
      );
      field.dispatchEvent(new Event('input', { bubbles: true }));
    });
  for (const address of [
    '350 S 5th St, Minneapolis, MN 55415',
    '75 Rev Dr Martin Luther King Jr Blvd, Saint Paul, MN 55155',
  ]) {
    change('');
    await act(async () => vi.advanceTimersByTimeAsync(200));
    const before = suggestMatches.mock.calls.length;
    for (let length = 1; length <= address.length; length += 1) {
      change(address.slice(0, length));
      await act(async () => vi.advanceTimersByTimeAsync(140));
    }
    // A leading request is allowed; continuing keystrokes must be grouped.
    expect(suggestMatches.mock.calls.length - before).toBeLessThanOrEqual(1);
    await act(async () => vi.advanceTimersByTimeAsync(40));
    expect(suggestMatches.mock.calls.length - before).toBeLessThanOrEqual(2);
    expect(suggestMatches).toHaveBeenLastCalledWith(address, expect.any(AbortSignal));
  }
  expect(suggestMatches.mock.calls.length).toBeLessThanOrEqual(4);
});

it.each(['clear', 'busy', 'source change'] as const)(
  'ignores a pending reply after %s and fetches fresh suggestions',
  async (boundary) => {
    let resolveOld!: (options: Awaited<ReturnType<typeof suggest>>) => void;
    const pending = new Promise<Awaited<ReturnType<typeof suggest>>>((resolve) => {
      resolveOld = resolve;
    });
    const oldMatches = [{ id: 'old', address: '100 Old St, Minneapolis, MN 55415', value: 1 }];
    const freshMatches = [{ id: 'fresh', address: '100 Main St, Minneapolis, MN 55415', value: 2 }];
    const original = vi.fn((_value: string, _signal: AbortSignal) => pending);
    const replacement = vi.fn(async (_value: string, _signal: AbortSignal) => freshMatches);
    const render = (address: string, busy: boolean, source = original) =>
      root.render(
        <ExternalSubmitForm
          address={address}
          busy={busy}
          onAddress={() => {}}
          suggestMatches={source}
        />,
      );
    act(() => render('100 Ma', false));
    act(() => host.querySelector('textarea')!.focus());
    await act(async () => vi.advanceTimersByTimeAsync(0));
    expect(original).toHaveBeenCalledOnce();
    const signal = original.mock.calls[0][1];
    if (boundary === 'clear') act(() => render('', false));
    else if (boundary === 'busy') act(() => render('100 Ma', true));
    else act(() => render('100 Ma', false, replacement));
    expect(signal.aborted).toBe(true);
    await act(async () => {
      resolveOld(oldMatches);
      await pending;
    });
    expect(host.textContent).not.toContain('100 Old St');
    original.mockImplementation(async () => freshMatches);
    if (boundary !== 'source change') act(() => render('100 Ma', false));
    await act(async () => vi.advanceTimersByTimeAsync(181));
    expect(host.textContent).toContain('100 Main St');
    expect(host.textContent).not.toContain('100 Old St');
    expect(boundary === 'source change' ? replacement : original).toHaveBeenCalledTimes(
      boundary === 'source change' ? 1 : 2,
    );
  },
);

it('keeps at most 8 positive replies and fetches an evicted input again', async () => {
  const suggestMatches = vi.fn(suggest);
  const render = (address: string) =>
    root.render(
      <ExternalSubmitForm
        address={address}
        busy={false}
        onAddress={() => {}}
        suggestMatches={suggestMatches}
      />,
    );
  act(() => render('100 Main 0'));
  act(() => host.querySelector('textarea')!.focus());
  await act(async () => vi.advanceTimersByTimeAsync(181));
  for (let index = 1; index < 9; index += 1) {
    act(() => render(`100 Main ${index}`));
    await act(async () => vi.advanceTimersByTimeAsync(181));
  }
  expect(suggestMatches).toHaveBeenCalledTimes(9);
  act(() => render('100 Main 1'));
  expect(host.querySelector('[role="listbox"]')).not.toBeNull();
  expect(suggestMatches).toHaveBeenCalledTimes(9);
  act(() => render('100 Main 0'));
  await act(async () => vi.advanceTimersByTimeAsync(181));
  expect(suggestMatches).toHaveBeenCalledTimes(10);
  expect(suggestMatches).toHaveBeenLastCalledWith('100 Main 0', expect.any(AbortSignal));
});
