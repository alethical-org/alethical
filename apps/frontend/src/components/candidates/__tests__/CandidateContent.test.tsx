// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { CandidateSearchContent } from '../CandidateSearchContent';
import { CandidateProfileContent, candidateElectionHasPassed } from '../CandidateProfileContent';
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

it('shows the public unavailable state without collecting an address or calling lookup services', async () => {
  const service: CandidateSearchServices = {
    getElections: vi.fn(async () => [general]),
    suggest: vi.fn(async () => []),
    lookup: vi.fn(async () => result()),
  };
  await act(async () =>
    root.render(
      <CandidateSearchContent
        recordsAvailable={false}
        services={service}
        initialAddress="100 Example Street"
        onOpenProfile={() => {}}
      />,
    ),
  );
  await flush();
  expect(host.textContent).toContain('Find my candidates');
  expect(host.textContent).toContain('Records for upcoming elections are not available yet');
  expect(host.querySelector('textarea, [role="combobox"]')).toBeNull();
  expect(host.querySelector('a[href*="/candidates/"]')).toBeNull();
  expect(
    host.querySelector('a[href="https://www.sos.mn.gov/elections-voting/whats-on-my-ballot/"]'),
  ).toBeTruthy();
  expect(host.textContent).not.toMatch(/private|illustrative|census|example a|example b/i);
  expect(service.getElections).not.toHaveBeenCalled();
  expect(service.suggest).not.toHaveBeenCalled();
  expect(service.lookup).not.toHaveBeenCalled();
});

it('names the address field, rejects empty input without a request, and keeps typed text after lookup failure', async () => {
  const lookup = vi
    .fn<CandidateSearchServices['lookup']>()
    .mockRejectedValue(new Error('hidden transport error'));
  await act(async () =>
    root.render(<CandidateSearchContent services={services(lookup)} onOpenProfile={() => {}} />),
  );
  await flush();
  click(button('Find'));
  expect(host.textContent).toContain('Enter your full Minnesota street address');
  expect(host.querySelector('textarea')?.getAttribute('aria-invalid')).toBe('true');
  expect(lookup).not.toHaveBeenCalled();
  const input = type('100 Example Street');
  click(button('Find'));
  await flush();
  expect(input.value).toBe('100 Example Street');
  expect(host.textContent).toContain('Candidate results are unavailable');
  expect(host.textContent).not.toContain('hidden transport error');
});
it('shows notices after races, alphabetical names and real profile links without claiming missing fields', async () => {
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
  const notice = host.querySelector('[role="region"]')!;
  expect(notice).not.toBeNull();
  expect(notice.textContent).toContain('About these results');
  const lastCandidate = host.querySelectorAll('a[href^="/candidates/"]');
  expect(lastCandidate).toHaveLength(2);
  expect(
    lastCandidate[1].compareDocumentPosition(notice) & Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
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
  expect(host.textContent).toContain('General election · November 5, 2030');
  await act(async () => reject(new Error('failure')));
  await flush();
  expect(host.textContent).toContain('We couldn’t update the results');
  click(button('Try again'));
  await flush();
  expect(host.querySelector('a[href="/candidates/primary-a"]')).toBeTruthy();
  expect(host.textContent).not.toContain('Elect 1');
});
it('uses the most recent supported past election when none is upcoming', async () => {
  const lookup = vi.fn<CandidateSearchServices['lookup']>().mockResolvedValue(result());
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
  expect(lookup).toHaveBeenCalledWith(
    expect.objectContaining({ electionId: general.id }),
    expect.any(AbortSignal),
  );
  expect(host.textContent).toContain('November 7, 2000');
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
    .mockResolvedValueOnce(result())
    .mockResolvedValueOnce(result(primary.id));
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
  expect(lookup.mock.calls[1][0]).toMatchObject({
    address: '100 Example Street',
    confirmedChoice: choice,
  });
  expect(host.querySelector('a[href="/candidates/general-a"]')).toBeTruthy();
  const election = host.querySelector<HTMLElement>('[role="combobox"]')!;
  press(election, 'Enter');
  press(election, 'ArrowUp');
  press(election, 'Enter');
  await flush();
  expect(lookup.mock.calls[2][0]).toMatchObject({
    address: '100 Example Street',
    electionId: primary.id,
    confirmedChoice: choice,
  });
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
  const field = host.querySelector<HTMLTextAreaElement>('textarea')!;
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
  const find = button('Find');
  act(() => find.focus());
  click(find);
  click(find);
  expect(lookup).toHaveBeenCalledOnce();
  expect(document.activeElement).toBe(find);
  expect(find.getAttribute('aria-busy')).toBe('true');
  expect(find.getAttribute('aria-disabled')).toBe('true');
  expect(find.textContent).toBe('Finding candidates…');
  expect(find.getAttribute('disabled')).toBeNull();
  expect(
    [...host.querySelectorAll('[aria-live="polite"]')]
      .map((region) => region.textContent)
      .join(' '),
  ).toContain('Finding candidates…');
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
  click(button('Find'));
  await flush();
  expect(host.querySelector('a[href="/candidates/general-a"]')).toBeTruthy();
  expect(host.textContent).toContain('Choose your address');
  const list = host.querySelector<HTMLElement>('[role="listbox"]')!;
  press(list, 'Enter');
  await flush();
  expect(lookup.mock.calls[2][0].confirmedChoice).toEqual(choice);
  expect(host.querySelector('textarea')).toBeNull();
  expect(host.textContent).toContain(choice.address);
});

it('keeps address editing open when typing the previous request and closes only after submitting', async () => {
  const lookup = vi.fn<CandidateSearchServices['lookup']>().mockResolvedValue(result());
  const service = services(lookup);
  const flow = createCandidateFlow(service);
  const renderSearch = () =>
    root.render(
      <CandidateSearchContent
        services={service}
        flow={flow}
        initialAddress="100 Example Street"
        onOpenProfile={() => {}}
      />,
    );
  await act(async () => renderSearch());
  await flush();
  act(() => root.render(<div>Candidate profile</div>));
  await act(async () => renderSearch());
  await flush();
  click(button('Change address'));
  type('100 Example Street');
  await flush();
  expect(host.querySelector<HTMLTextAreaElement>('textarea')?.value).toBe('100 Example Street');
  expect(lookup).toHaveBeenCalledOnce();
  type('100 Example Street, United States');
  type('100 Example Street');
  await flush();
  expect(host.querySelector('textarea')).toBeTruthy();
  click(button('Find'));
  await flush();
  expect(host.querySelector('textarea')).toBeNull();
  // The submitted exact request can use the recent result without another network call.
  expect(lookup).toHaveBeenCalledOnce();
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
  click(button('Find'));
  const input = type('300 Example Street');
  expect(lookup.mock.calls[1][1].aborted).toBe(true);
  await act(async () => resolveOld({ ...result(), matchedAddress: '200 Example Street' }));
  await flush();
  expect(input.value).toBe('300 Example Street');
  expect(host.querySelector('textarea')).toBe(input);
  expect(host.textContent).toContain('100 Example Street, Sample City, MN');
  expect(flow.getState().draftAddress).toBe('300 Example Street');
  act(() => root.render(<div>Candidate profile</div>));
  await act(async () =>
    root.render(<CandidateSearchContent services={service} flow={flow} onOpenProfile={() => {}} />),
  );
  await flush();
  expect(host.querySelector<HTMLTextAreaElement>('textarea')?.value).toBe('300 Example Street');
  click(button('Find'));
  await flush();
  expect(host.querySelector('textarea')).toBeNull();
  expect(host.textContent).toContain('300 Example Street');
});

it('describes the injected illustrative service without claiming a Census request', async () => {
  act(() =>
    root.render(
      <CandidateSearchContent
        services={services()}
        onOpenProfile={() => {}}
        privacyDisclosure="Illustrative data: your address stays in this browser"
      />,
    ),
  );
  await flush();
  expect(host.textContent).toContain('Illustrative data: your address stays in this browser');
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

it('clears the rendered address and cancels suggestions when the private flow resets', async () => {
  vi.useFakeTimers();
  let resolve!: (value: { id: string; label: string; address: string }[]) => void;
  const suggest = vi.fn<CandidateSearchServices['suggest']>(
    () =>
      new Promise((yes) => {
        resolve = yes;
      }),
  );
  const service = { ...services(), suggest };
  const flow = createCandidateFlow(service);
  await act(async () =>
    root.render(<CandidateSearchContent services={service} flow={flow} onOpenProfile={() => {}} />),
  );
  await flush();
  act(() => host.querySelector<HTMLTextAreaElement>('textarea')!.focus());
  type('100 Private Street');
  await act(async () => vi.advanceTimersByTime(180));
  expect(suggest).toHaveBeenCalledOnce();
  act(() => flow.clear());
  await flush();
  expect(suggest.mock.calls[0][1].aborted).toBe(true);
  expect(host.querySelector<HTMLTextAreaElement>('textarea')?.value).toBe('');
  await act(async () =>
    resolve([{ id: 'old', label: '100 Private Street', address: '100 Private Street' }]),
  );
  expect(host.querySelector('[role="option"]')).toBeNull();
  expect(host.textContent).not.toContain('100 Private Street');
});

it('does not restore or automatically search an old initial address after elections finish across a reset', async () => {
  const pending: { resolve(value: CandidateElection[]): void; signal: AbortSignal }[] = [];
  const lookup = vi.fn<CandidateSearchServices['lookup']>(async () => result());
  const service = {
    ...services(lookup),
    getElections: (signal: AbortSignal) =>
      new Promise<CandidateElection[]>((resolve) => pending.push({ resolve, signal })),
  };
  const flow = createCandidateFlow(service);
  flow.setDraftAddress('100 Private Street');
  await act(async () =>
    root.render(
      <CandidateSearchContent
        services={service}
        flow={flow}
        initialAddress="100 Private Street"
        onOpenProfile={() => {}}
      />,
    ),
  );
  expect(host.querySelector<HTMLTextAreaElement>('textarea')?.value).toBe('100 Private Street');
  act(() => flow.clear());
  expect(pending[0].signal.aborted).toBe(true);
  await act(async () => {
    for (const request of pending) request.resolve([general]);
  });
  await flush();
  expect(host.querySelector<HTMLTextAreaElement>('textarea')?.value).toBe('');
  expect(lookup).not.toHaveBeenCalled();
});

it('keeps a November 3 election available during Minnesota evening after UTC has reached November 4', async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-11-04T02:00:00Z'));
  const election = { ...general, date: '2026-11-03' };
  const lookup = vi.fn<CandidateSearchServices['lookup']>(async () => result());
  const service = { ...services(lookup), getElections: async () => [election] };
  await act(async () =>
    root.render(<CandidateSearchContent services={service} onOpenProfile={() => {}} />),
  );
  await flush();
  expect(host.querySelector('textarea')).toBeTruthy();
  type('100 Example Street');
  click(button('Find'));
  await flush();
  expect(lookup).toHaveBeenCalledOnce();
});

it('uses Minnesota election day without implying a winner', () => {
  expect(candidateElectionHasPassed('2026-11-03', new Date('2026-11-04T05:59:00Z'))).toBe(false);
  expect(candidateElectionHasPassed('2026-11-03', new Date('2026-11-04T06:00:00Z'))).toBe(true);
});
it('keeps confirmed service distinct, links the same legislator and removes failed photos', () => {
  const open = vi.fn();
  const record = {
    candidate: { id: 'sample', name: 'Sample Person', sortName: 'Person' },
    election: general,
    office: 'Attorney General',
    votingArea: 'Statewide',
    source,
    photo: { url: 'https://example.org/portrait.jpg' },
    legislator: {
      id: 'person',
      slug: 'sample-person',
      name: 'Sample Person',
      profileUrl: '/legislators/sample-person',
      serviceStatus: 'current' as const,
      isReelection: false,
      office: 'State Senator',
      votingArea: 'Senate District 12',
    },
  };
  act(() =>
    root.render(
      <CandidateProfileContent record={record} onBack={() => {}} onOpenLegislator={open} />,
    ),
  );
  expect(host.textContent).toContain('Currently serving asState Senator');
  expect(host.textContent).toContain('Running forAttorney General');
  const link = host.querySelector<HTMLAnchorElement>('a[href="/legislators/sample-person"]')!;
  click(link);
  expect(open).toHaveBeenCalledWith('sample-person');
  const img = host.querySelector('img')!;
  act(() => img.dispatchEvent(new Event('error')));
  expect(host.querySelector('img')).toBeNull();
  act(() =>
    root.render(
      <CandidateProfileContent
        record={{ ...record, legislator: { ...record.legislator, serviceStatus: 'unknown' } }}
        onBack={() => {}}
      />,
    ),
  );
  expect(host.textContent).not.toContain('Currently serving as');
  expect(host.textContent).not.toContain('Formerly served as');
  expect(host.querySelector('a[href="/legislators/sample-person"]')).toBeTruthy();
});
it('shows a reelection office once and offers Find my candidates on direct entry', () => {
  act(() =>
    root.render(
      <CandidateProfileContent
        fromSearch={false}
        onBack={() => {}}
        record={{
          candidate: { id: 'sample', name: 'Sample Person', sortName: 'Person' },
          election: general,
          office: 'State Senator',
          votingArea: 'Senate District 12',
          source,
          legislator: {
            id: 'person',
            slug: 'sample-person',
            name: 'Sample Person',
            profileUrl: '/legislators/sample-person',
            serviceStatus: 'current',
            isReelection: true,
            office: 'State Senator',
            votingArea: 'Senate District 12',
          },
        }}
      />,
    ),
  );
  expect(host.textContent).toContain('Running for reelection');
  expect(host.textContent!.match(/State Senator/g)).toHaveLength(1);
  expect(host.textContent).toContain('Find my candidates');
  expect(host.textContent).not.toContain('Back to candidates');
});

it('shows source-provided election dates and matching office districts once', () => {
  act(() =>
    root.render(
      <CandidateProfileContent
        onBack={() => {}}
        record={{
          candidate: { id: 'sample', name: 'Sample Person', sortName: 'Person' },
          election: {
            id: '8334',
            label: 'November 3, 2026 general election',
            date: '2026-11-03',
            type: 'general',
          },
          office: 'State Representative District 60B',
          votingArea: 'House District 60B',
          source,
        }}
      />,
    ),
  );
  expect(host.textContent!.match(/November 3, 2026/g)).toHaveLength(1);
  expect(host.textContent).toContain('General election');
  expect(host.textContent).not.toContain('State Representative District 60B');
  expect(host.textContent!.match(/State Representative/g)).toHaveLength(1);
  expect(host.textContent!.match(/District 60B/g)).toHaveLength(1);
});
