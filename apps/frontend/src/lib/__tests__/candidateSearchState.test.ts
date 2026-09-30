import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createCandidateSearchState,
  type CandidateSearchRequest,
  type CandidateSearchResult,
} from '../candidateSearchState';

type Rows = readonly string[];

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

// Deliberately fake addresses and election labels, never a reader's address.
const firstRequest: CandidateSearchRequest = {
  address: '1 Test Street',
  electionId: 'test-primary',
};
const secondRequest: CandidateSearchRequest = {
  address: '2 Test Street',
  electionId: 'test-general',
};

function resultFor(request: CandidateSearchRequest): CandidateSearchResult<Rows> {
  return {
    electionId: request.electionId,
    electionLabel: `Label for ${request.electionId}`,
    matchedAddress: `${request.address}, Test City`,
    sourceDate: '2026-09-01',
    data: ['Test candidate'],
  };
}

function createFlow() {
  const calls: {
    request: CandidateSearchRequest;
    signal: AbortSignal;
    response: ReturnType<typeof deferred<CandidateSearchResult<Rows>>>;
  }[] = [];
  const lookup = vi.fn((request: CandidateSearchRequest, signal: AbortSignal) => {
    const response = deferred<CandidateSearchResult<Rows>>();
    calls.push({ request, signal, response });
    return response.promise;
  });
  return { flow: createCandidateSearchState(lookup), calls, lookup };
}

afterEach(() => vi.unstubAllGlobals());

describe('candidate search memory', () => {
  it('keeps initial loading distinct from a successful empty result', async () => {
    const { flow, calls } = createFlow();
    expect(flow.getState()).toEqual({
      status: 'idle',
      requested: null,
      displayed: null,
      error: null,
    });
    const search = flow.search(firstRequest);
    expect(flow.getState()).toEqual({
      status: 'loading',
      requested: firstRequest,
      displayed: null,
      error: null,
    });
    calls[0].response.resolve({ ...resultFor(firstRequest), data: [], sourceDate: null });
    await search;
    expect(flow.getState().status).toBe('success');
    expect(flow.getState().displayed?.result.data).toEqual([]);
    expect(flow.getState().displayed?.result.sourceDate).toBeNull();
  });

  it('keeps all old labels with the old rows while address and election change', async () => {
    const { flow, calls } = createFlow();
    const first = flow.search(firstRequest);
    calls[0].response.resolve(resultFor(firstRequest));
    await first;
    const displayed = flow.getState().displayed;
    const second = flow.search(secondRequest);
    expect(flow.getState()).toEqual({
      status: 'updating',
      requested: secondRequest,
      displayed,
      error: null,
    });
    expect(flow.getState().displayed?.request).toEqual(firstRequest);
    expect(flow.getState().displayed?.result).toEqual(resultFor(firstRequest));
    calls[1].response.resolve(resultFor(secondRequest));
    await second;
    expect(flow.getState().displayed).toEqual({
      request: secondRequest,
      result: resultFor(secondRequest),
    });
  });

  it.each(['resolve', 'reject'] as const)(
    'ignores an older request that finishes with %s',
    async (end) => {
      const { flow, calls } = createFlow();
      const first = flow.search(firstRequest);
      const second = flow.search(secondRequest);
      expect(calls[0].signal.aborted).toBe(true);
      calls[1].response.resolve(resultFor(secondRequest));
      await second;
      const current = flow.getState();
      if (end === 'resolve') calls[0].response.resolve(resultFor(firstRequest));
      else calls[0].response.reject(new Error('Late failure'));
      await first;
      expect(flow.getState()).toBe(current);
    },
  );

  it.each([
    { ...firstRequest, address: '3 Test Street' },
    { ...firstRequest, electionId: 'test-general' },
  ])('does not accept old results after changing 1 input while loading: %o', async (changed) => {
    const { flow, calls } = createFlow();
    const first = flow.search(firstRequest);
    const second = flow.search(changed);
    calls[0].response.resolve(resultFor(firstRequest));
    await first;
    expect(flow.getState().requested).toEqual(changed);
    expect(flow.getState().displayed).toBeNull();
    expect(flow.getState().status).toBe('loading');
    calls[1].response.resolve(resultFor(changed));
    await second;
    expect(flow.getState().displayed?.request).toEqual(changed);
  });

  it('retains prior results on failure and explicitly retries the failed selection', async () => {
    const { flow, calls, lookup } = createFlow();
    const first = flow.search(firstRequest);
    calls[0].response.resolve(resultFor(firstRequest));
    await first;
    const displayed = flow.getState().displayed;
    const second = flow.search(secondRequest);
    calls[1].response.reject(new Error(`Service error containing ${secondRequest.address}`));
    await second;
    expect(flow.getState()).toEqual({
      status: 'error',
      requested: secondRequest,
      displayed,
      error: 'lookup-failed',
    });
    expect(lookup).toHaveBeenCalledTimes(2);
    const retry = flow.retry();
    expect(flow.getState().status).toBe('updating');
    expect(flow.getState().displayed).toBe(displayed);
    expect(calls[2].request).toEqual(secondRequest);
    calls[2].response.resolve(resultFor(secondRequest));
    await retry;
    expect(flow.getState().status).toBe('success');
    await flow.retry();
    expect(lookup).toHaveBeenCalledTimes(3);
  });

  it('treats an initial failure as an error, never an empty successful result', async () => {
    const { flow, calls } = createFlow();
    const search = flow.search(firstRequest);
    calls[0].response.reject(new Error('Offline'));
    await search;
    expect(flow.getState().status).toBe('error');
    expect(flow.getState().displayed).toBeNull();
    const retry = flow.retry();
    expect(flow.getState().status).toBe('loading');
    calls[1].response.resolve(resultFor(firstRequest));
    await retry;
    expect(flow.getState().status).toBe('success');
  });

  it.each(['clear', 'dispose'] as const)(
    '%s erases private state and prevents late responses restoring it',
    async (action) => {
      const { flow, calls, lookup } = createFlow();
      flow.handoffFromHome(firstRequest.address);
      const search = flow.search(firstRequest);
      flow[action]();
      expect(calls[0].signal.aborted).toBe(true);
      calls[0].response.resolve(resultFor(firstRequest));
      await search;
      expect(flow.getState()).toEqual({
        status: 'idle',
        requested: null,
        displayed: null,
        error: null,
      });
      expect(flow.consumeHomeAddress()).toBeNull();
      await flow.retry();
      expect(lookup).toHaveBeenCalledTimes(1);
      if (action === 'dispose') {
        flow.handoffFromHome(secondRequest.address);
        await flow.search(secondRequest);
        expect(flow.consumeHomeAddress()).toBeNull();
        expect(lookup).toHaveBeenCalledTimes(1);
      }
    },
  );

  it('hands the homepage address off once and invalidates a previous search', async () => {
    const { flow, calls } = createFlow();
    const search = flow.search(firstRequest);
    flow.handoffFromHome(`  ${secondRequest.address}  `);
    expect(flow.consumeHomeAddress()).toBe(secondRequest.address);
    expect(flow.consumeHomeAddress()).toBeNull();
    calls[0].response.resolve(resultFor(firstRequest));
    await search;
    expect(flow.getState().requested).toBeNull();
    expect(flow.getState().displayed).toBeNull();
    flow.handoffFromHome('   ');
    expect(flow.consumeHomeAddress()).toBeNull();
  });

  it('a new homepage handoff removes the previous successful results and their labels', async () => {
    const { flow, calls } = createFlow();
    const search = flow.search(firstRequest);
    calls[0].response.resolve(resultFor(firstRequest));
    await search;
    flow.handoffFromHome(secondRequest.address);
    expect(flow.getState()).toEqual({
      status: 'idle',
      requested: null,
      displayed: null,
      error: null,
    });
    expect(flow.consumeHomeAddress()).toBe(secondRequest.address);
  });

  it('does not start a lookup if a subscriber clears its address immediately', async () => {
    const { flow, lookup } = createFlow();
    const unsubscribe = flow.subscribe(() => {
      if (flow.getState().status === 'loading') flow.clear();
    });
    await flow.search(firstRequest);
    expect(lookup).not.toHaveBeenCalled();
    expect(flow.getState().requested).toBeNull();
    unsubscribe();
  });

  it('keeps results in this flow for profile return but never across a new flow', async () => {
    const { flow, calls } = createFlow();
    const search = flow.search(firstRequest);
    calls[0].response.resolve(resultFor(firstRequest));
    await search;
    expect(flow.getState().displayed?.result).toEqual(resultFor(firstRequest));
    const fresh = createFlow().flow;
    expect(fresh.getState().displayed).toBeNull();
    expect(fresh.consumeHomeAddress()).toBeNull();
  });

  it('never touches browser persistence, browser history, analytics, or an account', async () => {
    const forbidden = () => {
      throw new Error('Private candidate search accessed persistent or external state');
    };
    const denied = new Proxy({}, { get: forbidden, set: forbidden });
    for (const name of [
      'window',
      'localStorage',
      'sessionStorage',
      'history',
      'analytics',
      'account',
    ]) {
      vi.stubGlobal(name, denied);
    }
    const { flow, calls } = createFlow();
    flow.handoffFromHome(firstRequest.address);
    expect(flow.consumeHomeAddress()).toBe(firstRequest.address);
    const search = flow.search(firstRequest);
    calls[0].response.resolve(resultFor(firstRequest));
    await search;
    flow.clear();
    flow.dispose();
  });

  it('rejects inconsistent election or missing matched-address metadata', async () => {
    const { flow, calls } = createFlow();
    const first = flow.search(firstRequest);
    calls[0].response.resolve(resultFor(secondRequest));
    await first;
    expect(flow.getState().status).toBe('error');
    expect(flow.getState().displayed).toBeNull();
    const retry = flow.retry();
    calls[1].response.resolve({ ...resultFor(firstRequest), matchedAddress: '  ' });
    await retry;
    expect(flow.getState().status).toBe('error');
    expect(flow.getState().displayed).toBeNull();
  });

  it('copies inputs and metadata and removes listeners at disposal', async () => {
    const { flow, calls } = createFlow();
    const listener = vi.fn();
    const unsubscribe = flow.subscribe(listener);
    const input = { ...firstRequest };
    const search = flow.search(input);
    input.address = secondRequest.address;
    expect(calls[0].request).toEqual(firstRequest);
    const result = { ...resultFor(firstRequest) };
    calls[0].response.resolve(result);
    await search;
    result.electionLabel = 'Changed externally';
    expect(flow.getState().displayed?.result.electionLabel).toBe(
      resultFor(firstRequest).electionLabel,
    );
    expect(listener).toHaveBeenCalledTimes(2);
    unsubscribe();
    flow.dispose();
    flow.clear();
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('a search started by an abort callback supersedes the search causing that abort', async () => {
    const { flow, calls } = createFlow();
    const thirdRequest = { ...secondRequest, address: '3 Test Street' };
    const first = flow.search(firstRequest);
    let third = Promise.resolve();
    calls[0].signal.addEventListener('abort', () => {
      third = flow.search(thirdRequest);
    });
    const second = flow.search(secondRequest);
    expect(calls.map((call) => call.request)).toEqual([firstRequest, thirdRequest]);
    await second;
    expect(flow.getState().requested).toEqual(thirdRequest);
    const fourth = flow.search(secondRequest);
    expect(calls[1].signal.aborted).toBe(true);
    calls[2].response.resolve(resultFor(secondRequest));
    await fourth;
    calls[1].response.resolve(resultFor(thirdRequest));
    await third;
    calls[0].response.resolve(resultFor(firstRequest));
    await first;
    expect(flow.getState().displayed?.request).toEqual(secondRequest);
  });

  it.each(['clear', 'dispose', 'handoffFromHome'] as const)(
    '%s blocks a synchronous abort callback from restoring the erased address',
    async (action) => {
      const { flow, calls } = createFlow();
      const first = flow.search(firstRequest);
      let reentrant = Promise.resolve();
      calls[0].signal.addEventListener('abort', () => {
        reentrant = flow.search(secondRequest);
        flow.handoffFromHome(firstRequest.address);
      });
      if (action === 'handoffFromHome') flow.handoffFromHome('4 Test Street');
      else flow[action]();
      expect(calls).toHaveLength(1);
      await reentrant;
      calls[0].response.resolve(resultFor(firstRequest));
      await first;
      expect(flow.getState().requested).toBeNull();
      expect(flow.getState().displayed).toBeNull();
      expect(flow.consumeHomeAddress()).toBe(action === 'handoffFromHome' ? '4 Test Street' : null);
    },
  );

  it('clear blocks notification callbacks from immediately restoring private state', async () => {
    const { flow, calls } = createFlow();
    const first = flow.search(firstRequest);
    calls[0].response.resolve(resultFor(firstRequest));
    await first;
    let reentrant = Promise.resolve();
    let reentered = false;
    flow.subscribe(() => {
      if (flow.getState().status === 'idle' && !reentered) {
        reentered = true;
        reentrant = flow.search(secondRequest);
        flow.handoffFromHome(firstRequest.address);
      }
    });
    flow.clear();
    await reentrant;
    expect(calls).toHaveLength(1);
    expect(flow.getState().requested).toBeNull();
    expect(flow.consumeHomeAddress()).toBeNull();
  });

  it('throwing subscribers neither block lookup nor change success into failure', async () => {
    const { flow, calls } = createFlow();
    flow.subscribe(() => {
      throw new Error('Broken subscriber');
    });
    const listener = vi.fn();
    flow.subscribe(listener);
    const search = flow.search(firstRequest);
    expect(calls).toHaveLength(1);
    expect(listener).toHaveBeenCalledTimes(1);
    calls[0].response.resolve(resultFor(firstRequest));
    await expect(search).resolves.toBeUndefined();
    expect(flow.getState().status).toBe('success');
    expect(flow.getState().error).toBeNull();
    expect(listener).toHaveBeenCalledTimes(2);
    expect(() => flow.dispose()).not.toThrow();
    expect(listener).toHaveBeenCalledTimes(3);
    flow.clear();
    expect(listener).toHaveBeenCalledTimes(3);
  });
});
