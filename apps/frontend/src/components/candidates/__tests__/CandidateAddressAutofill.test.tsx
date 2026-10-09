// @vitest-environment jsdom
import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { CandidateAddressForm } from '../CandidateAddressForm';
import type { CandidateLookupResponse, CandidateSearchServices } from '../types';
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
function setup(
  initialAddress = oldAddress,
  suggest: CandidateSearchServices['suggest'] = vi.fn(async () => [choice]),
  outcome: Exclude<CandidateLookupResponse, { kind: 'results' }> | null = null,
) {
  const onSubmit = vi.fn();
  let changeAddress!: (value: string) => void;
  const services: CandidateSearchServices = {
    getElections: async () => [],
    suggest,
    lookup: async () => ({ kind: 'no-match' }),
  };
  function Form() {
    const [address, setAddress] = useState(initialAddress);
    changeAddress = setAddress;
    return (
      <CandidateAddressForm
        services={services}
        address={address}
        onAddress={setAddress}
        onSubmit={onSubmit}
        busy={false}
        outcome={outcome}
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
  else act(() => (host.querySelector('button:not([data-clear-address])') as HTMLElement).click());
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
  act(() => (host.querySelector('button:not([data-clear-address])') as HTMLElement).click());
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

it.each(['1 Ma', '5 1'])(
  'suggests a short partial street address before 6 characters: %s',
  async (address) => {
    vi.useFakeTimers();
    const suggest = vi.fn(async () => [choice]);
    const { input } = setup(address, suggest);
    act(() => input.focus());
    await act(async () => vi.advanceTimersByTimeAsync(181));
    expect(suggest).toHaveBeenCalledWith(address, expect.any(AbortSignal));
    expect(host.querySelector('[role="option"]')?.getAttribute('aria-selected')).toBe('false');
    expect(input.getAttribute('aria-activedescendant')).toBeNull();
    expect(host.querySelector('[role="option"] svg')).not.toBeNull();
  },
);

it.each(['29308', '29308 N', '29308 N C'])(
  'waits for a street name instead of suggesting a house number or direction: %s',
  async (address) => {
    vi.useFakeTimers();
    const suggest = vi.fn(async () => [choice]);
    const { input } = setup(address, suggest);
    act(() => input.focus());
    await act(async () => vi.advanceTimersByTimeAsync(181));
    expect(suggest).not.toHaveBeenCalled();
    expect(input.getAttribute('aria-expanded')).toBe('false');
  },
);

it('shows multiple suggestions, moves the active row with arrows and submits the chosen address', async () => {
  vi.useFakeTimers();
  const other = { id: 'other', label: newAddress, address: newAddress };
  const { input, onSubmit } = setup('100 Ex', async () => [choice, other]);
  act(() => input.focus());
  await act(async () => vi.advanceTimersByTimeAsync(181));
  expect(host.textContent).toContain('Suggested addresses');
  expect(host.textContent).toContain('2 suggested addresses below the address box');
  key(input, 'ArrowDown');
  key(input, 'ArrowDown');
  expect(host.querySelectorAll('[role="option"]')[1].getAttribute('aria-selected')).toBe('true');
  key(input, 'ArrowUp');
  expect(host.querySelectorAll('[role="option"]')[0].getAttribute('aria-selected')).toBe('true');
  key(input, 'ArrowDown');
  key(input, 'Enter');
  expect(onSubmit).toHaveBeenCalledExactlyOnceWith(newAddress, other);
  expect(input.value).toBe(newAddress);
  expect(host.querySelector('[role="listbox"]')).toBeNull();
});

it('keeps the field focused through a suggestion mouse-down and submits the completed address on click', async () => {
  vi.useFakeTimers();
  const { input, onSubmit } = setup('100 Ex');
  act(() => input.focus());
  await act(async () => vi.advanceTimersByTimeAsync(181));
  const option = host.querySelector<HTMLElement>('[role="option"]')!;
  const mouseDown = new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0 });
  act(() => {
    option.dispatchEvent(mouseDown);
    // jsdom does not perform the browser's default mouse-down focus change.
    if (!mouseDown.defaultPrevented) option.focus();
  });
  expect(mouseDown.defaultPrevented).toBe(true);
  expect(document.activeElement).toBe(input);
  expect(option.isConnected).toBe(true);
  act(() => option.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, button: 0 })));
  act(() => option.click());
  expect(onSubmit).toHaveBeenCalledExactlyOnceWith(oldAddress, choice);
});

it.each(['Escape', 'Enter'])(
  'does not reopen suggestions when an older request finishes after %s',
  async (action) => {
    vi.useFakeTimers();
    let resolve!: (value: (typeof choice)[]) => void;
    const pending = new Promise<(typeof choice)[]>((yes) => {
      resolve = yes;
    });
    const { input } = setup(oldAddress, async () => pending);
    act(() => input.focus());
    await act(async () => vi.advanceTimersByTimeAsync(181));
    key(input, action);
    await act(async () => resolve([choice]));
    expect(input.getAttribute('aria-expanded')).toBe('false');
    expect(host.querySelector('[role="listbox"]')).toBeNull();
  },
);

it('cancels a pending suggestion timer after Escape and permits suggestions after a new edit', async () => {
  vi.useFakeTimers();
  const suggest = vi.fn(async () => [choice]);
  const { input, changeAddress } = setup(oldAddress, suggest);
  act(() => input.focus());
  key(input, 'Escape');
  await act(async () => vi.advanceTimersByTimeAsync(181));
  expect(suggest).not.toHaveBeenCalled();
  act(() => changeAddress('200 Ex'));
  await act(async () => vi.advanceTimersByTimeAsync(181));
  expect(suggest).toHaveBeenCalledOnce();
  expect(input.getAttribute('aria-expanded')).toBe('true');
});

it('reveals the active row without giving the suggestions an inner scroller', async () => {
  vi.useFakeTimers();
  const other = { id: 'other', label: newAddress, address: newAddress };
  const { input } = setup('100 Ex', async () => [choice, other]);
  act(() => input.focus());
  await act(async () => vi.advanceTimersByTimeAsync(181));
  const list = host.querySelector<HTMLElement>('[role="listbox"]')!;
  const rows = host.querySelectorAll<HTMLElement>('[role="option"]');
  const scrollIntoView = vi.fn();
  rows.forEach((row) => {
    row.scrollIntoView = scrollIntoView;
  });
  vi.spyOn(list, 'getBoundingClientRect').mockReturnValue({ top: 100 } as DOMRect);
  Object.defineProperty(list, 'clientHeight', { value: 300 });
  vi.spyOn(rows[1], 'getBoundingClientRect').mockReturnValue({ top: 380, bottom: 428 } as DOMRect);
  key(input, 'ArrowDown');
  expect(list.scrollTop).toBe(0);
  expect(document.activeElement).toBe(input);
  expect(scrollIntoView).toHaveBeenCalledWith({ block: 'nearest', inline: 'nearest' });
  vi.spyOn(rows[0], 'getBoundingClientRect').mockReturnValue({ top: 72, bottom: 120 } as DOMRect);
  key(input, 'ArrowUp');
  expect(list.scrollTop).toBe(0);
});

it('ignores a clicked suggestion when browser autofill silently replaced the typed prefix', async () => {
  vi.useFakeTimers();
  const { input, onSubmit } = setup('100 Ex');
  act(() => input.focus());
  await act(async () => vi.advanceTimersByTimeAsync(181));
  const option = host.querySelector<HTMLElement>('[role="option"]')!;
  fill(input, newAddress);
  act(() => option.click());
  expect(onSubmit).toHaveBeenCalledExactlyOnceWith(newAddress);
  expect(input.value).toBe(newAddress);
});

it('preserves the original submitted text when choosing among ambiguous lookup results', () => {
  const enteredAddress = '100 Example Street Apt 4';
  const { input, onSubmit } = setup(enteredAddress, async () => [], {
    kind: 'ambiguous',
    choices: [choice],
  });
  expect(host.textContent).toContain('Choose your address');
  act(() => host.querySelector<HTMLElement>('[role="option"]')!.click());
  expect(onSubmit).toHaveBeenCalledExactlyOnceWith(enteredAddress, choice);
  expect(input.value).toBe(enteredAddress);
});

function pointer(target: HTMLElement, type: string, x = 0, y = 0) {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y });
  Object.defineProperty(event, 'pointerType', { value: 'touch' });
  act(() => target.dispatchEvent(event));
}
it('selects on a completed first tap even when the field blurs with no related target', async () => {
  vi.useFakeTimers();
  const { input, onSubmit } = setup('100 Ex');
  act(() => input.focus());
  await act(async () => vi.advanceTimersByTimeAsync(181));
  const option = host.querySelector<HTMLElement>('[role="option"]')!;
  pointer(option, 'pointerdown');
  act(() => input.blur());
  expect(option.isConnected).toBe(true);
  expect(onSubmit).not.toHaveBeenCalled();
  pointer(option, 'pointerup');
  act(() => option.click());
  expect(onSubmit).toHaveBeenCalledExactlyOnceWith(oldAddress, choice);
});
it.each(['scroll', 'cancel'])('does not select during a touch %s', async (action) => {
  vi.useFakeTimers();
  const { input, onSubmit } = setup('100 Ex');
  act(() => input.focus());
  await act(async () => vi.advanceTimersByTimeAsync(181));
  const option = host.querySelector<HTMLElement>('[role="option"]')!;
  pointer(option, 'pointerdown');
  pointer(option, action === 'scroll' ? 'pointermove' : 'pointercancel', 0, 50);
  pointer(option, 'pointerup', 0, 50);
  act(() => option.click());
  expect(onSubmit).not.toHaveBeenCalled();
});
it('hover does not choose a row for Enter and ArrowUp starts at the last row', async () => {
  vi.useFakeTimers();
  const other = { id: 'other', label: newAddress, address: newAddress };
  const { input, onSubmit } = setup('100 Ex', async () => [choice, other]);
  act(() => input.focus());
  await act(async () => vi.advanceTimersByTimeAsync(181));
  const options = host.querySelectorAll<HTMLElement>('[role="option"]');
  act(() => options[1].dispatchEvent(new MouseEvent('mouseover', { bubbles: true })));
  expect(input.getAttribute('aria-activedescendant')).toBeNull();
  key(input, 'ArrowUp');
  expect(options[1].getAttribute('aria-selected')).toBe('true');
  key(input, 'ArrowDown');
  expect(options[0].getAttribute('aria-selected')).toBe('true');
  key(input, 'Escape');
  key(input, 'ArrowDown');
  expect(host.querySelector('[role="option"]')?.getAttribute('aria-selected')).toBe('true');
  key(input, 'Escape');
  key(input, 'Enter');
  expect(onSubmit).toHaveBeenCalledExactlyOnceWith('100 Ex');
});
it('keeps optional suggestion failures quiet and permits typed submission', async () => {
  vi.useFakeTimers();
  const { input, onSubmit } = setup('100 Ex', async () => {
    throw new Error('unavailable');
  });
  act(() => input.focus());
  await act(async () => vi.advanceTimersByTimeAsync(181));
  expect(host.querySelector('[role="listbox"]')).toBeNull();
  expect(host.textContent).not.toContain('unavailable');
  key(input, 'Enter');
  expect(onSubmit).toHaveBeenCalledExactlyOnceWith('100 Ex');
});
it.each([
  ['an apartment', '100 Example Street Apt 4, Minneapolis, MN 55415', 'Apt 4'],
  ['a ZIP+4', '100 Example Street, Minneapolis, MN 55415-1234', '55415-1234'],
  ['both', '100 Example Street Apt 4, Minneapolis, MN 55415-1234', 'Apt 4'],
])(
  'searches the shown address with %s as typed text, never as a relabelled official choice',
  async (_, typed, detail) => {
    vi.useFakeTimers();
    const { input, onSubmit } = setup(typed);
    act(() => input.focus());
    await act(async () => vi.advanceTimersByTimeAsync(181));
    const option = host.querySelector<HTMLElement>('[role="option"]')!;
    const shown = option.textContent!;
    act(() => option.click());
    expect(shown).toContain(detail);
    expect(shown).not.toBe(choice.address);
    // The official choice's fingerprint belongs to its own text; the server
    // checks this fuller text through its normal matching instead.
    expect(onSubmit).toHaveBeenCalledExactlyOnceWith(shown);
    expect(input.value).toBe(shown);
  },
);
it('releases the blur guard when a scroll ends without a click', async () => {
  vi.useFakeTimers();
  const { input } = setup('100 Ex');
  act(() => input.focus());
  await act(async () => vi.advanceTimersByTimeAsync(181));
  const option = host.querySelector<HTMLElement>('[role="option"]')!;
  pointer(option, 'pointerdown');
  pointer(option, 'pointermove', 0, 50);
  pointer(option, 'pointerup', 0, 50);
  await act(async () => vi.advanceTimersByTimeAsync(1));
  act(() => input.blur());
  expect(host.querySelector('[role="listbox"]')).toBeNull();
});
