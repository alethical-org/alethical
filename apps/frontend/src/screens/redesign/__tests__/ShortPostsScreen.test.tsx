// @vitest-environment jsdom
import { act, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ShortPostsPreview, TopicPieceCard } from '../../../components/read/TopicPieceCard';
import { ShortPostsScreen } from '../ShortPostsScreen';
import type { ResearchPiece } from '../../../lib/research';
import type { RootScreenProps } from '../../../navigation/types';

const source = vi.hoisted(() => ({ pieces: [] as ResearchPiece[] }));
vi.mock('../../../lib/research', async (original) => ({
  ...(await original<object>()),
  publishedResearch: () => source.pieces,
}));
vi.mock('../../../hooks/useReducedMotion', () => ({ useReducedMotion: () => true }));
vi.mock('../../../hooks/useHistoryScrollRestoration', () => ({
  useHistoryScrollRestoration: () => ({}),
}));
vi.mock('../../../theme/primitives', () => ({
  PageBackground: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  TopNav: () => null,
  Footer: () => null,
}));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;
HTMLElement.prototype.scrollIntoView = vi.fn();
afterEach(() => {
  document.body.replaceChildren();
  source.pieces = [];
});
function example(index: number): ResearchPiece {
  return {
    articleId: `example-${index}`,
    slug: `example-${index}`,
    format: 'short-post',
    traits: { research: true, guide: false },
    topics: ['lobbying'],
    indexed: true,
    title: `Example article ${index}`,
    dek: 'A complete opening explanation that stays visible beside a long title.',
    publishedOn: '2026-09-25',
    publishedAt: `2026-09-25T12:${String(index).padStart(2, '0')}:00Z`,
    recordsThrough: '2025-12-31',
    authorLine: 'Test fixture',
    filingBodies: [],
    shortVersion: [],
    sections: [],
    sources: [],
  };
}
function mount(page = '1') {
  const element = document.createElement('div');
  document.body.append(element);
  const root = createRoot(element);
  const navigate = vi.fn();
  const render = (next = page) =>
    act(() =>
      root.render(
        <ShortPostsScreen
          {...({
            navigation: { navigate },
            route: { key: 'short-posts', name: 'ShortPosts', params: { page: next } },
          } as unknown as RootScreenProps<'ShortPosts'>)}
        />,
      ),
    );
  render();
  return { element, root, navigate, render };
}
describe('Short posts reader paths', () => {
  it('shows the empty archive without promising unpublished articles', () => {
    const { element, root } = mount();
    expect(element.textContent).toContain('No short posts yet.');
    expect(element.querySelector('a')?.getAttribute('href')).toBe('/read');
    expect(element.querySelector('nav')).toBeNull();
    act(() => root.unmount());
  });
  it('gives titles and topics independent anchors and renders the whole opening', () => {
    source.pieces = [example(1)];
    const { element, root, navigate } = mount();
    expect(element.querySelector('a a')).toBeNull();
    expect(element.querySelector('[data-entry-link]')?.getAttribute('href')).toBe(
      '/read/research/example-1',
    );
    const topic = element.querySelector<HTMLAnchorElement>('.topic-piece-topics a')!;
    expect(topic.getAttribute('href')).toBe('/read/topics/lobbying');
    act(() => topic.click());
    expect(navigate).toHaveBeenCalledExactlyOnceWith('ReadTopic', { topic: 'lobbying' });
    expect(element.querySelector('.topic-piece-dek')?.textContent).toBe(source.pieces[0].dek);
    act(() => root.unmount());
  });
  it('keeps 6 entries on numbered URLs and changes results without a loading flash', () => {
    source.pieces = Array.from({ length: 7 }, (_, index) => example(index));
    const { element, root, navigate, render } = mount();
    expect(element.querySelectorAll('[data-entry]')).toHaveLength(6);
    const next = element.querySelector<HTMLAnchorElement>('a[aria-label="Page 2"]')!;
    expect(next.getAttribute('href')).toBe('/read/short-posts?page=2');
    act(() => next.click());
    expect(navigate).toHaveBeenCalledWith('ShortPosts', { page: '2' });
    render('2');
    expect(element.querySelectorAll('[data-entry]')).toHaveLength(1);
    expect(element.querySelector('[data-entry]')?.getAttribute('data-entry')).toBe('example-0');
    expect(element.querySelector('[aria-current="page"]')?.textContent).toBe('2');
    expect(document.activeElement?.tagName).toBe('H1');
    expect(HTMLElement.prototype.scrollIntoView).toHaveBeenCalledWith({
      block: 'start',
      behavior: 'instant',
    });
    render('1');
    expect(element.querySelectorAll('[data-entry]')).toHaveLength(6);
    act(() => root.unmount());
  });
});

describe('Short post context links', () => {
  it('names only other topics on a topic destination', () => {
    const piece = example(1);
    piece.topics = ['lobbying', 'elections'];
    const element = document.createElement('div');
    document.body.append(element);
    const root = createRoot(element);
    act(() => root.render(<TopicPieceCard piece={piece} currentTopic="lobbying" />));
    expect(element.querySelector('ul')?.getAttribute('aria-label')).toBe('Other topics');
    expect(element.querySelectorAll('.topic-piece-topics a')).toHaveLength(1);
    expect(element.querySelector('.topic-piece-topics a')?.getAttribute('href')).toBe(
      '/read/topics/elections',
    );
    act(() => root.unmount());
  });
  it('keeps 3 read-preview rows in one box with separate title and topic links', () => {
    const element = document.createElement('div');
    document.body.append(element);
    const root = createRoot(element);
    const onAll = vi.fn();
    act(() =>
      root.render(
        <ShortPostsPreview
          pieces={[example(1), example(2), example(3)]}
          onOpen={vi.fn()}
          onTopic={vi.fn()}
          onAll={onAll}
        />,
      ),
    );
    expect(element.querySelectorAll('.short-posts-preview')).toHaveLength(1);
    expect(element.querySelectorAll('.topic-piece-row')).toHaveLength(3);
    expect(element.querySelectorAll('.topic-piece-kind')).toHaveLength(3);
    expect(element.querySelector('a a')).toBeNull();
    act(() => element.querySelector<HTMLAnchorElement>('.short-posts-preview-all a')!.click());
    expect(onAll).toHaveBeenCalledOnce();
    act(() => root.unmount());
  });
});

it('does not steal focus after a reader moves away from pagination', () => {
  source.pieces = Array.from({ length: 7 }, (_, index) => example(index));
  const { element, root, render } = mount();
  act(() => element.querySelector<HTMLAnchorElement>('a[aria-label="Page 2"]')!.click());
  const input = document.createElement('input');
  document.body.append(input);
  input.focus();
  render('2');
  expect(document.activeElement).toBe(input);
  act(() => root.unmount());
});
