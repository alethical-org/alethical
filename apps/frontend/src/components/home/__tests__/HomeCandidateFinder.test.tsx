// @vitest-environment jsdom
import { createRequire } from 'node:module';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { HomeCandidateFinder } from '../HomeCandidateFinder';
import { createCandidateFlow } from '../../candidates/candidateFlow';
import type { CandidateLookupResponse, CandidateSearchServices } from '../../candidates/types';

vi.hoisted(() => {
  (globalThis as { __DEV__?: boolean }).__DEV__ = false;
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
const responsive = vi.hoisted(() => ({ width: 1440 }));
vi.mock('../../../hooks/useResponsive', () => ({
  useResponsive: () => ({
    isMobile: responsive.width < 768,
    isTablet: responsive.width >= 768 && responsive.width < 1100,
  }),
}));
vi.mock('react-native-svg', () => ({
  default: ({ children }: React.PropsWithChildren) => <svg>{children}</svg>,
  Path: () => <path />,
  Circle: () => <circle />,
  Polygon: () => <polygon />,
}));
const moduleRequire = createRequire(import.meta.url);
const originalSvg = moduleRequire.extensions['.svg'];
beforeAll(() => {
  moduleRequire.extensions['.svg'] = (module) => {
    module.exports = { uri: '/mn-outline.svg' };
  };
});
afterAll(() => {
  if (originalSvg) moduleRequire.extensions['.svg'] = originalSvg;
  else delete moduleRequire.extensions['.svg'];
});
let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  responsive.width = 1440;
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.restoreAllMocks();
});
const address = '100 Example Street, Example City, MN 99999';
function setup(
  lookup: CandidateSearchServices['lookup'] = async () => ({
    kind: 'results',
    electionId: 'future',
    matchedAddress: address,
    races: [],
    coverage: [],
  }),
) {
  const services: CandidateSearchServices = {
    getElections: vi.fn(async () => [
      { id: 'future', label: 'Future election', date: '2030-11-05', type: 'general' as const },
    ]),
    suggest: vi.fn(async () => []),
    lookup: vi.fn(lookup),
  };
  const flow = createCandidateFlow(services);
  const module = {
    candidateFlow: flow,
    candidateSearchServices: services,
    handoffCandidateAddress: (value: string) => {
      flow.clear();
      flow.setDraftAddress(value);
    },
    getCandidateProfile: vi.fn(),
  };
  const load = vi.fn(async () => module);
  const navigate = vi.fn();
  act(() => root.render(<HomeCandidateFinder onNavigate={navigate} load={load} />));
  return { load, navigate, services, flow };
}
function type(value: string) {
  const input = host.querySelector<HTMLTextAreaElement>('textarea')!;
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(
      input,
      value,
    );
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  return input;
}
function submit() {
  act(() => {
    host
      .querySelector('form')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });
}
const flush = () =>
  act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });

it('keeps startup free of search requests and rejects an incomplete address in place', async () => {
  const { load, navigate } = setup();
  expect(load).not.toHaveBeenCalled();
  expect(host.querySelector('label')?.htmlFor).toBe(host.querySelector('textarea')?.id);
  expect(host.querySelector('textarea')?.placeholder).toBe('Street address, city, MN ZIP');
  type('Minneapolis 55414');
  submit();
  await flush();
  expect(load).not.toHaveBeenCalled();
  expect(navigate).not.toHaveBeenCalled();
  expect(host.textContent).toContain('Enter your full Minnesota street address');
  expect(host.querySelector('textarea')?.getAttribute('aria-invalid')).toBe('true');
  expect(document.activeElement).toBe(host.querySelector('textarea'));
});
it('gets the election from the service and hands success to the shared memory flow', async () => {
  const { load, navigate, services, flow } = setup();
  type(address);
  submit();
  await flush();
  expect(load).toHaveBeenCalledOnce();
  expect(services.lookup).toHaveBeenCalledWith(
    { address, electionId: 'future' },
    expect.any(AbortSignal),
  );
  expect(navigate).toHaveBeenCalledOnce();
  expect(flow.getState().displayed?.results.matchedAddress).toBe(address);
  expect(host.querySelector('form')?.getAttribute('action')).toBeNull();
});
it('lets the server match a house number with a short street and city name', async () => {
  const { services } = setup(async () => ({ kind: 'no-match' }));
  type('100 Broadway, Cook MN 55723');
  submit();
  await flush();
  expect(services.lookup).toHaveBeenCalledWith(
    { address: '100 Broadway, Cook MN 55723', electionId: 'future' },
    expect.any(AbortSignal),
  );
});
it('does not navigate to newer address choices when its old search finishes late', async () => {
  let finishOld!: (value: CandidateLookupResponse) => void;
  const { services, flow, navigate } = setup(() => new Promise((resolve) => (finishOld = resolve)));
  type(address);
  submit();
  await flush();
  vi.mocked(services.lookup).mockResolvedValueOnce({
    kind: 'ambiguous',
    choices: [
      { id: 'other', label: '200 Other Street, Cook MN', address: '200 Other Street, Cook MN' },
    ],
  });
  await act(async () =>
    flow.search(
      { address: '200 Other Street, Cook MN', electionId: 'future' },
      { id: 'future', label: 'Future election', date: '2030-11-05', type: 'general' },
    ),
  );
  await act(async () => finishOld({ kind: 'no-match' }));
  expect(navigate).not.toHaveBeenCalled();
});
it.each<Exclude<CandidateLookupResponse['kind'], 'results' | 'ambiguous'>>([
  'no-match',
  'outside-minnesota',
  'rate-limited',
  'no-elections',
])('retains the typed address and stays home for %s', async (kind) => {
  const { navigate } = setup(async () => ({ kind }));
  const input = type(address);
  submit();
  await flush();
  expect(navigate).not.toHaveBeenCalled();
  expect(input.value).toBe(address);
  expect(host.textContent).toContain(
    kind === 'no-match' || kind === 'outside-minnesota'
      ? 'We couldn’t match that address'
      : 'We couldn’t complete your search',
  );
  expect(host.textContent).not.toContain('no candidates');
});
it('keeps the busy button size and ignores repeated submits, then retries failure', async () => {
  let resolve!: (value: CandidateLookupResponse) => void;
  const { services, navigate } = setup(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  type(address);
  submit();
  await flush();
  submit();
  await flush();
  expect(services.lookup).toHaveBeenCalledOnce();
  expect(host.querySelector('button')?.disabled).toBe(true);
  expect(host.querySelector('textarea')?.readOnly).toBe(true);
  expect(host.textContent).toContain('Finding candidates…');
  await act(async () => resolve({ kind: 'rate-limited' }));
  expect(host.querySelector('button')?.textContent).toContain('Try again');
  expect(host.querySelector('button')?.disabled).toBe(false);
  expect(host.querySelector('textarea')?.value).toBe(address);
  submit();
  await flush();
  expect(services.lookup).toHaveBeenCalledTimes(2);
  await act(async () =>
    resolve({
      kind: 'results',
      electionId: 'future',
      matchedAddress: address,
      races: [],
      coverage: [],
    }),
  );
  expect(navigate).toHaveBeenCalledOnce();
});
it('opens supported address choices in the candidate screen without saving the address in a URL', async () => {
  const { navigate, flow } = setup(async () => ({
    kind: 'ambiguous',
    choices: [{ id: 'choice', label: address, address }],
  }));
  type(address);
  submit();
  await flush();
  expect(navigate).toHaveBeenCalledWith();
  expect(flow.getState().outcome?.kind).toBe('ambiguous');
  expect(host.querySelector('form')?.getAttribute('method')).toBeNull();
});
it.each([1440, 900, 375])('keeps the approved map and phone form choices at %ipx', (width) => {
  responsive.width = width;
  setup();
  expect(Boolean(host.querySelector('[data-testid=home-candidate-outline]'))).toBe(width >= 768);
  const field = host.querySelector('.hc-field')!;
  expect(field.querySelector('svg') !== null).toBe(width >= 768);
  expect(host.querySelector('textarea')?.getAttribute('autocomplete')).toBe('street-address');
  expect(host.textContent).toContain(
    'Explore the candidates in your Minnesota races, with links to official records',
  );
  expect(host.textContent).toContain('Alethical does not save it');
});
it('ignores a late response after the homepage is removed', async () => {
  let resolve!: (value: CandidateLookupResponse) => void;
  const { navigate } = setup(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  type(address);
  submit();
  await flush();
  act(() => root.render(<div>Another screen</div>));
  await act(async () =>
    resolve({
      kind: 'results',
      electionId: 'future',
      matchedAddress: address,
      races: [],
      coverage: [],
    }),
  );
  expect(navigate).not.toHaveBeenCalled();
});

it('grows the address field and submits Enter without inserting a newline', async () => {
  const { navigate, services } = setup();
  const input = host.querySelector<HTMLTextAreaElement>('textarea')!;
  Object.defineProperty(input, 'scrollHeight', { configurable: true, value: 108 });
  type(address);
  expect(input.style.height).toBe('108px');
  await act(async () => {
    input.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
    );
  });
  expect(input.value).not.toContain('\n');
  expect(services.lookup).toHaveBeenCalled();
  expect(navigate).toHaveBeenCalledOnce();
});
