// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { CandidateSearchContent } from '../CandidateSearchContent';
import { CandidateProfileContent } from '../CandidateProfileContent';
import { createCandidateFlow } from '../candidateFlow';
import type {
  CandidateElection,
  CandidateLookupResponse,
  CandidateResults,
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
let host: HTMLDivElement;
let root: Root;
const general: CandidateElection = {
  id: 'general',
  label: 'General election',
  date: '2030-11-05',
  type: 'general',
};
const primary: CandidateElection = {
  id: 'primary',
  label: 'Primary election',
  date: '2000-08-13',
  type: 'primary',
};
const source = {
  authority: 'Example election office',
  url: 'https://example.org/records',
  checkedDate: '2030-10-01',
};
const result = (electionId = general.id): CandidateResults => ({
  kind: 'results',
  electionId,
  matchedAddress: '100 Example Street, Sample City, MN',
  coverage: [
    {
      kind: 'district-unconfirmed',
      office: 'School board',
      authority: source.authority,
      url: source.url,
    },
  ],
  races: [
    {
      id: 'house',
      group: 'state',
      office: 'State Representative',
      votingArea: 'House District 1A',
      seatCount: 1,
      source,
      entries: [
        {
          kind: 'candidate',
          candidate: {
            id: `${electionId}-b`,
            name: 'Example B',
            sortName: 'B',
            party: 'Example party',
          },
        },
        {
          kind: 'candidate',
          candidate: { id: `${electionId}-a`, name: 'Example A', sortName: 'A' },
        },
      ],
    },
  ],
});
const services = (
  lookup: CandidateSearchServices['lookup'] = async () => result(),
): CandidateSearchServices => ({
  getElections: async () => [general, primary],
  suggest: async () => [],
  lookup,
});
const flush = () =>
  act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
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
const click = (element: HTMLElement) => act(() => element.click());
const press = (element: HTMLElement, key: string) =>
  act(() => {
    element.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
  });
const button = (text: string) =>
  [...host.querySelectorAll<HTMLElement>('[role="button"],button')].find((element) =>
    element.textContent?.includes(text),
  )!;
function type(value: string) {
  const input = host.querySelector<HTMLInputElement>('input')!;
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  return input;
}

it('names the address field, rejects empty input without a request, and keeps typed text after lookup failure', async () => {
  const lookup = vi
    .fn<CandidateSearchServices['lookup']>()
    .mockRejectedValue(new Error('hidden transport error'));
  await act(async () =>
    root.render(<CandidateSearchContent services={services(lookup)} onOpenProfile={() => {}} />),
  );
  await flush();
  click(button('Find My Candidates'));
  expect(host.textContent).toContain('Enter your full Minnesota street address');
  expect(host.querySelector('input')?.getAttribute('aria-invalid')).toBe('true');
  expect(lookup).not.toHaveBeenCalled();
  const input = type('100 Example Street');
  click(button('Find My Candidates'));
  await flush();
  expect(input.value).toBe('100 Example Street');
  expect(host.textContent).toContain('Candidate results are unavailable');
  expect(host.textContent).not.toContain('hidden transport error');
});
it('shows coverage before races, alphabetical names and real profile links without claiming missing fields', async () => {
  const open = vi.fn();
  await act(async () =>
    root.render(
      <CandidateSearchContent
        services={services()}
        initialAddress="100 Example Street"
        onOpenProfile={open}
      />,
    ),
  );
  await flush();
  expect(host.textContent!.indexOf('Coverage for this address')).toBeLessThan(
    host.textContent!.indexOf('State offices'),
  );
  expect(host.textContent!.indexOf('Example A')).toBeLessThan(
    host.textContent!.indexOf('Example B'),
  );
  const link = host.querySelector<HTMLAnchorElement>('a[href="/candidates/general-a"]')!;
  expect(link.getAttribute('aria-label')).toBe('View profile, Example A');
  click(link);
  expect(open).toHaveBeenCalledWith('general-a');
  expect(host.textContent).toContain('Candidate records from Example election office');
  expect(host.textContent).not.toContain('Claim this profile');
});
it('keeps old results and election attached while changing selection by keyboard, then retries failure', async () => {
  let reject!: (error: Error) => void;
  const pending = new Promise<CandidateLookupResponse>((_, no) => {
    reject = no;
  });
  const lookup = vi
    .fn<CandidateSearchServices['lookup']>()
    .mockResolvedValueOnce(result())
    .mockReturnValueOnce(pending)
    .mockResolvedValueOnce(result(primary.id));
  const service = services(lookup);
  const flow = createCandidateFlow(service);
  await act(async () =>
    root.render(
      <CandidateSearchContent
        services={service}
        flow={flow}
        initialAddress="100 Example Street"
        onOpenProfile={() => {}}
      />,
    ),
  );
  await flush();
  const election = host.querySelector<HTMLElement>('[role="combobox"]')!;
  act(() => election.focus());
  press(election, 'Enter');
  press(election, 'ArrowUp');
  press(election, 'Enter');
  await flush();
  expect(lookup.mock.calls[1][0].electionId).toBe(primary.id);
  expect(host.textContent).toContain('Updating candidates…');
  expect(host.querySelector('a[href="/candidates/general-a"]')).toBeTruthy();
  expect(host.textContent).toContain('General election · Nov 5, 2030');
  await act(async () => reject(new Error('failure')));
  await flush();
  expect(host.textContent).toContain('We couldn’t update the results');
  click(button('Try again'));
  await flush();
  expect(host.querySelector('a[href="/candidates/primary-a"]')).toBeTruthy();
  expect(host.textContent).not.toContain('Elect 1');
});
it('does not silently use an old election when none is upcoming', async () => {
  const lookup = vi.fn<CandidateSearchServices['lookup']>();
  const service = {
    ...services(lookup),
    getElections: async () => [{ ...general, date: '2000-11-07' }],
  };
  await act(async () =>
    root.render(
      <CandidateSearchContent
        services={service}
        initialAddress="100 Example Street"
        onOpenProfile={() => {}}
      />,
    ),
  );
  await flush();
  expect(host.textContent).toContain('Records for upcoming elections are not available yet');
  expect(lookup).not.toHaveBeenCalled();
  expect(host.querySelector('[role="combobox"]')).toBeNull();
});
it('requires a keyboard-confirmed ambiguous address and passes its choice to the service', async () => {
  const choice = {
    id: 'official-a',
    label: '100 Example Street, Sample City, MN',
    address: '100 Example Street, Sample City, MN',
  };
  const lookup = vi
    .fn<CandidateSearchServices['lookup']>()
    .mockResolvedValueOnce({ kind: 'ambiguous', choices: [choice] })
    .mockResolvedValueOnce(result());
  await act(async () =>
    root.render(
      <CandidateSearchContent
        services={services(lookup)}
        initialAddress="100 Example Street"
        onOpenProfile={() => {}}
      />,
    ),
  );
  await flush();
  const list = host.querySelector<HTMLElement>('[role="listbox"]')!;
  expect(document.activeElement).toBe(list);
  expect(lookup).toHaveBeenCalledOnce();
  press(list, 'Enter');
  await flush();
  expect(lookup.mock.calls[1][0].confirmedChoice).toEqual(choice);
  expect(host.querySelector('a[href="/candidates/general-a"]')).toBeTruthy();
});
it('does not invent filing facts or claim controls on a read-only candidate profile', () => {
  act(() =>
    root.render(
      <CandidateProfileContent
        onBack={() => {}}
        record={{
          candidate: { id: 'example', name: 'Example Candidate', sortName: 'Candidate' },
          election: general,
          office: 'School Board',
          votingArea: 'Example school district',
          source,
        }}
      />,
    ),
  );
  expect(host.textContent).toContain('Official candidate record');
  expect(host.textContent).not.toContain('Filed date');
  expect(host.textContent).not.toContain('Filed with');
  expect(host.textContent).not.toContain('Claim');
  expect(host.textContent).not.toContain('Report a record error');
  expect(host.querySelector('a[href="/candidates"]')).toBeTruthy();
});

it('ignores an old address suggestion response and lets the keyboard choose the latest suggestion', async () => {
  vi.useFakeTimers();
  let oldResolve!: (value: { id: string; label: string; address: string }[]) => void;
  let newResolve!: (value: { id: string; label: string; address: string }[]) => void;
  const old = new Promise<{ id: string; label: string; address: string }[]>((yes) => {
    oldResolve = yes;
  });
  const newest = new Promise<{ id: string; label: string; address: string }[]>((yes) => {
    newResolve = yes;
  });
  const lookup = vi.fn<CandidateSearchServices['lookup']>().mockResolvedValue(result());
  const suggest = vi
    .fn<CandidateSearchServices['suggest']>()
    .mockReturnValueOnce(old)
    .mockReturnValueOnce(newest);
  const service = { ...services(lookup), suggest };
  await act(async () =>
    root.render(<CandidateSearchContent services={service} onOpenProfile={() => {}} />),
  );
  await flush();
  const field = host.querySelector<HTMLInputElement>('input')!;
  act(() => field.focus());
  type('100 Example');
  await act(async () => vi.advanceTimersByTime(180));
  type('200 Example');
  await act(async () => vi.advanceTimersByTime(180));
  expect(suggest.mock.calls[0][1].aborted).toBe(true);
  const choice = { id: 'new', label: '200 Example Street', address: '200 Example Street' };
  await act(async () => {
    newResolve([choice]);
    oldResolve([{ id: 'old', label: '100 Example Street', address: '100 Example Street' }]);
  });
  expect(host.querySelector('[role="option"]')?.textContent).toBe('200 Example Street');
  press(field, 'ArrowDown');
  press(field, 'Enter');
  await flush();
  expect(lookup.mock.calls[0][0].confirmedChoice).toEqual(choice);
});

it('keeps the same focused busy button and prevents repeat submission', async () => {
  let resolve!: (value: CandidateLookupResponse) => void;
  const waiting = new Promise<CandidateLookupResponse>((yes) => {
    resolve = yes;
  });
  const lookup = vi.fn<CandidateSearchServices['lookup']>().mockReturnValue(waiting);
  await act(async () =>
    root.render(<CandidateSearchContent services={services(lookup)} onOpenProfile={() => {}} />),
  );
  await flush();
  type('100 Example Street');
  const find = button('Find My Candidates');
  act(() => find.focus());
  click(find);
  click(find);
  expect(lookup).toHaveBeenCalledOnce();
  expect(document.activeElement).toBe(find);
  expect(find.getAttribute('aria-busy')).toBe('true');
  expect(find.getAttribute('aria-disabled')).toBe('true');
  expect(find.textContent).toBe('Find My Candidates');
  await act(async () => resolve(result()));
  await flush();
});

it('uses the same explicit address-choice flow when changing an address and keeps old results readable', async () => {
  const choice = { id: 'second', label: '200 Example Street', address: '200 Example Street' };
  const lookup = vi
    .fn<CandidateSearchServices['lookup']>()
    .mockResolvedValueOnce(result())
    .mockResolvedValueOnce({ kind: 'ambiguous', choices: [choice] })
    .mockResolvedValueOnce({ ...result(), matchedAddress: choice.address });
  await act(async () =>
    root.render(
      <CandidateSearchContent
        services={services(lookup)}
        initialAddress="100 Example Street"
        onOpenProfile={() => {}}
      />,
    ),
  );
  await flush();
  click(button('Change address'));
  type('200 Example Street');
  click(button('Find My Candidates'));
  await flush();
  expect(host.querySelector('a[href="/candidates/general-a"]')).toBeTruthy();
  expect(host.textContent).toContain('Choose your address');
  const list = host.querySelector<HTMLElement>('[role="listbox"]')!;
  press(list, 'Enter');
  await flush();
  expect(lookup.mock.calls[2][0].confirmedChoice).toEqual(choice);
  expect(host.querySelector('input')).toBeNull();
  expect(host.textContent).toContain(choice.address);
});

it('keeps a newer typed address when a slow earlier search finishes and preserves it through profile navigation', async () => {
  let resolveOld!: (value: CandidateLookupResponse) => void;
  const waiting = new Promise<CandidateLookupResponse>((yes) => {
    resolveOld = yes;
  });
  const lookup = vi
    .fn<CandidateSearchServices['lookup']>()
    .mockResolvedValueOnce(result())
    .mockReturnValueOnce(waiting)
    .mockResolvedValueOnce({ ...result(), matchedAddress: '300 Example Street' });
  const service = services(lookup);
  const flow = createCandidateFlow(service);
  await act(async () =>
    root.render(
      <CandidateSearchContent
        services={service}
        flow={flow}
        initialAddress="100 Example Street"
        onOpenProfile={() => {}}
      />,
    ),
  );
  await flush();
  click(button('Change address'));
  type('200 Example Street');
  click(button('Find My Candidates'));
  const input = type('300 Example Street');
  expect(lookup.mock.calls[1][1].aborted).toBe(true);
  await act(async () => resolveOld({ ...result(), matchedAddress: '200 Example Street' }));
  await flush();
  expect(input.value).toBe('300 Example Street');
  expect(host.querySelector('input')).toBe(input);
  expect(host.textContent).toContain('100 Example Street, Sample City, MN');
  expect(flow.getState().draftAddress).toBe('300 Example Street');
  act(() => root.render(<div>Candidate profile</div>));
  await act(async () =>
    root.render(<CandidateSearchContent services={service} flow={flow} onOpenProfile={() => {}} />),
  );
  await flush();
  expect(host.querySelector<HTMLInputElement>('input')?.value).toBe('300 Example Street');
  click(button('Find My Candidates'));
  await flush();
  expect(host.querySelector('input')).toBeNull();
  expect(host.textContent).toContain('300 Example Street');
});

it('describes the injected private service without claiming a Census request', async () => {
  act(() =>
    root.render(
      <CandidateSearchContent
        services={services()}
        onOpenProfile={() => {}}
        privacyDisclosure="Private preview: your address stays in this browser"
      />,
    ),
  );
  await flush();
  expect(host.textContent).toContain('Private preview: your address stays in this browser');
  expect(host.textContent).not.toContain('Census Bureau');
});

it('explains an empty response without claiming nobody is running', async () => {
  act(() =>
    root.render(
      <CandidateSearchContent
        initialAddress="100 Example Street, Sample City, MN"
        services={services(async () => ({ ...result(), races: [] }))}
        onOpenProfile={() => {}}
      />,
    ),
  );
  await flush();
  await flush();
  expect(host.textContent).toContain('No candidate records to show');
  expect(host.textContent).toContain('No candidate records to show for this address and election');
  expect(host.textContent).not.toContain('No filed candidates listed');
});
