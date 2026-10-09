// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { CandidateSearchContent } from '../CandidateSearchContent';
import { CandidateButton } from '../CandidateControls';
import { createCandidateFlow } from '../candidateFlow';
import { joinAddressUnit, normalizeAddressUnit } from '../../../lib/candidateAddressUnit';
import type {
  CandidateElection,
  CandidateLocationSuggestion,
  CandidateLookupRequest,
  CandidateLookupResponse,
  CandidateSearchServices,
} from '../types';
vi.hoisted(() => {
  (globalThis as { __DEV__?: boolean }).__DEV__ = false;
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
vi.mock('react-native-svg', () => ({
  default: ({ children, ...props }: React.PropsWithChildren) => <svg {...props}>{children}</svg>,
  Path: (props: React.SVGProps<SVGPathElement>) => <path {...props} />,
  Circle: (props: React.SVGProps<SVGCircleElement>) => <circle {...props} />,
}));

const election: CandidateElection = {
  id: '8334',
  label: 'General election',
  date: '2030-11-05',
  type: 'general',
};
const SUGGESTED = '4821 Sample Ave S, Sample Lake, MN 55999';
const results = (address: string): CandidateLookupResponse => ({
  kind: 'results',
  electionId: election.id,
  matchedAddress: address,
  races: [],
  coverage: [],
});
let host: HTMLDivElement;
let root: Root;
type Position = Parameters<PositionCallback>[0];
let geo: {
  success?: PositionCallback;
  failure?: PositionErrorCallback;
  calls: number;
};
beforeEach(() => {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  geo = { calls: 0 };
  Object.defineProperty(navigator, 'geolocation', {
    configurable: true,
    value: {
      getCurrentPosition(success: PositionCallback, failure: PositionErrorCallback) {
        geo.calls += 1;
        geo.success = success;
        geo.failure = failure;
      },
    },
  });
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.useRealTimers();
});
const flush = () =>
  act(async () => {
    for (let i = 0; i < 5; i += 1) await Promise.resolve();
  });
const click = (element: HTMLElement) => act(() => element.click());
const button = (text: string) =>
  [...host.querySelectorAll<HTMLElement>('[role="button"],button')].find(
    (element) => element.textContent === text,
  );
const textarea = () => host.querySelector<HTMLTextAreaElement>('textarea')!;
const unitInput = () => host.querySelector<HTMLInputElement>('input')!;
function setValue(element: HTMLTextAreaElement | HTMLInputElement, value: string, notify = true) {
  act(() => {
    Object.getOwnPropertyDescriptor(Object.getPrototypeOf(element), 'value')!.set!.call(
      element,
      value,
    );
    if (notify) element.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
const key = (element: HTMLElement, init: KeyboardEventInit & { keyCode?: number }) =>
  act(() => {
    const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
    if (init.keyCode) Object.defineProperty(event, 'keyCode', { value: init.keyCode });
    element.dispatchEvent(event);
  });
const position = (accuracy = 8): Position =>
  ({ coords: { latitude: 45, longitude: -93.2, accuracy } }) as Position;

function setup({
  locate = vi.fn(async () => ({ kind: 'address', address: SUGGESTED }) as const),
  lookup = vi.fn(async (request: CandidateLookupRequest) => results(request.address)),
}: {
  locate?: CandidateSearchServices['locate'];
  lookup?: CandidateSearchServices['lookup'];
} = {}) {
  const services: CandidateSearchServices = {
    getElections: async () => [election],
    suggest: async () => [],
    lookup,
    locate,
  };
  const flow = createCandidateFlow(services);
  return { services, flow, locate, lookup };
}
async function render(
  setupResult: ReturnType<typeof setup>,
  extra: { active?: boolean; initialAddress?: string } = {},
) {
  await act(async () =>
    root.render(
      <CandidateSearchContent
        services={setupResult.services}
        flow={setupResult.flow}
        onOpenProfile={() => {}}
        {...extra}
      />,
    ),
  );
  await flush();
}
async function openConfirmation(current = setup()) {
  await render(current);
  click(button('Use my location')!);
  await act(async () => geo.success!(position()));
  await flush();
  return current;
}

it('asks for location only after the tap and keeps typed text and Find usable while locating', async () => {
  const current = setup();
  await render(current);
  expect(geo.calls).toBe(0);
  setValue(textarea(), '12 Typed Street');
  click(button('Use my location')!);
  expect(geo.calls).toBe(1);
  const locating = button('Locating…')!;
  expect(locating.getAttribute('aria-disabled')).toBe('true');
  expect(textarea().value).toBe('12 Typed Street');
  expect(button('Find')!.getAttribute('aria-disabled')).toBeNull();
  expect(
    [...host.querySelectorAll('[aria-live="polite"]')].some((n) => n.textContent === 'Locating…'),
  ).toBe(true);
});

it('lets a manual search win over location in either completion order', async () => {
  for (const order of ['location-first', 'search-first'] as const) {
    let finish!: (value: CandidateLookupResponse) => void;
    const lookup = vi.fn<CandidateSearchServices['lookup']>(
      () => new Promise<CandidateLookupResponse>((yes) => (finish = yes)),
    );
    const current = setup({ lookup });
    await render(current);
    setValue(textarea(), '12 Typed Street, Sample Lake, MN 55999');
    click(button('Use my location')!);
    const located = geo.success!;
    click(button('Find')!);
    expect(button('Use my location')).toBeTruthy();
    if (order === 'location-first') await act(async () => located(position()));
    await act(async () => finish(results('12 TYPED ST, SAMPLE LAKE, MN 55999')));
    if (order === 'search-first') await act(async () => located(position()));
    await flush();
    expect(host.textContent).not.toContain('Is this your home address?');
    expect(current.locate).not.toHaveBeenCalled();
    expect(current.flow.getState().displayed?.request.address).toBe(
      '12 Typed Street, Sample Lake, MN 55999',
    );
    act(() => root.unmount());
    root = createRoot(host);
  }
});

it('lets typing cancel a pending location reply', async () => {
  let reply!: (value: CandidateLocationSuggestion) => void;
  const current = setup({
    locate: vi.fn(() => new Promise<CandidateLocationSuggestion>((yes) => (reply = yes))),
  });
  await render(current);
  click(button('Use my location')!);
  await act(async () => geo.success!(position()));
  setValue(textarea(), '9 New Street');
  expect(button('Use my location')).toBeTruthy();
  await act(async () => reply({ kind: 'address', address: SUGGESTED }));
  await flush();
  expect(host.textContent).not.toContain('Is this your home address?');
  expect(textarea().value).toBe('9 New Street');
});

it('shows each location failure as information beside a valid field', async () => {
  const cases: [string, () => void, string][] = [
    [
      'blocked',
      () => geo.failure!({ code: 1, PERMISSION_DENIED: 1 } as GeolocationPositionError),
      'Location access is blocked: enter your street address',
    ],
    [
      'timeout',
      () => geo.failure!({ code: 3, PERMISSION_DENIED: 1 } as GeolocationPositionError),
      'Your location isn’t available right now: enter your street address',
    ],
  ];
  for (const [, fail, message] of cases) {
    const current = setup();
    await render(current);
    setValue(textarea(), '4821 Sample');
    click(button('Use my location')!);
    await act(async () => fail());
    await flush();
    expect(host.textContent).toContain(message);
    expect(textarea().value).toBe('4821 Sample');
    expect(textarea().getAttribute('aria-invalid')).toBeNull();
    expect(document.activeElement).toBe(textarea());
    expect(current.locate).not.toHaveBeenCalled();
    act(() => root.unmount());
    root = createRoot(host);
  }
  for (const [reply, message] of [
    [{ kind: 'imprecise' }, 'Your location isn’t precise enough: enter your street address'],
    [{ kind: 'outside-minnesota' }, 'This search covers Minnesota addresses'],
    [new Error('down'), 'Your location isn’t available right now: enter your street address'],
  ] as const) {
    const current = setup({
      locate: vi.fn(async () => {
        if (reply instanceof Error) throw reply;
        return reply;
      }),
    });
    await render(current);
    click(button('Use my location')!);
    await act(async () => geo.success!(position(30)));
    await flush();
    expect(host.textContent).toContain(message);
    expect(textarea().getAttribute('aria-invalid')).toBeNull();
    expect(vi.mocked(current.locate!).mock.calls[0][0]).toEqual({
      latitude: 45,
      longitude: -93.2,
      accuracy: 30,
    });
    act(() => root.unmount());
    root = createRoot(host);
  }
});

it('stops waiting when the permission prompt never answers', async () => {
  vi.useFakeTimers();
  const current = setup();
  await render(current);
  click(button('Use my location')!);
  await act(async () => vi.advanceTimersByTime(30_000));
  expect(host.textContent).toContain(
    'Your location isn’t available right now: enter your street address',
  );
  await act(async () => geo.success!(position()));
  expect(host.textContent).not.toContain('Is this your home address?');
});

it('replaces the form with a focused confirmation that searches only the confirmed address', async () => {
  const current = await openConfirmation();
  const heading = [...host.querySelectorAll('[aria-level="2"]')].find(
    (node) => node.textContent === 'Is this your home address?',
  );
  expect(document.activeElement).toBe(heading);
  expect(host.textContent).toContain(
    'Your device’s location can be approximate or show where you are now, not where you live',
  );
  expect(textarea().value).toBe(SUGGESTED);
  expect(current.lookup).not.toHaveBeenCalled();
  expect(current.flow.getState().draftAddress).toBe('');
  setValue(unitInput(), '3');
  click(button('This is my home address')!);
  await flush();
  expect(vi.mocked(current.lookup).mock.calls[0][0]).toEqual({
    address: '4821 Sample Ave S #3, Sample Lake, MN 55999',
    electionId: election.id,
  });
  expect(current.flow.getState().displayed?.results.matchedAddress).toBe(
    '4821 Sample Ave S #3, Sample Lake, MN 55999',
  );
});

it('submits on Enter with the latest browser-filled values, never during composition or twice', async () => {
  let finish!: (value: CandidateLookupResponse) => void;
  const lookup = vi.fn<CandidateSearchServices['lookup']>(
    () => new Promise<CandidateLookupResponse>((yes) => (finish = yes)),
  );
  await openConfirmation(setup({ lookup }));
  key(textarea(), { key: 'Enter', isComposing: true });
  key(textarea(), { key: 'Enter', keyCode: 229 });
  expect(lookup).not.toHaveBeenCalled();
  // A browser fill can change the value before reporting an input event.
  setValue(textarea(), '10 Filled Rd, Sample Lake, MN 55999', false);
  setValue(unitInput(), 'Apt 4', false);
  key(unitInput(), { key: 'Enter' });
  key(textarea(), { key: 'Enter' });
  click(button('Finding…')!);
  expect(lookup).toHaveBeenCalledTimes(1);
  expect(vi.mocked(lookup).mock.calls[0][0].address).toBe(
    '10 Filled Rd Apt 4, Sample Lake, MN 55999',
  );
  expect(textarea().value).toBe('10 Filled Rd, Sample Lake, MN 55999');
  expect(button('Finding…')!.getAttribute('aria-disabled')).toBe('true');
  await act(async () => finish(results('10 FILLED RD APT 4, SAMPLE LAKE, MN 55999')));
});

it('cancels a running confirmation search when either field changes', async () => {
  for (const edit of ['street', 'unit'] as const) {
    let finish!: (value: CandidateLookupResponse) => void;
    const lookup = vi.fn<CandidateSearchServices['lookup']>(
      () => new Promise<CandidateLookupResponse>((yes) => (finish = yes)),
    );
    const current = await openConfirmation(setup({ lookup }));
    click(button('This is my home address')!);
    expect(button('Finding…')).toBeTruthy();
    const signal = vi.mocked(lookup).mock.calls[0][1] as AbortSignal;
    if (edit === 'street') setValue(textarea(), '4823 Sample Ave S, Sample Lake, MN 55999');
    else setValue(unitInput(), '5');
    expect(signal.aborted).toBe(true);
    expect(button('This is my home address')).toBeTruthy();
    await act(async () => finish(results(SUGGESTED)));
    await flush();
    expect(current.flow.getState().displayed).toBeNull();
    expect(host.textContent).toContain('Is this your home address?');
    act(() => root.unmount());
    root = createRoot(host);
  }
});

it('requires a street address inside the card', async () => {
  const current = await openConfirmation();
  setValue(textarea(), '  ');
  click(button('This is my home address')!);
  expect(host.textContent).toContain('Enter your full Minnesota street address');
  expect(textarea().getAttribute('aria-invalid')).toBe('true');
  expect(document.activeElement).toBe(textarea());
  expect(current.lookup).not.toHaveBeenCalled();
});

it('returns other official outcomes to the form holding the searched address', async () => {
  const current = await openConfirmation(setup({ lookup: async () => ({ kind: 'no-match' }) }));
  setValue(unitInput(), 'Apt 3');
  click(button('This is my home address')!);
  await flush();
  expect(host.textContent).not.toContain('Is this your home address?');
  expect(textarea().value).toBe('4821 Sample Ave S Apt 3, Sample Lake, MN 55999');
  expect(host.textContent).toContain('We couldn’t match that address to election records');
  expect(document.activeElement).toBe(textarea());
  expect(current.flow.getState().requested?.address).toBe(
    '4821 Sample Ave S Apt 3, Sample Lake, MN 55999',
  );
});

it('enters a different address by restoring the earlier text and invalidating the search', async () => {
  let finish!: (value: CandidateLookupResponse) => void;
  const lookup = vi.fn<CandidateSearchServices['lookup']>(
    () => new Promise<CandidateLookupResponse>((yes) => (finish = yes)),
  );
  const current = setup({ lookup });
  await render(current);
  setValue(textarea(), '77 Earlier Street');
  click(button('Use my location')!);
  await act(async () => geo.success!(position()));
  await flush();
  click(button('This is my home address')!);
  click(button('Enter a different address')!);
  expect(textarea().value).toBe('77 Earlier Street');
  expect(document.activeElement).toBe(textarea());
  await act(async () => finish(results(SUGGESTED)));
  await flush();
  expect(current.flow.getState().displayed).toBeNull();
  expect(current.flow.getState().draftAddress).toBe('77 Earlier Street');
});

it('ends an unfinished attempt and discards an unconfirmed suggestion when the page is left or reset', async () => {
  const current = await openConfirmation();
  await render(current, { active: false });
  expect(host.textContent).not.toContain('Is this your home address?');
  await render(current, { active: true });
  click(button('Use my location')!);
  act(() => current.flow.clear());
  await act(async () => geo.success!(position()));
  await flush();
  expect(host.textContent).not.toContain('Is this your home address?');
  expect(current.locate).toHaveBeenCalledTimes(1);
});

it('offers location only on entry, never in Change address', async () => {
  const current = setup();
  await render(current);
  setValue(textarea(), SUGGESTED);
  click(button('Find')!);
  await flush();
  click(button('Change address')!);
  expect(button('Use my location')).toBeUndefined();
});

it('keeps the Find magnifier and word in 1 centred group in ready and busy states', async () => {
  for (const busy of [false, true]) {
    await act(async () =>
      root.render(
        <CandidateButton
          label="Find"
          busyLabel="Finding…"
          reserveBusyLabel
          busy={busy}
          onPress={() => {}}
        />,
      ),
    );
    const control = host.querySelector('[role="button"],button')!;
    const visible = [...control.querySelectorAll('svg')].find(
      (svg) => !svg.closest('[aria-hidden="true"][style*="opacity: 0"]'),
    )!;
    const word = [...control.querySelectorAll('div,span')].find(
      (node) =>
        node.textContent === (busy ? 'Finding…' : 'Find') && !node.closest('[aria-hidden="true"]'),
    )!;
    const group = visible.closest('div')!.parentElement!;
    expect(group.contains(word)).toBe(true);
    expect(getComputedStyle(group).position).toBe('absolute');
    expect(getComputedStyle(group).justifyContent).toBe('center');
    const reserve = control.querySelector('[aria-hidden="true"]')!;
    expect(reserve.textContent).toBe('Finding…');
  }
});

it('joins a unit once in the canonical place without dropping a conflicting unit', () => {
  expect(normalizeAddressUnit(' 3 ')).toBe('#3');
  expect(normalizeAddressUnit('# 3B')).toBe('#3B');
  expect(normalizeAddressUnit('Unit 2')).toBe('Unit 2');
  expect(normalizeAddressUnit('Apt. 3')).toBe('Apt 3');
  expect(joinAddressUnit('4821 Sample Ave S Apt 3, Sample Lake, MN 55999', '3')).toBe(
    '4821 Sample Ave S Apt 3, Sample Lake, MN 55999',
  );
  expect(joinAddressUnit('4821 Sample Ave S Apt 3, Sample Lake, MN 55999', 'Unit 3')).toBe(
    '4821 Sample Ave S Apt 3 Unit 3, Sample Lake, MN 55999',
  );
  expect(joinAddressUnit(SUGGESTED, '')).toBe(SUGGESTED);
  expect(joinAddressUnit(SUGGESTED, 'Apt 3')).toBe(
    '4821 Sample Ave S Apt 3, Sample Lake, MN 55999',
  );
  expect(joinAddressUnit('4821 Sample Ave S Apt 3, Sample Lake, MN 55999', 'apt. 3')).toBe(
    '4821 Sample Ave S Apt 3, Sample Lake, MN 55999',
  );
  expect(joinAddressUnit('4821 Sample Ave S Apt 3, Sample Lake, MN 55999', 'Apt 4')).toBe(
    '4821 Sample Ave S Apt 3 Apt 4, Sample Lake, MN 55999',
  );
  expect(joinAddressUnit('4821 Sample Ave S Sample Lake MN 55999', '3')).toBe(
    '4821 Sample Ave S Sample Lake #3 MN 55999',
  );
  expect(joinAddressUnit('4821 Sample Ave S Sample Lake', 'Apt 3')).toBe(
    '4821 Sample Ave S Sample Lake Apt 3',
  );
});

it('clears an earlier address error when location starts', async () => {
  const current = setup({ lookup: vi.fn(async () => ({ kind: 'no-match' }) as const) });
  await render(current);
  setValue(textarea(), '1 Unknown Rd, Sample Lake, MN 55999');
  click(button('Find')!);
  await flush();
  expect(textarea().getAttribute('aria-invalid')).toBe('true');
  click(button('Use my location')!);
  expect(textarea().getAttribute('aria-invalid')).toBeNull();
  expect(host.textContent).not.toContain('We couldn’t match that address to election records');
});

it('lets an empty Find press end a location attempt', async () => {
  const current = setup();
  await render(current);
  click(button('Use my location')!);
  click(button('Find')!);
  expect(host.textContent).toContain('Enter your full Minnesota street address');
  await act(async () => geo.success!(position()));
  await flush();
  expect(host.textContent).not.toContain('Is this your home address?');
  expect(current.locate).not.toHaveBeenCalled();
});

it('confirms as soon as elections arrive when they were still loading', async () => {
  let elections!: (value: CandidateElection[]) => void;
  const current = setup();
  current.services.getElections = () => new Promise((yes) => (elections = yes));
  await render(current);
  click(button('Use my location')!);
  await act(async () => geo.success!(position()));
  await flush();
  click(button('This is my home address')!);
  expect(button('Finding…')).toBeTruthy();
  expect(current.lookup).not.toHaveBeenCalled();
  await act(async () => elections([election]));
  await flush();
  expect(vi.mocked(current.lookup).mock.calls[0][0].address).toBe(SUGGESTED);
});
