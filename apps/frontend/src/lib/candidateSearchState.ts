export interface CandidateSearchRequest {
  readonly address: string;
  readonly electionId: string;
}

/** Labels belong to the result, never to a newer selection still loading. */
export interface CandidateSearchResult<T> {
  readonly electionId: string;
  readonly electionLabel: string;
  readonly matchedAddress: string;
  readonly sourceDate: string | null;
  readonly data: T;
}

export interface CandidateSearchDisplay<T> {
  readonly request: CandidateSearchRequest;
  readonly result: CandidateSearchResult<T>;
}

export interface CandidateSearchState<T> {
  readonly status: 'idle' | 'loading' | 'updating' | 'success' | 'error';
  readonly requested: CandidateSearchRequest | null;
  readonly displayed: CandidateSearchDisplay<T> | null;
  readonly error: 'lookup-failed' | null;
}

export type CandidateLookup<T> = (
  request: CandidateSearchRequest,
  signal: AbortSignal,
) => Promise<CandidateSearchResult<T>>;

/**
 * Create once per app/tab flow and keep it above the search/profile screens.
 * No address enters browser history, saved storage, or an account. A reload
 * creates a fresh flow. Clear on a privacy boundary; dispose at the flow's end.
 */
export function createCandidateSearchState<T>(lookup: CandidateLookup<T>) {
  const idle = (): CandidateSearchState<T> =>
    Object.freeze({ status: 'idle', requested: null, displayed: null, error: null });
  let state = idle();
  let handoffAddress: string | null = null;
  let pending: AbortController | null = null;
  let generation = 0;
  let disposed = false;
  let resetting = false;
  const listeners = new Set<() => void>();

  const publish = (next: CandidateSearchState<T>) => {
    state = Object.freeze(next);
    for (const listener of [...listeners]) {
      if (!listeners.has(listener)) continue;
      try {
        listener();
      } catch {
        // A broken screen must not change a lookup outcome or block other screens.
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

  const reset = (address: string | null) => {
    if (resetting) return;
    resetting = true;
    try {
      // Abort and notification callbacks cannot start a search during a reset.
      invalidate();
      handoffAddress = disposed ? null : address;
      publish(idle());
    } finally {
      resetting = false;
    }
  };

  const search = async (input: CandidateSearchRequest): Promise<void> => {
    if (disposed || resetting) return;
    const request = Object.freeze({
      address: input.address.trim(),
      electionId: input.electionId.trim(),
    });
    if (!request.address || !request.electionId) {
      throw new Error('Candidate search requires an address and election.');
    }
    const currentGeneration = invalidate();
    if (disposed || currentGeneration !== generation) return;
    handoffAddress = null;
    const controller = new AbortController();
    pending = controller;
    publish({
      status: state.displayed ? 'updating' : 'loading',
      requested: request,
      displayed: state.displayed,
      error: null,
    });
    try {
      if (disposed || currentGeneration !== generation) return;
      const result = await lookup(request, controller.signal);
      if (disposed || currentGeneration !== generation) return;
      if (result.electionId !== request.electionId || !result.matchedAddress.trim()) {
        throw new Error('Candidate lookup returned an inconsistent result.');
      }
      publish({
        status: 'success',
        requested: request,
        displayed: Object.freeze({ request, result: Object.freeze({ ...result }) }),
        error: null,
      });
    } catch {
      if (disposed || currentGeneration !== generation) return;
      // Do not retain a service's error text; it may contain the street address.
      publish({
        status: 'error',
        requested: request,
        displayed: state.displayed,
        error: 'lookup-failed',
      });
    } finally {
      if (currentGeneration === generation) pending = null;
    }
  };

  return {
    getState: () => state,
    subscribe(listener: () => void): () => void {
      if (disposed) return () => {};
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    search,
    retry(): Promise<void> {
      return state.status === 'error' && state.requested
        ? search(state.requested)
        : Promise.resolve();
    },
    /** Only the next /candidates visit can consume the homepage's typed address. */
    handoffFromHome(address: string): void {
      if (disposed || resetting) return;
      reset(address.trim() || null);
    },
    consumeHomeAddress(): string | null {
      const address = handoffAddress;
      handoffAddress = null;
      return address;
    },
    clear(): void {
      reset(null);
    },
    dispose(): void {
      disposed = true;
      reset(null);
      listeners.clear();
    },
  };
}
