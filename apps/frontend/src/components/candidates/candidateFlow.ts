import type {
  CandidateElection,
  CandidateLookupRequest,
  CandidateLookupResponse,
  CandidateResults,
  CandidateSearchServices,
} from './types';

export interface CandidateFlowState {
  resetVersion: number;
  draftAddress: string;
  openGroups: Record<string, boolean>;
  scrollOffset: number;
  status: 'idle' | 'loading' | 'updating' | 'success' | 'error';
  requested: CandidateLookupRequest | null;
  displayed: {
    request: CandidateLookupRequest;
    election: CandidateElection;
    results: CandidateResults;
  } | null;
  outcome: Exclude<CandidateLookupResponse, CandidateResults> | null;
}

/** Keep above search and profile routes; never save this flow to browser storage. */
export function createCandidateFlow(services: CandidateSearchServices) {
  let state: CandidateFlowState = {
    resetVersion: 0,
    draftAddress: '',
    openGroups: {},
    scrollOffset: 0,
    status: 'idle',
    requested: null,
    displayed: null,
    outcome: null,
  };
  const listeners = new Set<() => void>();
  let pending: AbortController | null = null;
  let generation = 0;
  let disposed = false;
  let resetting = false;
  let lastElection: CandidateElection | null = null;
  // Revisit only recent exact requests; all keys and responses remain private memory.
  // Clear/dispose erases them alongside the visible address. Never cache failures.
  const recent = new Map<string, { expiresAt: number; results: CandidateResults }>();
  const publish = (next: CandidateFlowState) => {
    state = next;
    for (const listener of [...listeners]) {
      try {
        listener();
      } catch {
        /* A listener cannot change a service result. */
      }
    }
  };
  const invalidate = () => {
    const token = ++generation;
    const previous = pending;
    pending = null;
    previous?.abort();
    return token;
  };
  const search = async (input: CandidateLookupRequest, election: CandidateElection) => {
    if (disposed || resetting) return;
    const token = invalidate();
    if (disposed || token !== generation) return;
    const request = { ...input, address: input.address.trim() };
    if (!request.address || request.electionId !== election.id)
      throw new Error('Invalid candidate search');
    lastElection = { ...election };
    const controller = new AbortController();
    pending = controller;
    publish({
      ...state,
      draftAddress: request.address,
      status: state.displayed ? 'updating' : 'loading',
      requested: request,
      outcome: null,
    });
    try {
      if (token !== generation || disposed) return;
      const key = JSON.stringify(request);
      const cached = recent.get(key);
      if (cached && cached.expiresAt <= Date.now()) recent.delete(key);
      const response =
        cached && cached.expiresAt > Date.now()
          ? cached.results
          : await services.lookup(request, controller.signal);
      if (token !== generation || disposed) return;
      if (response.kind === 'results') {
        if (response.electionId !== election.id || !response.matchedAddress.trim())
          throw new Error('Invalid candidate result');
        recent.delete(key);
        recent.set(key, {
          expiresAt:
            cached && cached.expiresAt > Date.now() ? cached.expiresAt : Date.now() + 60_000,
          results: response,
        });
        if (recent.size > 4) recent.delete(recent.keys().next().value!);
        publish({
          resetVersion: state.resetVersion,
          draftAddress: request.address,
          openGroups:
            state.displayed?.results.matchedAddress === response.matchedAddress
              ? state.openGroups
              : {},
          scrollOffset:
            state.displayed?.results.matchedAddress === response.matchedAddress
              ? state.scrollOffset
              : 0,
          status: 'success',
          requested: request,
          outcome: null,
          displayed: { request, election: { ...election }, results: response },
        });
      } else {
        publish({ ...state, status: 'success', outcome: response });
      }
    } catch {
      if (token === generation && !disposed) publish({ ...state, status: 'error', outcome: null });
    } finally {
      if (token === generation) pending = null;
    }
  };
  const clear = () => {
    if (resetting) return;
    resetting = true;
    try {
      invalidate();
      lastElection = null;
      recent.clear();
      publish({
        resetVersion: state.resetVersion + 1,
        draftAddress: '',
        openGroups: {},
        scrollOffset: 0,
        status: 'idle',
        requested: null,
        displayed: null,
        outcome: null,
      });
    } finally {
      resetting = false;
    }
  };
  return {
    getState: () => state,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    search,
    setGroupOpen(group: string, open: boolean) {
      if (!disposed) publish({ ...state, openGroups: { ...state.openGroups, [group]: open } });
    },
    setScrollOffset(offset: number) {
      // Scroll is private navigation memory, not data state; avoid rerendering every scroll tick.
      state = { ...state, scrollOffset: Math.max(0, offset) };
    },
    setDraftAddress(address: string) {
      if (disposed || resetting) return;
      resetting = true;
      try {
        invalidate();
        lastElection = state.displayed?.election ?? null;
        publish({
          ...state,
          draftAddress: address,
          outcome: null,
          status: state.displayed ? 'success' : 'idle',
          requested: state.displayed?.request ?? null,
        });
      } finally {
        resetting = false;
      }
    },
    retry: () =>
      state.requested && lastElection ? search(state.requested, lastElection) : Promise.resolve(),
    clear,
    dispose() {
      disposed = true;
      clear();
      listeners.clear();
    },
  };
}
export type CandidateFlow = ReturnType<typeof createCandidateFlow>;
