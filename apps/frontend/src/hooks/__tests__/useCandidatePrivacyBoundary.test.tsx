// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useCandidatePrivacyBoundary } from '../useCandidatePrivacyBoundary';
import { candidateFlow } from '../../data/candidates';
import { CandidateSearchContent } from '../../components/candidates/CandidateSearchContent';
import type { CandidateElection, CandidateSearchServices } from '../../components/candidates/types';
const auth = vi.hoisted(() => {
  process.env.EXPO_PUBLIC_API_URL = 'https://api.alethical.com';
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  return { isSignedIn: false, user: null as { id: string } | null };
});
vi.mock('../../providers/AuthProvider', () => ({ useAuth: () => auth }));
vi.mock('react-native-svg', () => ({
  default: ({ children, ...props }: React.PropsWithChildren) => <svg {...props}>{children}</svg>,
  Path: (props: React.SVGProps<SVGPathElement>) => <path {...props} />,
  Circle: (props: React.SVGProps<SVGCircleElement>) => <circle {...props} />,
}));
function Boundary({
  services,
  initialAddress,
}: {
  services?: CandidateSearchServices;
  initialAddress?: string;
}) {
  useCandidatePrivacyBoundary();
  return services ? (
    <CandidateSearchContent
      services={services}
      flow={candidateFlow}
      initialAddress={initialAddress}
      onOpenProfile={() => {}}
    />
  ) : null;
}
let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  candidateFlow.clear();
  auth.isSignedIn = false;
  auth.user = null;
  host = document.createElement('div');
  root = createRoot(host);
  act(() => root.render(<Boundary />));
});
afterEach(() => {
  act(() => root.unmount());
  candidateFlow.clear();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

it('erases the rendered input and pending suggestions on an account change', async () => {
  vi.useFakeTimers();
  let resolve!: (value: { id: string; address: string; label: string }[]) => void;
  const suggest = vi.fn<CandidateSearchServices['suggest']>(
    () =>
      new Promise((yes) => {
        resolve = yes;
      }),
  );
  const services: CandidateSearchServices = {
    getElections: async () => [
      { id: '8334', label: 'General election', date: '2030-11-05', type: 'general' },
    ],
    suggest,
    lookup: vi.fn(),
  };
  await act(async () => root.render(<Boundary services={services} />));
  const field = host.querySelector<HTMLTextAreaElement>('textarea')!;
  act(() => {
    field.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(
      field,
      '100 Private Street',
    );
    field.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await act(async () => vi.advanceTimersByTime(180));
  expect(suggest).toHaveBeenCalledOnce();
  auth.isSignedIn = true;
  auth.user = { id: 'account-a' };
  await act(async () => root.render(<Boundary services={services} />));
  expect(host.querySelector<HTMLTextAreaElement>('textarea')?.value).toBe('');
  expect(suggest.mock.calls[0][1].aborted).toBe(true);
  await act(async () =>
    resolve([{ id: 'old', label: '100 Private Street', address: '100 Private Street' }]),
  );
  expect(host.querySelector('[role="option"]')).toBeNull();
});

it('cannot auto-search a prior account address when its election load finishes late', async () => {
  const pending: { resolve(value: CandidateElection[]): void; signal: AbortSignal }[] = [];
  const lookup = vi.fn<CandidateSearchServices['lookup']>();
  const services: CandidateSearchServices = {
    getElections: (signal) => new Promise((resolve) => pending.push({ resolve, signal })),
    suggest: async () => [],
    lookup,
  };
  candidateFlow.setDraftAddress('100 Private Street');
  await act(async () =>
    root.render(<Boundary services={services} initialAddress="100 Private Street" />),
  );
  expect(host.querySelector<HTMLTextAreaElement>('textarea')?.value).toBe('100 Private Street');
  auth.isSignedIn = true;
  auth.user = { id: 'account-b' };
  await act(async () =>
    root.render(<Boundary services={services} initialAddress="100 Private Street" />),
  );
  expect(pending[0].signal.aborted).toBe(true);
  await act(async () => {
    for (const load of pending)
      load.resolve([
        { id: '8334', label: 'General election', date: '2030-11-05', type: 'general' },
      ]);
  });
  expect(host.querySelector<HTMLTextAreaElement>('textarea')?.value).toBe('');
  expect(lookup).not.toHaveBeenCalled();
});
it('clears private searches and cancels their pending replacement on sign-in, account change and sign-out', async () => {
  let resolve!: (value: Response) => void;
  let pending!: AbortSignal;
  vi.stubGlobal(
    'fetch',
    vi.fn((_: string, options: RequestInit) => {
      pending = options.signal as AbortSignal;
      return new Promise<Response>((yes) => {
        resolve = yes;
      });
    }),
  );
  candidateFlow.setDraftAddress('100 Example Street');
  const search = candidateFlow.search(
    { address: '100 Example Street', electionId: '8334' },
    { id: '8334', label: 'General election', date: '2026-11-03', type: 'general' },
  );
  auth.isSignedIn = true;
  auth.user = { id: 'account-a' };
  act(() => root.render(<Boundary />));
  expect(pending.aborted).toBe(true);
  expect(candidateFlow.getState().draftAddress).toBe('');
  resolve(
    new Response(
      JSON.stringify({
        kind: 'results',
        electionId: '8334',
        matchedAddress: '100 Example Street',
        races: [],
        coverage: [],
      }),
    ),
  );
  await search;
  expect(candidateFlow.getState().displayed).toBeNull();
  candidateFlow.setDraftAddress('200 Example Street');
  auth.user = { id: 'account-b' };
  act(() => root.render(<Boundary />));
  expect(candidateFlow.getState().draftAddress).toBe('');
  candidateFlow.setDraftAddress('300 Example Street');
  auth.isSignedIn = false;
  auth.user = null;
  act(() => root.render(<Boundary />));
  expect(candidateFlow.getState().draftAddress).toBe('');
});
