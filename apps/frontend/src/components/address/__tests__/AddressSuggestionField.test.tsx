// @vitest-environment jsdom
import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AddressSuggestionField } from '../AddressSuggestionField';
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
