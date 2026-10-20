// @vitest-environment jsdom

import { act, useState, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  (globalThis as { __DEV__?: boolean }).__DEV__ = false;
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
const mocks = vi.hoisted(() => ({
  send: vi.fn(),
  auth: {
    isLoading: false,
    isSignedIn: false,
    user: null as null | { id: string; email: string },
  },
}));
vi.mock('../../../data/api', () => ({ sendContactMessageFromApi: mocks.send }));
vi.mock('../../../providers/AuthProvider', () => ({ useAuth: () => mocks.auth }));
vi.mock('../../../hooks/useResponsive', () => ({
  useResponsive: () => ({ isMobile: false, isTablet: false }),
}));
vi.mock('../../../components/GoBackLink', () => ({ GoBackLink: () => null }));
vi.mock('../../../components/SocialIconLink', () => ({ SocialIconLink: () => null }));
vi.mock('../../../components/billDetail/SharePopover', () => ({ SharePopover: () => null }));
vi.mock('react-native-svg', () => ({
  default: () => null,
  Path: () => null,
  Circle: () => null,
  Polygon: () => null,
}));
vi.mock('../../../theme/primitives', async () => {
  const { View } = await import('react-native');
  return {
    PageBackground: ({ children }: { children: ReactNode }) => <View>{children}</View>,
    Container: ({ children }: { children: ReactNode }) => <View>{children}</View>,
    TopNav: () => null,
    Footer: () => null,
  };
});

import { PUBLISHED_PIECE_INDEX, piecePath } from '../../../lib/researchIndex';
import { ShortPostArticle } from '../../../components/shortPosts/ShortPostArticle';
import type { ResearchPiece } from '../../../lib/research';
import { stateFromPathname } from '../../../navigation/webRoutes';
import { articleDisclosureRuns, ARTICLE_AI_NOTE } from '../../../lib/articleDisclosure';

let host: HTMLElement;
let root: Root;
let ContactUsScreen: (typeof import('../ContactUsScreen'))['ContactUsScreen'];
const piece = PUBLISHED_PIECE_INDEX.find(
  (entry) => entry.articleId === 'short-records-not-donations-2023',
)!;
const articleIdentity = piece.articleId!;

beforeEach(async () => {
  // A fresh module represents a new app instance, with no retained draft.
  vi.resetModules();
  ({ ContactUsScreen } = await import('../ContactUsScreen'));
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  mocks.send.mockReset();
  mocks.auth.isLoading = false;
  mocks.auth.isSignedIn = false;
  mocks.auth.user = null;
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.restoreAllMocks();
});

async function render(article?: string, purpose?: string) {
  const path = purpose
    ? `/about/contact?purpose=${encodeURIComponent(purpose)}`
    : article
      ? `/about/contact?article=${encodeURIComponent(article)}`
      : '/about/contact';
  const route = stateFromPathname(path)!.routes[1];
  await act(async () => {
    root.render(<ContactUsScreen navigation={{ navigate: vi.fn() } as any} route={route as any} />);
  });
}

it('opens the replay hosting destination with signed-in email and editable local copy', async () => {
  const { EVENTS } = await import('../../../lib/events');
  const { renderEventArticle } = await import('../../../lib/eventArticle');
  const article = document.createElement('div');
  article.innerHTML = renderEventArticle(EVENTS[0]);
  const href = article.querySelector<HTMLAnchorElement>('.replay-contact')!.href;
  const destination = new URL(href);
  expect(destination.pathname + destination.search).toBe('/about/contact?purpose=host-debate');
  mocks.auth.isSignedIn = true;
  mocks.auth.user = { id: 'host-a', email: 'host-a@example.test' };
  await render(undefined, destination.searchParams.get('purpose')!);
  expect(field('email').value).toBe('host-a@example.test');
  expect(field('name').value).toBe('');
  expect(field('phone').value).toBe('');
  expect(field('subject').value).toBe('Host a debate');
  expect(field('message').value).toBe(
    'I’d like Alethical to host a debate in my community.\n\nCommunity:\n',
  );
  await type('email', '');
  await type('subject', '');
  await type('message', 'My retained community request');
  await act(async () => root.render(<div>Another screen</div>));
  mocks.auth.user = { id: 'host-a', email: 'host-a@example.test' };
  await render(undefined, 'host-debate');
  expect(field('email').value).toBe('');
  expect(field('subject').value).toBe('');
  expect(field('message').value).toBe('My retained community request');
  expect(mocks.send).not.toHaveBeenCalled();
});

it('clears the prior account hosting draft on confirmed account changes', async () => {
  mocks.auth.isLoading = true;
  await render(undefined, 'host-debate');
  expect(field('email').value).toBe('');
  mocks.auth.isLoading = false;
  mocks.auth.isSignedIn = true;
  mocks.auth.user = { id: 'host-a', email: 'host-a@example.test' };
  await render(undefined, 'host-debate');
  expect(field('email').value).toBe('host-a@example.test');
  mocks.auth.user = { id: 'host-b', email: 'host-b@example.test' };
  await render(undefined, 'host-debate');
  expect(field('email').value).toBe('host-b@example.test');
  mocks.auth.isSignedIn = false;
  mocks.auth.user = null;
  await render(undefined, 'host-debate');
  expect(field('email').value).toBe('');
  expect(field('subject').value).toBe('');
  expect(mocks.send).not.toHaveBeenCalled();
});
function field(name: string) {
  return host.querySelector<HTMLInputElement | HTMLTextAreaElement>(`[name="${name}"]`)!;
}
async function type(name: string, value: string) {
  await act(async () => {
    const input = field(name);
    const prototype =
      name === 'message' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
function button(label: string) {
  const match = [...host.querySelectorAll<HTMLElement>('[role="button"],button')].find(
    (node) => node.textContent === label,
  );
  expect(match).toBeDefined();
  return match!;
}
async function click(label: string) {
  await act(async () => button(label).click());
}

it('opens the shared article correction link with editable known text and no send', async () => {
  const link = articleDisclosureRuns(ARTICLE_AI_NOTE, articleIdentity)[1];
  expect(link.kind).toBe('internalLink');
  const route = stateFromPathname((link as { href: string }).href)!.routes[1];
  await act(async () => {
    root.render(<ContactUsScreen navigation={{ navigate: vi.fn() } as any} route={route as any} />);
  });
  expect(field('subject').value).toBe(`Possible correction: ${piece.title}`);
  expect(field('message').value).toBe(
    `I’d like to report a possible error in this article:\nhttps://alethical.com${piecePath(piece)}\n\nWhat may be wrong:\n`,
  );
  for (const name of ['name', 'email', 'phone']) expect(field(name).value).toBe('');
  await type('subject', 'My subject');
  await type('message', 'My message');
  expect(field('subject').value).toBe('My subject');
  expect(field('message').value).toBe('My message');
  expect(mocks.send).not.toHaveBeenCalled();
});

it.each([undefined, 'unknown-draft', 'http://127.0.0.1:8766/'])(
  'opens a blank ordinary or unknown article form: %s',
  async (article) => {
    await render(article);
    for (const name of ['name', 'email', 'phone', 'subject', 'message'])
      expect(field(name).value).toBe('');
    expect(mocks.send).not.toHaveBeenCalled();
  },
);

it('fills the signed-in account email on ordinary and article entries while keeping article text separate', async () => {
  mocks.auth.isSignedIn = true;
  mocks.auth.user = { id: 'account-a', email: 'account-a@example.test' };
  await render();
  expect(field('email').value).toBe('account-a@example.test');
  expect(field('subject').value).toBe('');
  expect(field('message').value).toBe('');
  await type('email', 'reader-chose@example.test');

  await render(articleIdentity);
  expect(field('email').value).toBe('reader-chose@example.test');
  expect(field('subject').value).toBe(`Possible correction: ${piece.title}`);
  expect(field('message').value).toContain(`https://alethical.com${piecePath(piece)}`);
  expect(field('name').value).toBe('');
  expect(field('phone').value).toBe('');
});

it('fills an untouched email after delayed account loading', async () => {
  mocks.auth.isLoading = true;
  await render();
  expect(field('email').value).toBe('');

  mocks.auth.isLoading = false;
  mocks.auth.isSignedIn = true;
  mocks.auth.user = { id: 'account-a', email: 'account-a@example.test' };
  await render();
  expect(field('email').value).toBe('account-a@example.test');
});

it('removes an old missing-email message when delayed sign-in fills the email', async () => {
  mocks.auth.isLoading = true;
  await render();
  await click('Send message');
  expect(host.textContent).toContain('Enter an email address so we can reply');
  expect(field('email').getAttribute('aria-invalid')).toBe('true');

  mocks.auth.isLoading = false;
  mocks.auth.isSignedIn = true;
  mocks.auth.user = { id: 'account-a', email: 'account-a@example.test' };
  await render();
  expect(field('email').value).toBe('account-a@example.test');
  expect(host.textContent).not.toContain('Enter an email address so we can reply');
  expect(field('email').getAttribute('aria-invalid')).toBe('false');
});

it('keeps an email typed or cleared before delayed account loading', async () => {
  mocks.auth.isLoading = true;
  await render();
  await type('email', 'reader@example.test');
  await type('email', '');

  mocks.auth.isLoading = false;
  mocks.auth.isSignedIn = true;
  mocks.auth.user = { id: 'account-a', email: 'account-a@example.test' };
  await render();
  expect(field('email').value).toBe('');
});

it('replaces account defaults and clears a typed email on confirmed sign-out', async () => {
  mocks.auth.isSignedIn = true;
  mocks.auth.user = { id: 'account-a', email: 'account-a@example.test' };
  await render();
  expect(field('email').value).toBe('account-a@example.test');

  mocks.auth.user = { id: 'account-b', email: 'account-b@example.test' };
  await render();
  expect(field('email').value).toBe('account-b@example.test');

  mocks.auth.isSignedIn = false;
  mocks.auth.user = null;
  await render();
  expect(field('email').value).toBe('');

  mocks.auth.isSignedIn = true;
  mocks.auth.user = { id: 'account-a', email: 'account-a@example.test' };
  await render();
  await type('email', 'reader-chose@example.test');
  mocks.auth.isSignedIn = false;
  mocks.auth.user = null;
  await render();
  expect(field('email').value).toBe('');
});

it('reconciles a retained automatic email before a reopened form is shown', async () => {
  mocks.auth.isSignedIn = true;
  mocks.auth.user = { id: 'account-a', email: 'account-a@example.test' };
  await render();
  expect(field('email').value).toBe('account-a@example.test');

  act(() => root.unmount());
  root = createRoot(host);
  mocks.auth.isSignedIn = false;
  mocks.auth.user = null;
  await render();
  expect(field('email').value).toBe('');

  act(() => root.unmount());
  root = createRoot(host);
  mocks.auth.isSignedIn = true;
  mocks.auth.user = { id: 'account-b', email: 'account-b@example.test' };
  await render();
  expect(field('email').value).toBe('account-b@example.test');
});

it('does not treat an automatically filled email as unfinished reader work', async () => {
  const addEventListener = vi.spyOn(window, 'addEventListener');
  mocks.auth.isSignedIn = true;
  mocks.auth.user = { id: 'account-a', email: 'account-a@example.test' };
  await render();
  expect(addEventListener.mock.calls.some(([event]) => event === 'beforeunload')).toBe(false);

  await type('subject', 'A question');
  expect(addEventListener.mock.calls.some(([event]) => event === 'beforeunload')).toBe(true);
});

it('preserves edited and cleared fields through rerenders, changed links, and back navigation', async () => {
  const storage = vi.spyOn(Storage.prototype, 'setItem');
  await render(articleIdentity);
  await type('email', 'reader@example.com');
  await type('message', 'This is what I found');
  await type('subject', '');
  await render(PUBLISHED_PIECE_INDEX[1].slug);
  expect(field('subject').value).toBe('');
  expect(field('message').value).toBe('This is what I found');
  act(() => root.unmount());
  root = createRoot(host);
  await render();
  expect(field('subject').value).toBe('');
  expect(field('message').value).toBe('This is what I found');
  expect(field('email').value).toBe('reader@example.com');
  expect(storage).not.toHaveBeenCalled();
  expect(mocks.send).not.toHaveBeenCalled();
});

it('requires a deliberate send and keeps the same draft and request identity after a failed send and back', async () => {
  mocks.send.mockRejectedValueOnce(new Error('Email disabled')).mockResolvedValueOnce({});
  await render(articleIdentity);
  await click('Send message');
  expect(mocks.send).not.toHaveBeenCalled();
  expect(host.textContent).toContain('Enter an email address so we can reply');
  await type('email', 'reader@example.com');
  await type('message', 'Please check the source link.');
  await click('Send message');
  expect(mocks.send).toHaveBeenCalledTimes(1);
  expect(host.textContent).toContain("Couldn't send.");
  expect(field('message').value).toBe('Please check the source link.');
  const first = mocks.send.mock.calls[0][0];
  act(() => root.unmount());
  root = createRoot(host);
  await render(PUBLISHED_PIECE_INDEX[1].slug);
  expect(field('subject').value).toBe(`Possible correction: ${piece.title}`);
  await click('Send message');
  expect(mocks.send).toHaveBeenCalledTimes(2);
  expect(mocks.send.mock.calls[1][0]).toEqual(first);
  expect(host.textContent).toContain('Message sent');
  await click('Send another message');
  for (const name of ['name', 'email', 'phone', 'subject', 'message'])
    expect(field(name).value).toBe('');
});

it('keeps pending send state across navigation and accepts its result without a second request', async () => {
  let finish!: () => void;
  mocks.send.mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  await render(articleIdentity);
  await type('email', 'reader@example.com');
  await click('Send message');
  expect(mocks.send).toHaveBeenCalledTimes(1);
  expect(field('message').disabled).toBe(true);
  act(() => root.unmount());
  root = createRoot(host);
  await render();
  expect(field('message').disabled).toBe(true);
  await act(async () => {
    finish();
  });
  expect(host.textContent).toContain('Message sent');
  expect(mocks.send).toHaveBeenCalledTimes(1);
  act(() => root.unmount());
  root = createRoot(host);
  await render();
  expect(field('message').value).toBe('');
});

it('starts another message with the current account email after a successful send', async () => {
  mocks.auth.isSignedIn = true;
  mocks.auth.user = { id: 'account-a', email: 'account-a@example.test' };
  mocks.send.mockResolvedValueOnce({});
  await render(articleIdentity);
  await click('Send message');
  expect(host.textContent).toContain('Message sent');

  mocks.auth.user = { id: 'account-a', email: 'account-a@example.test' };
  await render(articleIdentity);
  await click('Send another message');
  expect(field('email').value).toBe('account-a@example.test');
  expect(field('subject').value).toBe('');
  expect(field('message').value).toBe('');
});

it('prefills an untouched ordinary form when the reader later follows an article link', async () => {
  await render();
  await render(articleIdentity);
  expect(field('subject').value).toBe(`Possible correction: ${piece.title}`);
  expect(mocks.send).not.toHaveBeenCalled();
});

it('does not repopulate a form the reader deliberately cleared', async () => {
  await render();
  await type('subject', 'Something');
  await type('subject', '');
  await render(articleIdentity);
  expect(field('subject').value).toBe('');
  expect(field('message').value).toBe('');
  expect(mocks.send).not.toHaveBeenCalled();
});

it('navigates from the actual correction anchor without reload and preserves edits when reopened', async () => {
  const fixture = {
    ...piece,
    format: 'short-post',
    shortVersion: [],
    sections: [],
    sources: [],
    shortPost: {
      origin: 'social-adaptation',
      body: [],
      graphics: [],
      charts: [],
      evidence: [],
      claims: [],
      history: [],
      relatedSlugs: [],
      coverageNote: '',
      limitations: '',
      disclosures: [ARTICLE_AI_NOTE],
    },
  } as unknown as ResearchPiece;
  function Flow() {
    const [contact, setContact] = useState(false);
    return contact ? (
      <>
        <button onClick={() => setContact(false)}>Back to article</button>
        <ContactUsScreen
          navigation={{ navigate: vi.fn() } as any}
          route={{ params: { article: articleIdentity } } as any}
        />
      </>
    ) : (
      <ShortPostArticle piece={fixture} onCorrectionContact={() => setContact(true)} />
    );
  }
  await act(async () => root.render(<Flow />));
  const openCorrection = async () => {
    const anchor = host.querySelector<HTMLAnchorElement>('.sp-disclosures a')!;
    expect(anchor.getAttribute('href')).toBe(`/about/contact?article=${articleIdentity}`);
    const event = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 });
    await act(async () => {
      anchor.dispatchEvent(event);
    });
    expect(event.defaultPrevented).toBe(true);
  };
  await openCorrection();
  await type('subject', 'My retained subject');
  await type('message', 'My retained explanation');
  await click('Back to article');
  await openCorrection();
  expect(field('subject').value).toBe('My retained subject');
  expect(field('message').value).toBe('My retained explanation');
  expect(mocks.send).not.toHaveBeenCalled();
});

async function boundaryRenderer() {
  const { useContactDraftAccountBoundary } =
    await import('../../../hooks/useContactDraftAccountBoundary');
  function AppBoundary({ show }: { show: boolean }) {
    useContactDraftAccountBoundary();
    return show ? (
      <ContactUsScreen
        navigation={{ navigate: vi.fn() } as any}
        route={{ key: 'contact', name: 'ContactUs' } as any}
      />
    ) : (
      <div>Another screen</div>
    );
  }
  return async (show = true) => act(async () => root.render(<AppBoundary show={show} />));
}

it('clears all edited fields across sign-out and back to the same account while the form is closed', async () => {
  const show = await boundaryRenderer();
  mocks.auth.isSignedIn = true;
  mocks.auth.user = { id: 'account-a', email: 'a@example.test' };
  await show();
  for (const name of ['name', 'email', 'phone', 'subject', 'message'])
    await type(name, `private-${name}`);
  await show(false);
  // Loading and a failed sign-out with the same confirmed identity preserve the draft.
  mocks.auth.isLoading = true;
  await show(false);
  mocks.auth.isLoading = false;
  await show();
  expect(field('message').value).toBe('private-message');
  await show(false);
  mocks.auth.isSignedIn = false;
  mocks.auth.user = null;
  await show(false);
  mocks.auth.isSignedIn = true;
  mocks.auth.user = { id: 'account-a', email: 'a@example.test' };
  await show(false);
  await show();
  for (const name of ['name', 'phone', 'subject', 'message']) expect(field(name).value).toBe('');
  expect(field('email').value).toBe('a@example.test');
  expect(mocks.send).not.toHaveBeenCalled();
});

it.each(['success', 'failure'])(
  'ignores an old account send %s after the new account starts its own request',
  async (outcome) => {
    const show = await boundaryRenderer();
    let finishOld!: () => void;
    let finishNew!: () => void;
    mocks.send.mockImplementationOnce(
      () =>
        new Promise((resolve, reject) => {
          finishOld = () =>
            outcome === 'success' ? resolve({}) : reject(new Error('old account failure'));
        }),
    );
    mocks.send.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishNew = () => resolve({});
        }),
    );
    mocks.auth.isSignedIn = true;
    mocks.auth.user = { id: 'account-a', email: 'a@example.test' };
    await show();
    await type('subject', 'A private subject');
    await type('message', 'A private message');
    await click('Send message');
    await show(false);
    mocks.auth.user = { id: 'account-b', email: 'b@example.test' };
    await show(false);
    await show();
    expect(field('email').value).toBe('b@example.test');
    expect(field('message').value).toBe('');
    await type('subject', 'B subject');
    await type('message', 'B message');
    await click('Send message');
    expect(mocks.send).toHaveBeenCalledTimes(2);
    expect(mocks.send.mock.calls[0][0].requestId).not.toBe(mocks.send.mock.calls[1][0].requestId);
    await act(async () => finishOld());
    expect(host.textContent).not.toContain('Message sent');
    expect(field('message').value).toBe('B message');
    expect(button('Sending…').getAttribute('disabled')).not.toBeNull();
    await act(async () => finishNew());
    expect(host.textContent).toContain('Message sent');
  },
);

it.each(['success', 'failure'])(
  'finishes a send after same-account email refresh: %s',
  async (outcome) => {
    let finish!: () => void;
    mocks.send.mockImplementationOnce(
      () =>
        new Promise((resolve, reject) => {
          finish = () =>
            outcome === 'success' ? resolve({}) : reject(new Error('delivery failed'));
        }),
    );
    mocks.auth.isSignedIn = true;
    mocks.auth.user = { id: 'account-a', email: 'old@example.test' };
    await render();
    await type('subject', 'My subject');
    await type('message', 'My message');
    await click('Send message');
    const firstRequest = mocks.send.mock.calls[0][0];
    mocks.auth.user = { id: 'account-a', email: 'new@example.test' };
    await render();
    await act(async () => finish());
    if (outcome === 'success') {
      expect(host.textContent).toContain('Message sent');
    } else {
      expect(field('email').value).toBe('new@example.test');
      expect(button('Send message').getAttribute('disabled')).toBeNull();
      mocks.send.mockResolvedValueOnce({});
      await click('Send message');
      expect(mocks.send.mock.calls[1][0].email).toBe('new@example.test');
      expect(mocks.send.mock.calls[1][0].requestId).not.toBe(firstRequest.requestId);
      expect(host.textContent).toContain('Message sent');
    }
  },
);
