// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider, useMutation } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ApiError } from '../../data/api';
import { FindMyLegislatorScreen } from '../FindMyLegislatorScreen';
import type { RepresentativeLookupResult } from '../../data/types';
vi.hoisted(() => {
  (globalThis as { __DEV__?: boolean }).__DEV__ = false;
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
const lookupRequest = vi.hoisted(() => vi.fn());
vi.mock('../../hooks/useAppQueries', () => ({
  useRepresentativeLookup: () => useMutation({ mutationFn: lookupRequest }),
}));
const suggestions = vi.hoisted(() => vi.fn());
const preparedLookup = vi.hoisted(() => vi.fn());
vi.mock('../../data/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../data/api')>()),
  suggestRepresentativeAddressesFromApi: suggestions,
  lookupRepresentativeFromApi: preparedLookup,
}));
vi.mock('../../hooks/useHistoryScrollRestoration', () => ({
  useHistoryScrollRestoration: () => ({}),
}));
vi.mock('../../components/MapPinPicker', () => ({
  MINNESOTA_MAP_VIEWPORT: {},
  MapPinPicker: ({
    onCoordinateChange,
  }: {
    onCoordinateChange(coordinate: { latitude: number; longitude: number }): void;
  }) => (
    <div data-test-map>
      <button
        type="button"
        onClick={() => onCoordinateChange({ latitude: 44.95, longitude: -93.1 })}
      >
        Move map pin
      </button>
    </div>
  ),
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
let client: QueryClient;
const navigation = { setParams: vi.fn(), navigate: vi.fn() };
const firstAddress = '100 First St, Minneapolis, MN 55415';
const secondAddress = '200 Second St, Minneapolis, MN 55415';
const found = (address: string) =>
  ({
    status: 'found',
    address,
    houseDistrict: '1A',
    senateDistrict: '1',
  }) as RepresentativeLookupResult;
beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  lookupRequest.mockReset();
  suggestions.mockReset().mockResolvedValue([]);
  preparedLookup.mockReset().mockResolvedValue(null);
  client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  act(() =>
    root.render(
      <QueryClientProvider client={client}>
        <FindMyLegislatorScreen navigation={navigation as never} route={{ params: {} } as never} />
      </QueryClientProvider>,
    ),
  );
});
afterEach(() => {
  act(() => root.unmount());
  client.clear();
  host.remove();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
const field = () => host.querySelector('textarea')!;
function type(value: string) {
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(
      field(),
      value,
    );
    field().dispatchEvent(new Event('input', { bubbles: true }));
  });
}
async function submit() {
  act(() => field().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));
  await settle();
}
async function settle() {
  await act(async () => vi.advanceTimersByTimeAsync(5));
}
function clear() {
  act(() => host.querySelector<HTMLButtonElement>('[aria-label="Clear address"]')!.click());
}
it('keeps the successful result and address after clearing, focuses the field and accepts a replacement', async () => {
  lookupRequest.mockResolvedValue(found(firstAddress));
  type(firstAddress);
  await submit();
  expect(host.textContent).toContain(firstAddress);
  expect(host.textContent).toContain('Your Minnesota legislators');
  clear();
  expect(field().value).toBe('');
  expect(document.activeElement).toBe(field());
  expect(host.textContent).toContain(firstAddress);
  expect(host.textContent).toContain('Your Minnesota legislators');
  expect(lookupRequest).toHaveBeenCalledOnce();
  lookupRequest.mockResolvedValue(found(secondAddress));
  type(secondAddress);
  await submit();
  expect(field().value).toBe(secondAddress);
  expect(host.textContent).toContain(secondAddress);
  expect(host.textContent).not.toContain(firstAddress);
});
it.each([
  [new ApiError(404, 'not found'), 'No match for that address', false],
  [new ApiError(503, 'unavailable'), 'Lookup unavailable right now', true],
  [new ApiError(429, 'wait', null, 30), 'Too many lookups', true],
] as const)(
  'clears only input errors and preserves service errors (%s)',
  async (error, copy, stays) => {
    lookupRequest.mockRejectedValue(error);
    type(firstAddress);
    await submit();
    expect(host.textContent).toContain(copy);
    const button = host.querySelector<HTMLButtonElement>('[aria-label="Clear address"]')!;
    expect(button.style.visibility).toBe('visible');
    clear();
    expect(field().value).toBe('');
    expect(host.textContent?.includes(copy)).toBe(stays);
    expect(field().getAttribute('aria-invalid')).toBeNull();
    expect(field().style.borderColor).not.toBe('rgb(163, 66, 26)');
  },
);
it('detaches a pending lookup when the address is manually emptied so its late result cannot refill it', async () => {
  let resolve!: (result: RepresentativeLookupResult) => void;
  lookupRequest.mockImplementation(
    () =>
      new Promise<RepresentativeLookupResult>((done) => {
        resolve = done;
      }),
  );
  type(firstAddress);
  await submit();
  expect(
    host.querySelector<HTMLButtonElement>('[aria-label="Clear address"]')!.style.visibility,
  ).toBe('hidden');
  type('');
  await act(async () => resolve(found(firstAddress)));
  await settle();
  expect(field().value).toBe('');
  expect(host.textContent).not.toContain(firstAddress);
  expect(host.textContent).not.toContain('Your Minnesota legislators');
});
it('ignores a location reply after clearing an address entered during the location wait', async () => {
  let complete!: PositionCallback;
  vi.stubGlobal('navigator', {
    userAgent: navigator.userAgent,
    geolocation: {
      getCurrentPosition: (success: PositionCallback) => {
        complete = success;
      },
    },
  });
  act(() =>
    root.render(
      <QueryClientProvider client={client}>
        <FindMyLegislatorScreen navigation={navigation as never} route={{ params: {} } as never} />
      </QueryClientProvider>,
    ),
  );
  act(() => host.querySelector<HTMLElement>('[aria-label="Use my location"]')!.click());
  expect(host.textContent).toContain('Finding your location…');
  type(firstAddress);
  clear();
  expect(field().value).toBe('');
  expect(host.textContent).not.toContain('Finding your location…');
  act(() => complete({ coords: { latitude: 44.98, longitude: -93.27 } } as GeolocationPosition));
  await settle();
  expect(lookupRequest).not.toHaveBeenCalled();
  expect(field().value).toBe('');
});
it('does not let an older location reply replace a newer map lookup', async () => {
  let complete!: PositionCallback;
  vi.stubGlobal('navigator', {
    userAgent: navigator.userAgent,
    geolocation: {
      getCurrentPosition: (success: PositionCallback) => {
        complete = success;
      },
    },
  });
  lookupRequest.mockResolvedValue(found(secondAddress));
  act(() =>
    root.render(
      <QueryClientProvider client={client}>
        <FindMyLegislatorScreen navigation={navigation as never} route={{ params: {} } as never} />
      </QueryClientProvider>,
    ),
  );
  act(() => host.querySelector<HTMLElement>('[aria-label="Use my location"]')!.click());
  expect(host.textContent).toContain('Finding your location…');
  act(() =>
    [...host.querySelectorAll<HTMLButtonElement>('button')]
      .find((button) => button.textContent === 'Move map pin')!
      .click(),
  );
  await settle();
  expect(lookupRequest).toHaveBeenCalledOnce();
  expect(lookupRequest.mock.calls[0][0]).toEqual({ latitude: 44.95, longitude: -93.1 });
  expect(host.textContent).toContain(secondAddress);
  act(() => complete({ coords: { latitude: 44.98, longitude: -93.27 } } as GeolocationPosition));
  await settle();
  expect(lookupRequest).toHaveBeenCalledOnce();
  expect(host.textContent).toContain(secondAddress);
  expect(host.textContent).not.toContain('Finding your location…');
});
it('sends a marked choice as an address for the server to check', async () => {
  const marked = { matchedAddress: firstAddress, latitude: 44.97, longitude: -93.26 };
  const plain = { matchedAddress: secondAddress, latitude: 44.98, longitude: -93.27 };
  lookupRequest.mockResolvedValue({
    status: 'address-choice',
    address: '100 First St',
    choices: [{ ...marked, requiresLocationCheck: true }, plain],
  } as RepresentativeLookupResult);
  type('100 First St');
  await submit();
  const options = () => [...host.querySelectorAll<HTMLElement>('[role="option"]')];
  expect(options()).toHaveLength(2);
  lookupRequest.mockResolvedValue(found(firstAddress));
  act(() => options()[0].click());
  await settle();
  expect(lookupRequest.mock.calls[1][0]).toEqual({
    latitude: 44.97,
    longitude: -93.26,
    selectedAddress: firstAddress,
  });
});
it('sends an unmarked choice as its point', async () => {
  lookupRequest.mockResolvedValue({
    status: 'address-choice',
    address: '200 Second St',
    choices: [
      { matchedAddress: firstAddress, latitude: 44.97, longitude: -93.26 },
      { matchedAddress: secondAddress, latitude: 44.98, longitude: -93.27 },
    ],
  } as RepresentativeLookupResult);
  type('200 Second St');
  await submit();
  lookupRequest.mockResolvedValue(found(secondAddress));
  act(() => host.querySelectorAll<HTMLElement>('[role="option"]')[1].click());
  await settle();
  expect(lookupRequest.mock.calls[1][0]).toEqual({ latitude: 44.98, longitude: -93.27 });
});
it('starts the check for at most 2 marked rows the reader points at', async () => {
  const row = (number: number, requiresLocationCheck: boolean) => ({
    matchedAddress: `${number} Main Street, Minneapolis, MN 55415`,
    latitude: 44.97,
    longitude: -93.26,
    ...(requiresLocationCheck ? { requiresLocationCheck } : {}),
  });
  suggestions.mockResolvedValue([row(100, true), row(102, false), row(104, true), row(106, true)]);
  type('100 Main');
  await act(async () => vi.advanceTimersByTimeAsync(200));
  const rows = [...host.querySelectorAll<HTMLElement>('[role="listbox"] [role="option"]')];
  expect(rows).toHaveLength(4);
  for (const index of [0, 0, 1, 2, 3])
    act(() => rows[index].dispatchEvent(new PointerEvent('pointerover', { bubbles: true })));
  expect(preparedLookup.mock.calls.map(([input]) => input)).toEqual([
    { latitude: 44.97, longitude: -93.26, selectedAddress: row(100, true).matchedAddress },
    { latitude: 44.97, longitude: -93.26, selectedAddress: row(104, true).matchedAddress },
  ]);
  expect(lookupRequest).not.toHaveBeenCalled();
});
