// @vitest-environment jsdom

import { act, useState, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  (globalThis as { __DEV__?: boolean }).__DEV__ = false;
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
const mocks = vi.hoisted(() => ({ send: vi.fn() }));
vi.mock('../../../data/api', () => ({ sendContactMessageFromApi: mocks.send }));
vi.mock('../../../hooks/useResponsive', () => ({
  useResponsive: () => ({ isMobile: false, isTablet: false }),
}));
vi.mock('../../../components/GoBackLink', () => ({ GoBackLink: () => null }));
vi.mock('../../../components/SocialIconLink', () => ({ SocialIconLink: () => null }));
vi.mock('../../../components/billDetail/SharePopover', () => ({ SharePopover: () => null }));
vi.mock('react-native-svg', () => ({ default: () => null, Path: () => null }));
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
const piece = PUBLISHED_PIECE_INDEX[0];

beforeEach(async () => {
  // A fresh module represents a new app instance, with no retained draft.
  vi.resetModules();
  ({ ContactUsScreen } = await import('../ContactUsScreen'));
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  mocks.send.mockReset();
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.restoreAllMocks();
});

async function render(article?: string) {
  const path = article ? `/about/contact?article=${encodeURIComponent(article)}` : '/about/contact';
  const route = stateFromPathname(path)!.routes[1];
  await act(async () => {
    root.render(<ContactUsScreen navigation={{ navigate: vi.fn() } as any} route={route as any} />);
  });
}
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
  const link = articleDisclosureRuns(ARTICLE_AI_NOTE, piece.slug)[1];
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

it('preserves edited and cleared fields through rerenders, changed links, and back navigation', async () => {
  const storage = vi.spyOn(Storage.prototype, 'setItem');
  await render(piece.slug);
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
  await render(piece.slug);
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
  await render(piece.slug);
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

it('prefills an untouched ordinary form when the reader later follows an article link', async () => {
  await render();
  await render(piece.slug);
  expect(field('subject').value).toBe(`Possible correction: ${piece.title}`);
  expect(mocks.send).not.toHaveBeenCalled();
});

it('does not repopulate a form the reader deliberately cleared', async () => {
  await render();
  await type('subject', 'Something');
  await type('subject', '');
  await render(piece.slug);
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
          route={{ params: { article: piece.slug } } as any}
        />
      </>
    ) : (
      <ShortPostArticle piece={fixture} onCorrectionContact={() => setContact(true)} />
    );
  }
  await act(async () => root.render(<Flow />));
  const openCorrection = async () => {
    const anchor = host.querySelector<HTMLAnchorElement>('.sp-disclosures a')!;
    expect(anchor.getAttribute('href')).toBe(`/about/contact?article=${piece.slug}`);
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
