import { useEffect, useRef, type MouseEvent } from 'react';
import { ScrollView } from 'react-native';
import { SetBox } from '../../components/read/SetBox';
import { ChevronLeft } from '../../components/icons';
import { TopicPieceCard } from '../../components/read/TopicPieceCard';
import { articleReturnHref, captureArticleReturn } from '../../lib/articleReturn';
import { publishedResearch, type PieceSetGroup, type ResearchPiece } from '../../lib/research';
import {
  collectionPage,
  guideCollectionItems,
  researchReportItems,
} from '../../lib/readCollectionSelection';
import { useHistoryScrollRestoration } from '../../hooks/useHistoryScrollRestoration';
import { useReducedMotion } from '../../hooks/useReducedMotion';
import { useResponsive } from '../../hooks/useResponsive';
import type { RootScreenProps } from '../../navigation/types';
import { Footer, PageBackground, TopNav } from '../../theme/primitives';

type Props =
  RootScreenProps<'ReadResearch'> | RootScreenProps<'ReadGuides'> | RootScreenProps<'ReadSet'>;
export function ReadCollectionScreen({ navigation, route }: Props) {
  const restoration = useHistoryScrollRestoration();
  const reducedMotion = useReducedMotion();
  const { isMobile } = useResponsive();
  const heading = useRef<HTMLHeadingElement>(null);
  const requestedPage = useRef<number | undefined>(undefined);
  const setPage = route.name === 'ReadSet';
  const research = route.name === 'ReadResearch';
  const setGroup = setPage
    ? guideCollectionItems().find(
        (item) => item.kind === 'group' && item.slug === route.params.slug,
      )
    : undefined;
  const title =
    setGroup?.kind === 'group' ? setGroup.name : research ? 'Research reports' : 'Guides';
  const base =
    setGroup?.kind === 'group'
      ? `/read/sets/${setGroup.slug}`
      : research
        ? '/read/research'
        : '/read/guides';
  const page = setPage ? 1 : Number(route.params?.page ?? 1);
  const bySlug = new Map(publishedResearch().map((piece) => [piece.slug, piece]));
  const reports = collectionPage(researchReportItems(), page);
  const guides = guideCollectionItems();
  const selectedGuides = setPage
    ? guides.filter((item) => item.kind === 'group' && item.slug === route.params.slug)
    : collectionPage(guides, page).items;
  const pageCount = research ? reports.pageCount : collectionPage(guides, page).pageCount;
  const visibleReports = reports.items
    .map((entry) => bySlug.get(entry.slug))
    .filter((piece): piece is ResearchPiece => Boolean(piece));
  const visibleGuides = selectedGuides
    .map((item) =>
      item.kind === 'group'
        ? {
            kind: 'group' as const,
            group: {
              name: item.name,
              slug: item.slug,
              pieces: item.members
                .map((member) => bySlug.get(member.slug))
                .filter((piece): piece is ResearchPiece => Boolean(piece)),
            } as PieceSetGroup,
          }
        : { kind: 'piece' as const, piece: bySlug.get(item.piece.slug) },
    )
    .filter((item) => item.kind === 'group' || Boolean(item.piece));
  const openPiece = (piece: ResearchPiece, sourceKind: 'research' | 'guides' | 'set') => {
    const href = articleReturnHref(sourceKind, piece.slug, String(page));
    navigation.navigate(piece.traits.research ? 'Research' : 'Guide', {
      slug: piece.slug,
      returnContext: captureArticleReturn(href),
    });
  };
  const movePage = (event: MouseEvent<HTMLAnchorElement>, next: number) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)
      return;
    event.preventDefault();
    if (next === page) return;
    requestedPage.current = next;
    navigation.navigate(research ? 'ReadResearch' : 'ReadGuides', { page: String(next) });
  };
  useEffect(() => {
    if (requestedPage.current !== page) return;
    requestedPage.current = undefined;
    heading.current?.scrollIntoView({
      block: 'start',
      behavior: reducedMotion ? 'instant' : 'smooth',
    });
    heading.current?.focus({ preventScroll: true });
  }, [page, reducedMotion]);
  useEffect(() => {
    const post = route.params?.post;
    if (!post) return;
    const link = document.querySelector<HTMLElement>(`[data-entry-link="${CSS.escape(post)}"]`);
    link?.scrollIntoView({ block: 'center' });
  }, [route.params?.post]);
  const pageLink = (number: number) => (
    <a
      key={number}
      href={`${base}?page=${number}`}
      aria-current={number === page ? 'page' : undefined}
      onClick={(event) => movePage(event, number)}
    >
      {number}
    </a>
  );
  return (
    <PageBackground>
      <ScrollView {...restoration} contentContainerStyle={{ flexGrow: 1 }}>
        <TopNav onHome={() => navigation.navigate('Tabs', { screen: 'Home' })} />
        <main className="read-collection">
          <style>{css}</style>
          <div className="read-collection-column">
            <a className="read-collection-back" href={setPage ? '/read/guides' : '/read'}>
              <ChevronLeft size={18} strokeWidth={2.2} aria-hidden />
              <span>{setPage ? 'All guides' : 'Back to Read'}</span>
            </a>
            {!setPage && (
              <h1 ref={heading} tabIndex={-1}>
                {title}
              </h1>
            )}
            <div className="read-collection-list">
              {research
                ? visibleReports.map((piece) => (
                    <TopicPieceCard
                      key={piece.slug}
                      piece={piece}
                      showKind={false}
                      variant="report"
                      headingLevel={2}
                      sourceHref={articleReturnHref('research', piece.slug, String(page))}
                      onOpen={() => openPiece(piece, 'research')}
                      onTopic={(topic) => navigation.navigate('ReadTopic', { topic })}
                    />
                  ))
                : visibleGuides.map((item) =>
                    item.kind === 'group' ? (
                      <SetBox
                        key={item.group.slug}
                        group={item.group}
                        isMobile={isMobile}
                        sourceHref={`${base}${page > 1 ? `?page=${page}` : ''}`}
                        headingLevel={setPage ? 1 : 2}
                        onOpenPiece={(piece) => openPiece(piece, setPage ? 'set' : 'guides')}
                        onTopic={(topic) => navigation.navigate('ReadTopic', { topic })}
                        showPageLink={!setPage}
                        onOpenPage={() => navigation.navigate('ReadSet', { slug: item.group.slug })}
                      />
                    ) : (
                      <TopicPieceCard
                        key={item.piece!.slug}
                        piece={item.piece!}
                        showKind={false}
                        headingLevel={2}
                        sourceHref={articleReturnHref('guides', item.piece!.slug, String(page))}
                        onOpen={() => openPiece(item.piece!, 'guides')}
                        onTopic={(topic) => navigation.navigate('ReadTopic', { topic })}
                      />
                    ),
                  )}
            </div>
            {!setPage && pageCount > 1 && (
              <nav className="read-collection-pages" aria-label={`${title} pages`}>
                {Array.from({ length: pageCount }, (_, index) => pageLink(index + 1))}
              </nav>
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

const css = `
.read-collection{padding:48px 56px 80px;flex:1;font-family:'Libre Franklin',sans-serif;color:#11150f}.read-collection-column{max-width:1000px}.read-collection-back{display:inline-flex;align-items:center;gap:9px;min-height:44px;margin-top:-20px;color:#4b524b;font-size:16px;font-weight:600;text-decoration:none}.read-collection-back:hover{color:#11150f}.read-collection-back:hover span{text-decoration:underline}.read-collection-back:focus-visible,.read-collection-pages a:focus-visible{outline:2px solid #7c5cff;outline-offset:2px}.read-collection h1{margin:0 0 24px;font-size:44px;line-height:1.08;font-weight:800;letter-spacing:-.03em;scroll-margin-top:24px}.read-collection h1:focus{outline:none}.read-collection-list{display:grid;gap:20px}.read-collection-pages{display:flex;gap:8px;justify-content:center;margin-top:32px}.read-collection-pages a{display:grid;place-items:center;width:44px;height:44px;border:1px solid rgba(17,21,15,.16);border-radius:8px;color:#11150f;background:#fff;text-decoration:none}.read-collection-pages a[aria-current=page]{background:#11150f;color:#fff}.read-collection-pages a:not([aria-current=page]):hover{background:#f7f8fa;border-color:rgba(17,21,15,.3)}
@media(max-width:767px){.read-collection{padding:28px 20px 56px}.read-collection h1{font-size:32px}.read-collection-list{gap:16px}.read-collection-pages{gap:6px}}
`;
