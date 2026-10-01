import { describe, expect, it, vi } from 'vitest';
import { createCandidateFlow } from '../candidateFlow';
import type {
  CandidateElection,
  CandidateLookupResponse,
  CandidateResults,
  CandidateSearchServices,
} from '../types';

const general: CandidateElection = {
  id: 'general',
  label: 'General election',
  date: '2030-11-05',
  type: 'general',
};
const primary: CandidateElection = {
  id: 'primary',
  label: 'Primary election',
  date: '2030-08-13',
  type: 'primary',
};
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
const results = (
  electionId: string,
  address = '100 Example Street, Sample City, MN',
): CandidateResults => ({
  kind: 'results',
  electionId,
  matchedAddress: address,
  races: [],
  coverage: [],
});
function services(lookup: CandidateSearchServices['lookup']): CandidateSearchServices {
  return { lookup, getElections: async () => [general, primary], suggest: async () => [] };
}

describe('temporary candidate flow', () => {
  it('keeps each displayed election and address together while changing selection and ignores a late older response', async () => {
    const first = deferred<CandidateLookupResponse>();
    const second = deferred<CandidateLookupResponse>();
    const third = deferred<CandidateLookupResponse>();
    const calls: AbortSignal[] = [];
    const requests = [first, second, third];
    const flow = createCandidateFlow(
      services(async (_, signal) => {
        calls.push(signal);
        return requests[calls.length - 1].promise;
      }),
    );
    const loaded = flow.search({ address: '100 Example Street', electionId: general.id }, general);
    first.resolve(results(general.id));
    await loaded;
    const old = flow.getState().displayed;
    const update = flow.search({ address: '200 Example Street', electionId: primary.id }, primary);
    expect(flow.getState().displayed).toBe(old);
    expect(flow.getState().requested?.electionId).toBe(primary.id);
    const newest = flow.search({ address: '300 Example Street', electionId: general.id }, general);
    expect(calls[1].aborted).toBe(true);
    third.resolve(results(general.id, '300 Example Street'));
    await newest;
    second.resolve(results(primary.id, '200 Example Street'));
    await update;
    expect(flow.getState().displayed?.results.matchedAddress).toBe('300 Example Street');
    expect(flow.getState().displayed?.election.id).toBe(general.id);
  });
  it('keeps failed updates distinct from empty records, retains usable results, and retries the requested election', async () => {
    const lookup = vi
      .fn<CandidateSearchServices['lookup']>()
      .mockResolvedValueOnce(results(general.id))
      .mockRejectedValueOnce(new Error('private address must not be retained'))
      .mockResolvedValueOnce(results(primary.id));
    const flow = createCandidateFlow(services(lookup));
    await flow.search({ address: '100 Example Street', electionId: general.id }, general);
    const old = flow.getState().displayed;
    await flow.search({ address: '100 Example Street', electionId: primary.id }, primary);
    expect(flow.getState()).toMatchObject({ status: 'error', displayed: old, outcome: null });
    expect(JSON.stringify(flow.getState())).not.toContain('private address must not be retained');
    await flow.retry();
    expect(lookup.mock.calls[2][0].electionId).toBe(primary.id);
    expect(flow.getState().displayed?.election.id).toBe(primary.id);
  });
  it('requires an explicit address choice without replacing previous results', async () => {
    const flow = createCandidateFlow(
      services(async (request) =>
        request.address.startsWith('ambiguous')
          ? {
              kind: 'ambiguous',
              choices: [{ id: 'a', label: '100 Example Street', address: '100 Example Street' }],
            }
          : results(request.electionId),
      ),
    );
    await flow.search({ address: '100 Example Street', electionId: general.id }, general);
    const previous = flow.getState().displayed;
    await flow.search({ address: 'ambiguous address', electionId: general.id }, general);
    expect(flow.getState().outcome?.kind).toBe('ambiguous');
    expect(flow.getState().displayed).toBe(previous);
  });
  it('refuses a response labelled as a different election', async () => {
    const flow = createCandidateFlow(services(async () => results(primary.id)));
    await flow.search({ address: '100 Example Street', electionId: general.id }, general);
    expect(flow.getState().status).toBe('error');
    expect(flow.getState().displayed).toBeNull();
  });
  it('clears private addresses even when an abort listener tries to restart a search', async () => {
    const held = deferred<CandidateLookupResponse>();
    let flow: ReturnType<typeof createCandidateFlow>;
    let attempted = false;
    const lookup = vi.fn<CandidateSearchServices['lookup']>(async (_, signal) => {
      signal.addEventListener('abort', () => {
        attempted = true;
        void flow.search({ address: 'restored address', electionId: general.id }, general);
      });
      return held.promise;
    });
    flow = createCandidateFlow(services(lookup));
    const pending = flow.search({ address: 'private address', electionId: general.id }, general);
    flow.clear();
    held.resolve(results(general.id));
    await pending;
    expect(attempted).toBe(true);
    expect(lookup).toHaveBeenCalledOnce();
    expect(flow.getState()).toMatchObject({ status: 'idle', requested: null, displayed: null });
  });
  it('does not let a broken display listener turn a successful record response into an error', async () => {
    const flow = createCandidateFlow(services(async () => results(general.id)));
    flow.subscribe(() => {
      throw new Error('screen error');
    });
    await flow.search({ address: '100 Example Street', electionId: general.id }, general);
    expect(flow.getState().status).toBe('success');
  });
});

describe('short-lived private result reuse', () => {
  it('reuses exact successful searches for 60 seconds without extending freshness', async () => {
    let now = 1_000;
    const clock = vi.spyOn(Date, 'now').mockImplementation(() => now);
    try {
      const lookup = vi
        .fn<CandidateSearchServices['lookup']>()
        .mockResolvedValue(results(general.id));
      const flow = createCandidateFlow(services(lookup));
      const request = { address: '100 Example Street', electionId: general.id };
      await flow.search(request, general);
      now += 59_000;
      await flow.search(request, general);
      expect(lookup).toHaveBeenCalledTimes(1);
      now += 1_000;
      await flow.search(request, general);
      expect(lookup).toHaveBeenCalledTimes(2);
      now += 1_000;
      await flow.search(request, general);
      expect(lookup).toHaveBeenCalledTimes(2);
    } finally {
      clock.mockRestore();
    }
  });
  it('erases retained private requests on clear and limits exact-search reuse to 4 results', async () => {
    const lookup = vi
      .fn<CandidateSearchServices['lookup']>()
      .mockResolvedValue(results(general.id));
    const flow = createCandidateFlow(services(lookup));
    for (let i = 0; i < 5; i++)
      await flow.search({ address: `${i} Example Street`, electionId: general.id }, general);
    await flow.search({ address: '0 Example Street', electionId: general.id }, general);
    expect(lookup).toHaveBeenCalledTimes(6);
    flow.clear();
    expect(flow.getState().displayed).toBeNull();
    expect(flow.getState().draftAddress).toBe('');
    await flow.search({ address: '0 Example Street', electionId: general.id }, general);
    expect(lookup).toHaveBeenCalledTimes(7);
  });
});
