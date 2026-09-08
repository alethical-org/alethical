// @vitest-environment jsdom

import { act, useState, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  (globalThis as { __DEV__?: boolean }).__DEV__ = false;
  process.env.EXPO_PUBLIC_API_URL = 'http://records.test';
  // React only flushes work inside act() when it is told it is under test.
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
vi.mock('../../../providers/AuthProvider', () => ({
  useAuth: () => ({ accessToken: null, user: null, session: null }),
}));

// Two packages ship TypeScript that this runner does not compile, and both are
// only drawing: the icons in the page's chrome, and the navigator the top bar
// asks which address it is on. Neither can change what the page says it found.
vi.mock('react-native-svg', () => {
  const nothing = () => null;
  return {
    default: nothing,
    Svg: nothing,
    Circle: nothing,
    Defs: nothing,
    Ellipse: nothing,
    G: nothing,
    Line: nothing,
    LinearGradient: nothing,
    Path: nothing,
    Polygon: nothing,
    Polyline: nothing,
    Rect: nothing,
    Stop: nothing,
    Text: nothing,
  };
});
// The top bar offers a sign-in dialog it expects an app-wide provider to own.
// Nothing on this page opens it.
vi.mock('../../../providers/signInModalContext', () => ({
  useSignInModal: () => ({ openSignIn: () => {} }),
}));
vi.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: () => {}, push: () => {}, setParams: () => {} }),
  useRoute: () => ({ name: 'MoneySearch', params: {} }),
  useIsFocused: () => true,
}));

import { createAppQueryClient } from '../../../lib/appQueryClient';
import { resetSeededPayloadsForTests } from '../../../lib/pageData';
import { MoneySearchScreen } from '../MoneySearchScreen';

/**
 * What the page says is a claim about the name in its own heading (issue #2020).
 *
 * The heading is drawn from the address, and the rows, the counts and the "no
 * matches" card come from a read. When those two disagree the page states
 * something untrue about a named person: "Results for smith" over a list of
 * education groups. This renders the page for real and reads what is on it.
 */

function answerFor(name: string, results: unknown[]) {
  return {
    data: {
      state: 'reported',
      q: name,
      min_query_length: 3,
      counted_up_to: 200,
      groups: [
        { kind: 'people', state: 'reported', total: 0, results: [] },
        { kind: 'committees', state: 'reported', total: results.length, results },
        { kind: 'payments_received', state: 'reported', total: 0, results: [] },
        { kind: 'payments_made', state: 'reported', total: 0, results: [] },
        { kind: 'independent_spending', state: 'reported', total: 0, results: [] },
      ],
    },
  };
}

const SMITH_ROW = {
  kind: 'committee',
  name: 'Smith for Senate',
  registration_number: '41363',
  filer_kind: 'candidate_committee',
};

/** The page, mounted at one address, with the address changeable afterwards. */
function openSearchPage(firstQuery: string) {
  const host = document.createElement('div');
  document.body.append(host);
  const client = createAppQueryClient();
  let setQuery: ((next: string) => void) | null = null;

  function Host() {
    const [q, set] = useState(firstQuery);
    setQuery = set;
    const navigation = {
      navigate: () => {},
      push: () => {},
      setParams: (next: { q?: string }) => set(next.q ?? ''),
    };
    return (
      <MoneySearchScreen
        // The screen needs only these 3 of navigation's many methods.
        navigation={navigation as never}
        route={{ key: 'money-search', name: 'MoneySearch', params: { q } } as never}
      />
    );
  }

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
    words: () => host.textContent ?? '',
    type: (next: string) => act(() => setQuery?.(next)),
  };
}

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
});

/** Answers each name from `answers`; anything absent never answers at all. */
function serve(answers: Record<string, unknown>) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      const name = new URL(url, 'http://x').searchParams.get('q') ?? '';
      if (!(name in answers)) return new Promise(() => {});
      return new Response(JSON.stringify(answers[name]), {
        headers: { 'content-type': 'application/json' },
      });
    }),
  );
}

describe('the money search page shows only what it found for the name in its heading', () => {
  it('drops the previous name’s rows and counts the moment the name changes', async () => {
    serve({ smith: answerFor('smith', [SMITH_ROW]) });
    const page = openSearchPage('smith');
    await settle();

    expect(page.words()).toContain('Results for “smith”');
    expect(page.words()).toContain('Smith for Senate');

    page.type('jones');
    await settle();

    expect(page.words()).toContain('Results for “jones”');
    expect(page.words()).not.toContain('Smith for Senate');
    expect(page.words()).not.toContain('REG 41363');
    expect(page.words()).toContain('Searching these records');
  });

  it('drops the previous name’s “no matches” card too', async () => {
    serve({ smith: answerFor('smith', []) });
    const page = openSearchPage('smith');
    await settle();
    expect(page.words()).toContain('Nothing is filed under');

    page.type('jones');
    await settle();

    expect(page.words()).not.toContain('Nothing is filed under');
    expect(page.words()).toContain('Searching these records');
  });

  it('says a search failed rather than leaving the last name’s rows up', async () => {
    let answering = true;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        const name = new URL(url, 'http://x').searchParams.get('q') ?? '';
        if (answering && name === 'smith') {
          return new Response(JSON.stringify(answerFor('smith', [SMITH_ROW])), {
            headers: { 'content-type': 'application/json' },
          });
        }
        return new Response('nope', { status: 500 });
      }),
    );
    const page = openSearchPage('smith');
    await settle();
    expect(page.words()).toContain('Smith for Senate');

    answering = false;
    page.type('jones');
    await settle();

    expect(page.words()).toContain('We couldn’t search these records just now');
    expect(page.words()).not.toContain('Smith for Senate');
  });

  it('goes from nothing typed to waiting, never to a stale answer', async () => {
    serve({ smith: answerFor('smith', [SMITH_ROW]) });
    const page = openSearchPage('');
    await settle();
    expect(page.words()).toContain('Type a name');
    expect(page.words()).not.toContain('Smith for Senate');

    page.type('jones');
    await settle();
    expect(page.words()).toContain('Searching these records');
    expect(page.words()).not.toContain('Smith for Senate');
  });

  it('goes back to “type a name” when the box is cleared', async () => {
    serve({ smith: answerFor('smith', [SMITH_ROW]) });
    const page = openSearchPage('smith');
    await settle();
    expect(page.words()).toContain('Smith for Senate');

    page.type('');
    await settle();

    expect(page.words()).toContain('Type a name');
    expect(page.words()).not.toContain('Smith for Senate');
    expect(page.words()).not.toContain('Searching these records');
  });

  it('shows the last name typed, however fast the reader got there', async () => {
    // Only the first name is ever answered, so anything on screen at the end
    // that mentions it came from an answer the reader has moved past.
    serve({ smith: answerFor('smith', [SMITH_ROW]) });
    const page = openSearchPage('smith');
    await settle();
    expect(page.words()).toContain('Smith for Senate');

    page.type('o');
    page.type('ol');
    page.type('olse');
    page.type('olsen');
    await settle();

    expect(page.words()).toContain('Results for “olsen”');
    expect(page.words()).toContain('Searching these records');
    expect(page.words()).not.toContain('Smith for Senate');
  });

  it('still says the search failed rather than searching for ever', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('nope', { status: 500 })),
    );
    const page = openSearchPage('smith');
    await settle();
    await settle();

    expect(page.words()).toContain('We couldn’t search these records just now');
    expect(page.words()).not.toContain('Searching these records');
  });
});
