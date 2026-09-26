import { useEffect, useRef, type MouseEvent } from 'react';
import { ScrollView } from 'react-native';
import { TopicPieceCard } from '../../components/read/TopicPieceCard';
import { useReducedMotion } from '../../hooks/useReducedMotion';
import { useHistoryScrollRestoration } from '../../hooks/useHistoryScrollRestoration';
import { publishedResearch, type ResearchPiece } from '../../lib/research';
import { TOPICS } from '../../lib/researchIndex';
import { shortPostsPage, topicPage, type PiecePage } from '../../lib/shortPostSelection';
import type { RootScreenProps } from '../../navigation/types';
import { Footer, PageBackground, TopNav } from '../../theme/primitives';

type Props = RootScreenProps<'ShortPosts'> | RootScreenProps<'ReadTopic'>;

/** All records are in this release's registry: changing a page is synchronous. */
export function ShortPostsScreen({ navigation, route }: Props) {
  const restoration = useHistoryScrollRestoration();
  const topic =
    route.name === 'ReadTopic'
      ? TOPICS.find((item) => item.slug === route.params.topic)
      : undefined;
  const page = Number(route.params?.page ?? 1);
  const pieces = publishedResearch();
  const selection = (
    topic ? topicPage(topic.slug, page, pieces) : shortPostsPage(page, pieces)
  ) as PiecePage<ResearchPiece>;
  const title = topic?.label ?? 'Short posts';
  const basePath = topic ? `/read/topics/${topic.slug}` : '/read/short-posts';
  const heading = useRef<HTMLHeadingElement>(null);
  const reducedMotion = useReducedMotion();
  const requestedPage = useRef<{ page: number; control: HTMLAnchorElement } | undefined>(undefined);
  const returnPost = route.name === 'ShortPosts' ? route.params?.post : undefined;
  const returnToPost = useRef(returnPost);
  const navigatePage = (event: MouseEvent<HTMLAnchorElement>, next: number) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)
      return;
    event.preventDefault();
    if (next === page) return;
    requestedPage.current = { page: next, control: event.currentTarget };
    if (topic) navigation.navigate('ReadTopic', { topic: topic.slug, page: String(next) });
    else navigation.navigate('ShortPosts', { page: String(next) });
  };
  useEffect(() => {
    const request = requestedPage.current;
    if (!request || request.page !== page) return;
    requestedPage.current = undefined;
    if (document.activeElement !== request.control && document.activeElement !== document.body)
      return;
    heading.current?.scrollIntoView({
      block: 'start',
      behavior: reducedMotion ? 'instant' : 'smooth',
    });
    heading.current?.focus({ preventScroll: true });
  }, [page, reducedMotion]);
  useEffect(() => {
    if (!returnToPost.current) return;
    const link = Array.from(document.querySelectorAll<HTMLAnchorElement>('[data-entry-link]')).find(
      (entry) => entry.dataset.entryLink === returnToPost.current,
    );
    if (!link) return;
    link.scrollIntoView({ block: 'center' });
    link.focus({ preventScroll: true });
    returnToPost.current = undefined;
  }, [page, returnPost]);
  const pageLink = (number: number, label: string, current = false) => (
    <a
      key={label}
      href={`${basePath}?page=${number}`}
      aria-current={current ? 'page' : undefined}
      aria-label={/^\d+$/.test(label) ? `Page ${number}` : undefined}
      onClick={(event) => navigatePage(event, number)}
    >
      {label}
    </a>
  );

  return (
    <PageBackground>
      <ScrollView {...restoration} contentContainerStyle={{ flexGrow: 1 }}>
        <TopNav onHome={() => navigation.navigate('Tabs', { screen: 'Home' })} />
        <main className="sp-collection">
          <style>{collectionCss}</style>
          <div className="sp-collection-column">
            {topic && (
              <>
                <a className="sp-collection-back" href="/read">
                  ‹ Back to Read
                </a>
                <div className="sp-collection-label">Topics</div>
              </>
            )}
            <h1 ref={heading} tabIndex={-1}>
              {title}
            </h1>
            {selection.total === 0 ? (
              <div className="sp-collection-empty">
                <p>{topic ? 'No articles about this topic yet.' : 'No short posts yet.'}</p>
                <a href="/read">‹ Back to Read</a>
              </div>
            ) : (
              <>
                <ol className="sp-collection-list" aria-label={title}>
                  {selection.items.map((piece) => (
                    <li key={piece.articleId ?? piece.slug}>
                      <TopicPieceCard
                        piece={piece}
                        headingLevel={2}
                        currentTopic={topic?.slug}
                        onOpen={() =>
                          navigation.navigate(piece.traits.research ? 'Research' : 'Guide', {
                            slug: piece.slug,
                          })
                        }
                        onTopic={(slug) => navigation.navigate('ReadTopic', { topic: slug })}
                      />
                    </li>
                  ))}
                </ol>
                <div className="sp-collection-status" role="status" aria-live="polite" />
                {selection.pageCount > 1 && (
                  <nav className="sp-collection-pages" aria-label={`${title} pages`}>
                    {page > 1 ? (
                      pageLink(page - 1, '‹ Previous')
                    ) : (
                      <span aria-disabled="true">‹ Previous</span>
                    )}
                    {Array.from({ length: selection.pageCount }, (_, index) =>
                      pageLink(index + 1, String(index + 1), page === index + 1),
                    )}
                    {page < selection.pageCount ? (
                      pageLink(page + 1, 'Next ›')
                    ) : (
                      <span aria-disabled="true">Next ›</span>
                    )}
                  </nav>
                )}
              </>
            )}
          </div>
        </main>
        <Footer
          onContact={() => navigation.navigate('ContactUs')}
          onPrivacy={() => navigation.navigate('Privacy')}
          onTerms={() => navigation.navigate('Terms')}
        />
      </ScrollView>
    </PageBackground>
  );
}

const collectionCss = `
.sp-collection{padding:48px 56px 80px;font-family:'Libre Franklin',sans-serif;color:#11150f;flex:1}.sp-collection-column{max-width:1000px}.sp-collection h1{margin:0;font-size:44px;line-height:1.08;font-weight:800;letter-spacing:-.03em;text-wrap:pretty;scroll-margin-top:24px}.sp-collection h1:focus{outline:none}.sp-collection-back{display:inline-flex;min-height:44px;align-items:center;color:#4b524b;font-size:16px;font-weight:600;text-decoration:none;margin-top:-20px}.sp-collection-label{margin-top:18px;margin-bottom:6px;font-size:15px;font-weight:700;color:#4f5651}.sp-collection-list{list-style:none;margin:28px 0 0;padding:0;display:flex;flex-direction:column;gap:16px}.sp-collection-empty{margin-top:28px;background:#fff;border:1px solid rgba(17,21,15,.08);border-radius:16px;padding:32px 36px}.sp-collection-empty p{margin:0;font-size:24px;line-height:1.25;font-weight:800}.sp-collection-empty a{display:inline-flex;min-height:44px;align-items:center;margin-top:14px;color:#0f7a45;text-decoration:none;font-size:17px;font-weight:600}.sp-collection a:focus-visible{outline:2px solid #7c5cff;outline-offset:2px}.sp-collection-status{min-height:52px;margin-top:18px}.sp-collection-pages{display:flex;flex-wrap:wrap;gap:8px;margin-top:8px}.sp-collection-pages a,.sp-collection-pages>span{box-sizing:border-box;display:inline-flex;min-width:44px;min-height:44px;align-items:center;justify-content:center;padding:0 12px;border:1px solid rgba(17,21,15,.16);border-radius:10px;font-size:16px;font-weight:600;color:#11150f;background:#fff;text-decoration:none;font-variant-numeric:tabular-nums}.sp-collection-pages a[aria-current=page]{background:#11150f;color:#fff;font-weight:800}.sp-collection-pages>span{color:#6f756f;background:transparent;border-color:rgba(17,21,15,.08)}
@media(hover:hover){.sp-collection-back:hover,.sp-collection-empty a:hover{text-decoration:underline}.sp-collection-pages a:not([aria-current]):hover{background:#f7f8fa;border-color:rgba(17,21,15,.3)}}.sp-collection-pages a:not([aria-current]):active{background:#eef0ee}
@media(min-width:768px) and (max-width:1099px){.sp-collection{padding-left:40px;padding-right:40px}}@media(max-width:767px){.sp-collection{padding:26px 20px 56px}.sp-collection h1{font-size:32px}.sp-collection-list{margin-top:20px;gap:12px}.sp-collection-label{margin-top:12px;font-size:14px}.sp-collection-back{margin-top:-12px}.sp-collection-empty{padding:24px 22px;margin-top:20px}.sp-collection-empty p{font-size:20px}.sp-collection-pages{gap:6px}.sp-collection-status{margin-top:14px}}
`;
