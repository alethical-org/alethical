// @vitest-environment jsdom

import { act, useState, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';

// The hooks file reaches the sign-in provider, which loads Expo's native browser
// module at import time and cannot run in Node. This read is never signed in.
// `__DEV__` is a build-time constant Metro supplies and Node does not.
vi.hoisted(() => {
  (globalThis as { __DEV__?: boolean }).__DEV__ = false;
  // The data layer reads its origin once, at import. Without one it refuses to
  // build a URL and every read here would fail for the wrong reason.
  process.env.EXPO_PUBLIC_API_URL = 'http://records.test';
  // React only flushes work inside act() when it is told it is under test.
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
vi.mock('../../providers/AuthProvider', () => ({
  useAuth: () => ({ accessToken: null, user: null, session: null }),
}));

import { createAppQueryClient } from '../../lib/appQueryClient';
import { resetSeededPayloadsForTests } from '../../lib/pageData';
import { useCampaignFinanceNameSearch } from '../useAppQueries';

/**
 * The money name search answers the name in the heading, or nothing at all
 * (issue #2020).
 *
 * The page prints the typed name in its own heading and every count, row and
 * "no matches" card under it is a claim about that name. So the one thing this
 * read may never do is hand back an answer to a name the reader has moved on
 * from. Three ways that can happen, one test each: an answer kept across the
 * change, an older request finishing after a newer one, and a request nobody is
 * waiting for still being on the wire.
 */

/** A served answer with 1 committee row, so a wrong answer is recognisable. */
function answerFor(name: string) {
  return {
    data: {
      state: 'reported',
      q: name,
      min_query_length: 3,
      counted_up_to: 200,
      groups: [
        {
          kind: 'committees',
          state: 'reported',
          total: 1,
          results: [
            {
              kind: 'committee',
              name: `${name} for Senate`,
              registration_number: '41363',
              filer_kind: 'candidate_committee',
            },
          ],
        },
      ],
    },
  };
}

/** One mounted probe whose query can be changed, recording every render pass. */
function mountSearch(firstQuery: string) {
  const passes: { isPending: boolean; data: unknown }[] = [];
  let setQuery: ((next: string) => void) | null = null;

  function Probe({ query }: { query: string }) {
    const read = useCampaignFinanceNameSearch(query);
    passes.push({ isPending: read.isPending, data: read.data });
    return null;
  }

  function Host() {
    const [query, set] = useState(firstQuery);
    setQuery = set;
    return <Probe query={query} />;
  }

  const host = document.createElement('div');
  document.body.append(host);
  const client = createAppQueryClient();
  act(() => {
    createRoot(host).render(
      (
        <QueryClientProvider client={client}>
          <Host />
        </QueryClientProvider>
      ) as ReactNode,
    );
  });

  return {
    passes,
    type: (next: string) => act(() => setQuery?.(next)),
    latest: () => passes[passes.length - 1],
  };
}

/** Let every already-resolved promise settle and React draw what came of it. */
/** Let the answers already in hand settle, and React draw what came of them. */
async function settle() {
  for (let pass = 0; pass < 4; pass += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

afterEach(() => {
  document.body.innerHTML = '';
  resetSeededPayloadsForTests();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('the money name search answers only the name the reader typed', () => {
  it('holds no answer at all while the answer to a changed name is on its way', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        const name = new URL(url, 'http://x').searchParams.get('q') ?? '';
        // Only the first name is ever answered, so a kept answer is the only
        // thing that could put rows on screen after the change.
        if (name !== 'smith') return new Promise(() => {});
        return new Response(JSON.stringify(answerFor('smith')), {
          headers: { 'content-type': 'application/json' },
        });
      }),
    );

    const search = mountSearch('smith');
    await settle();
    expect(search.latest().data).toMatchObject({ query: 'smith' });

    search.type('jones');
    await settle();

    // Nothing about smith may survive into the answer drawn under "jones".
    expect(search.latest().data).toBeUndefined();
    expect(search.latest().isPending).toBe(true);
    expect(JSON.stringify(search.passes.slice(-1))).not.toContain('smith');
  });

  it('keeps the newer answer when an older request finishes after it', async () => {
    const finish: Record<string, (payload: unknown) => void> = {};
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        const name = new URL(url, 'http://x').searchParams.get('q') ?? '';
        return new Promise<Response>((resolve) => {
          finish[name] = (payload) =>
            resolve(
              new Response(JSON.stringify(payload), {
                headers: { 'content-type': 'application/json' },
              }),
            );
        });
      }),
    );

    const search = mountSearch('smith');
    await settle();
    search.type('jones');
    await settle();

    // The reader is waiting on "jones". It answers first, then the abandoned
    // "smith" request finally answers.
    finish.jones?.(answerFor('jones'));
    await settle();
    expect(search.latest().data).toMatchObject({ query: 'jones' });

    finish.smith?.(answerFor('smith'));
    await settle();

    expect(search.latest().data).toMatchObject({ query: 'jones' });
    expect(JSON.stringify(search.latest().data)).not.toContain('smith');
  });

  it('drops the abandoned request at the socket instead of leaving it running', async () => {
    const signals: Record<string, AbortSignal | undefined> = {};
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        const name = new URL(url, 'http://x').searchParams.get('q') ?? '';
        signals[name] = init?.signal ?? undefined;
        return new Promise(() => {});
      }),
    );

    const search = mountSearch('smith');
    await settle();
    expect(signals.smith?.aborted).toBe(false);

    search.type('jones');
    await settle();

    expect(signals.smith?.aborted).toBe(true);
    expect(signals.jones?.aborted).toBe(false);
  });
});
