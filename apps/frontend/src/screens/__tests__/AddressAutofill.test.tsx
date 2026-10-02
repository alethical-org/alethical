// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  HomeLegislatorFinder,
  HomeLegislatorFinderForm,
} from '../../components/home/HomeLegislatorFinder';
import { FindMyLegislatorScreen } from '../FindMyLegislatorScreen';
vi.hoisted(() => {
  (globalThis as { __DEV__?: boolean }).__DEV__ = false;
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
const lookup = vi.hoisted(() => ({
  mutate: vi.fn(),
  reset: vi.fn(),
  isPending: false,
  data: undefined as unknown,
  error: null,
}));
vi.mock('../../hooks/useAppQueries', () => ({
  useRepresentativeLookup: () => lookup,
  useAddressSuggestions: () => ({ data: [], isSuccess: false }),
}));
vi.mock('../../hooks/useHistoryScrollRestoration', () => ({
  useHistoryScrollRestoration: () => ({}),
}));
vi.mock('../../components/MapPinPicker', () => ({
  MINNESOTA_MAP_VIEWPORT: {},
  MapPinPicker: () => null,
}));
vi.mock('../../components/find/RepresentativeCard', () => ({
  RepresentativeCard: () => null,
  VacantSeatCard: () => null,
}));
vi.mock('../../theme/primitives', () => ({
  PageBackground: ({ children }: React.PropsWithChildren) => <div>{children}</div>,
  Container: ({ children }: React.PropsWithChildren) => <div>{children}</div>,
  TopNav: () => null,
  Footer: () => null,
}));
vi.mock('react-native-svg', () => ({
  default: ({ children }: React.PropsWithChildren) => <svg>{children}</svg>,
  Circle: () => <circle />,
  Path: () => <path />,
  Polygon: () => <polygon />,
}));
let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  vi.clearAllMocks();
  lookup.data = undefined;
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});
const address = '100 Example Street, Minneapolis, MN 55415, United States';
function fillAndSubmit(method: string) {
  const input = host.querySelector('input')!;
  if (method === 'blur-button') act(() => input.focus());
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, address);
  if (method === 'blur-button') act(() => input.blur());
  act(() => {
    if (method === 'keyboard')
      input.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
      );
    else
      [...host.querySelectorAll<HTMLElement>('[role="button"]')]
        .find((button) => /^(Find|Find my legislator)$/.test(button.textContent ?? ''))!
        .click();
  });
  return input;
}
it.each(['button', 'keyboard', 'blur-button'])(
  'homepage legislator lookup uses browser-filled text via %s',
  (method) => {
    const navigate = vi.fn();
    act(() => root.render(<HomeLegislatorFinder layout="phone" onNavigate={navigate} />));
    const input = fillAndSubmit(method);
    expect(navigate).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ address, lookupAddress: true }),
    );
    expect(input.value).toBe(address);
  },
);
it.each(['button', 'keyboard', 'blur-button'])(
  'legislator lookup uses browser-filled text via %s',
  (method) => {
    const navigation = { setParams: vi.fn(), navigate: vi.fn() };
    act(() =>
      root.render(
        <FindMyLegislatorScreen navigation={navigation as never} route={{ params: {} } as never} />,
      ),
    );
    const input = fillAndSubmit(method);
    expect(lookup.mutate).toHaveBeenCalledExactlyOnceWith(address);
    expect(navigation.setParams).toHaveBeenCalledWith(expect.objectContaining({ address }));
    expect(input.value).toBe(address);
  },
);

it('does not confirm old legislator choices after an unreported browser fill', () => {
  lookup.data = {
    status: 'address-choice',
    choices: [{ matchedAddress: '100 Old Street, MN 55415', latitude: 44.98, longitude: -93.27 }],
  };
  const navigation = { setParams: vi.fn(), navigate: vi.fn() };
  act(() =>
    root.render(
      <FindMyLegislatorScreen navigation={navigation as never} route={{ params: {} } as never} />,
    ),
  );
  fillAndSubmit('keyboard');
  expect(lookup.mutate).toHaveBeenCalledExactlyOnceWith(address);
});

it.each(['homepage', 'search'])(
  'retains silent browser fill through an unrelated %s render',
  (surface) => {
    const navigate = vi.fn();
    const navigation = { setParams: vi.fn(), navigate: vi.fn() };
    const render = () =>
      surface === 'homepage' ? (
        <HomeLegislatorFinder layout="phone" onNavigate={navigate} />
      ) : (
        <FindMyLegislatorScreen navigation={navigation as never} route={{ params: {} } as never} />
      );
    act(() => root.render(render()));
    const input = host.querySelector('input')!;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, address);
    act(() => root.render(render()));
    expect(input.value).toBe(address);
    act(() =>
      input.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
      ),
    );
    if (surface === 'homepage')
      expect(navigate).toHaveBeenCalledWith(expect.objectContaining({ address }));
    else expect(lookup.mutate).toHaveBeenCalledExactlyOnceWith(address);
  },
);

it('still applies deliberate legislator address replacements and clears', () => {
  const render = (value: string) =>
    root.render(
      <HomeLegislatorFinderForm
        value={value}
        focused={false}
        findingLocation={false}
        layout="phone"
        reduceMotion
        onValueChange={() => {}}
        onFocus={() => {}}
        onBlur={() => {}}
        onFind={() => {}}
        onUseLocation={() => {}}
      />,
    );
  act(() => render(''));
  const input = host.querySelector('input')!;
  act(() => render(address));
  expect(input.value).toBe(address);
  act(() => render(''));
  expect(input.value).toBe('');
});
