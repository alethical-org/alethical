import { Platform, ScrollView, StyleSheet, Text, View } from 'react-native';

import { ShortPostsPreview, TopicPieceCard } from '../../components/read/TopicPieceCard';
import { articleReturnHref, captureArticleReturn } from '../../lib/articleReturn';
import { newestShortPosts } from '../../lib/shortPostSelection';
import { useHistoryScrollRestoration } from '../../hooks/useHistoryScrollRestoration';
import { guideCollectionItems } from '../../lib/readCollectionSelection';
import { publishedResearch } from '../../lib/research';
import { SetBox } from '../../components/read/SetBox';
import { useResponsive } from '../../hooks/useResponsive';
import {
  READ_GUIDES_GROUP_HEADING,
  READ_PAGE_EMPTY_BODY,
  READ_PAGE_EMPTY_TITLE,
  READ_PAGE_INTRO,
  READ_PAGE_NAME,
  READ_RESEARCH_GROUP_HEADING,
  piecesLabelledResearch,
  type PieceSetGroup,
  type ResearchPiece,
} from '../../lib/research';
import type { RootScreenProps } from '../../navigation/types';
import { Container, Footer, PageBackground, TopNav } from '../../theme/primitives';
import { theme as t } from '../../theme/tokens';

/**
 * The /read page — everything Alethical publishes in its own name, reached
 * from the bar's Read item (the money landing's research row links to the newest
 * piece itself) (grounded-answers.md rule 13; Design's `/read` handoff, 27 Aug 2026). It sat at
 * /money/reports until #1698, at /reports until the morning of 27 Aug 2026, and at
 * /reading until that evening (docs/architecture/published-writing-decisions.md
 * §2.1).
 *
 * **The page shows no title.** The top bar and the address both name the section
 * already, and a third visible instance of the word is what the naming rule
 * forbids. What sits where a title would is a note, in regular weight and grey,
 * because the bold heads here are the kind sections and a reader should see the
 * shape of what we publish before reading a sentence about it. The `h1` still
 * exists, visually hidden, so a screen reader and the browser tab have the page's
 * name; `READ_PAGE_NAME` reads it off the bar's own label so the 2 cannot
 * disagree.
 *
 * The page groups RESEARCH REPORTS, SHORT POSTS, then GUIDES in source order. Short
 * posts appear once, outside longer pieces and reading sets.
 * Source order rather than a CSS reordering, because reordering in the styling
 * alone separates what a person sees from what a screen reader reads and what the
 * keyboard reaches. Research is Alethical's own original work and guides exist
 * because research needs vocabulary, so leading with guides would put the
 * supporting material first.
 *
 * The vertical rhythm belongs to the SLOT rather than to the group: the first
 * group's heading sits below the page's rule, the second below the card above it.
 * So if the order ever swaps, or a group is empty, the spacing swaps with the
 * position instead of travelling with the group.
 *
 * A group with no pieces renders no heading and no list, because a heading over
 * nothing reads as broken; with neither group the page's own empty state stands.
 *
 * A card under one of these headings prints no kind word: the heading is the
 * source and the card inherits it (§2.10). Its accessible name still opens with
 * "Research: " or "Guide: ", because a card announced out of context has no
 * heading above it. Every card in a column is one shape — the same metadata, the
 * same title, and one smaller line holding a research piece's standfirst or a
 * guide's set — because a column that changes shape per kind reads as 2 columns.
 *
 * Under GUIDES, a set of pieces written to be read together draws a `SetBox`
 * before the loose cards. A set with nothing published draws no box at all (§2.4)
 * while its own page stays reachable, and `/read/sets/{slug}` is not built yet.
 *
 * Deliberately not built here: a set's own page, and the "All of <set name>" link
 * that Design gives a set at 6 published pieces. Sorting the page by subject
 * rather than by our own 2 kinds is Design's own open objection, deferred to 4
 * sets or a dozen research pieces (§2.11).
 */

const isWeb = Platform.OS === 'web';

/** Safari needs the clip as well as the 1px box to hide text without hiding it from a reader. */
const webClip = isWeb ? ({ clipPath: 'inset(50%)' } as object) : null;

/** One group on the page: its heading, and what renders under it. */
type PieceGroup = {
  heading: string;
  sets: PieceSetGroup[];
  pieces: ResearchPiece[];
  guideItems?: Array<
    { kind: 'group'; group: PieceSetGroup } | { kind: 'piece'; piece: ResearchPiece }
  >;
  shortPosts?: boolean;
};

export function ReadScreen({ navigation }: RootScreenProps<'Read'>) {
  const { isMobile } = useResponsive();
  const scrollRestoration = useHistoryScrollRestoration();
  const openPiece = (piece: ResearchPiece) =>
    piece.traits.research
      ? navigation.navigate('Research', {
          slug: piece.slug,
          returnContext: captureArticleReturn(articleReturnHref('read', piece.slug)),
        })
      : navigation.navigate('Guide', {
          slug: piece.slug,
          returnContext: captureArticleReturn(articleReturnHref('read', piece.slug)),
        });

  const bySlug = new Map(publishedResearch().map((piece) => [piece.slug, piece]));
  const guidePreview = guideCollectionItems()
    .slice(0, 3)
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
            },
          }
        : { kind: 'piece' as const, piece: bySlug.get(item.piece.slug) },
    )
    .filter((item) => item.kind === 'group' || Boolean(item.piece));
  // Source order: Research reports, Short posts, Guides. An empty group is dropped here rather than
  // hidden in the markup, so the group that renders first is genuinely first for
  // a screen reader and for the keyboard as well as in ink.
  const groups: PieceGroup[] = [
    {
      heading: READ_RESEARCH_GROUP_HEADING,
      sets: [],
      pieces: piecesLabelledResearch()
        .filter((piece) => piece.format !== 'short-post')
        .slice(0, 3),
    },
    {
      heading: 'SHORT POSTS',
      sets: [],
      pieces: newestShortPosts(publishedResearch()).slice(0, 3) as ResearchPiece[],
      shortPosts: true,
    },
    {
      heading: READ_GUIDES_GROUP_HEADING,
      sets: [],
      pieces: [],
      guideItems: guidePreview as PieceGroup['guideItems'],
    },
  ].filter(
    (group) =>
      group.sets.length > 0 || group.pieces.length > 0 || (group.guideItems?.length ?? 0) > 0,
  );

  return (
    <PageBackground>
      <ScrollView {...scrollRestoration} contentContainerStyle={styles.page}>
        <TopNav onHome={() => navigation.navigate('Tabs', { screen: 'Home' })} />

        <Container style={[styles.main, isMobile && styles.mainMobile]}>
          <View style={[styles.column, isMobile && styles.columnMobile]}>
            <style>{`.read-collection-link{display:inline-flex;align-items:center;min-height:44px;gap:9px;margin:6px 0 0 16px;color:#0f7a45;font-family:'Libre Franklin',sans-serif;font-size:17px;font-weight:600;text-decoration:none}.read-collection-link:focus-visible{outline:2px solid #7c5cff;outline-offset:2px}.read-collection-link span[aria-hidden]{text-decoration:none}@media(hover:hover){.read-collection-link:hover{color:#11832b;text-decoration:underline}}.read-sr{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap}`}</style>
            {/* Visually hidden, and the only h1 on the page. */}
            <Text accessibilityRole="header" aria-level={1} style={[styles.hiddenHeading, webClip]}>
              {READ_PAGE_NAME}
            </Text>
            <Text style={[styles.intro, isMobile && styles.introMobile]}>{READ_PAGE_INTRO}</Text>

            <View style={[styles.rule, isMobile && styles.ruleMobile]} />

            {groups.length === 0 ? (
              <View style={styles.emptyCard}>
                <Text style={styles.emptyTitle}>{READ_PAGE_EMPTY_TITLE}</Text>
                {/* No promise of future pieces — "an index promising work we have
                    not done is the one claim here we could not link" (design rule;
                    wording approved by the design-review session, 19 Aug 2026). */}
                <Text style={styles.emptyBody}>{READ_PAGE_EMPTY_BODY}</Text>
              </View>
            ) : (
              groups.map((group, index) => (
                <View key={group.heading}>
                  <Text
                    accessibilityRole="header"
                    aria-level={2}
                    style={[
                      styles.groupHeading,
                      isMobile && styles.groupHeadingMobile,
                      // The spacing is the slot's, not the group's.
                      index === 0
                        ? isMobile
                          ? styles.groupHeadingFirstMobile
                          : styles.groupHeadingFirst
                        : isMobile
                          ? styles.groupHeadingLaterMobile
                          : styles.groupHeadingLater,
                    ]}
                  >
                    {group.heading}
                  </Text>
                  {group.shortPosts ? (
                    <ShortPostsPreview
                      pieces={group.pieces}
                      onOpen={openPiece}
                      onTopic={(topic) => navigation.navigate('ReadTopic', { topic })}
                    />
                  ) : (
                    <View style={[styles.cardList, isMobile && styles.cardListMobile]}>
                      {group.guideItems?.map((item, guideIndex) =>
                        item.kind === 'group' ? (
                          <SetBox
                            key={item.group.slug}
                            group={item.group}
                            isMobile={isMobile}
                            initiallyOpen={
                              !group
                                .guideItems!.slice(0, guideIndex)
                                .some((earlier) => earlier.kind === 'group')
                            }
                            onOpenPiece={openPiece}
                            onTopic={(topic) => navigation.navigate('ReadTopic', { topic })}
                            showPageLink
                            onOpenPage={() =>
                              navigation.navigate('ReadSet', { slug: item.group.slug })
                            }
                          />
                        ) : (
                          <TopicPieceCard
                            key={item.piece.slug}
                            piece={item.piece}
                            showKind={false}
                            sourceHref="/read"
                            onOpen={() => openPiece(item.piece)}
                            onTopic={(topic) => navigation.navigate('ReadTopic', { topic })}
                          />
                        ),
                      )}
                      {group.pieces.map((piece) => (
                        <TopicPieceCard
                          key={piece.slug}
                          piece={piece}
                          showKind={false}
                          variant={piece.traits.research ? 'report' : 'card'}
                          sourceHref="/read"
                          onOpen={() => openPiece(piece)}
                          onTopic={(topic) => navigation.navigate('ReadTopic', { topic })}
                        />
                      ))}
                    </View>
                  )}
                  <a
                    className="read-collection-link"
                    href={
                      group.shortPosts
                        ? '/read/short-posts'
                        : group.heading === READ_RESEARCH_GROUP_HEADING
                          ? '/read/research'
                          : '/read/guides'
                    }
                  >
                    All{' '}
                    {group.shortPosts ? (
                      <>
                        <span className="read-sr">short </span>posts
                      </>
                    ) : group.heading === READ_RESEARCH_GROUP_HEADING ? (
                      <>
                        <span className="read-sr">research </span>reports
                      </>
                    ) : (
                      'guides'
                    )}{' '}
                    <span aria-hidden="true">→</span>
                  </a>
                </View>
              ))
            )}
          </View>
        </Container>

        <Footer
          onContact={() => navigation.navigate('ContactUs')}
          onPrivacy={() => navigation.navigate('Privacy')}
          onTerms={() => navigation.navigate('Terms')}
        />
      </ScrollView>
    </PageBackground>
  );
}

const styles = StyleSheet.create({
  page: { flexGrow: 1 },
  // 80px of clear space under the last card before the footer, per the handoff.
  main: { paddingTop: 56, paddingBottom: 80, flexGrow: 1 },
  mainMobile: { paddingTop: 26, paddingBottom: 56 },
  // The content column, so a card's title and a set's name break at a readable
  // width on a wide screen instead of running the full window.
  column: { width: '100%', maxWidth: 1000 },
  columnMobile: { maxWidth: undefined },
  hiddenHeading: { position: 'absolute', width: 1, height: 1, overflow: 'hidden' },
  intro: {
    color: t.colors.text.secondary,
    fontFamily: t.typography.body,
    fontSize: 20,
    lineHeight: 30,
  },
  introMobile: { fontSize: 18, lineHeight: 26 },
  rule: {
    marginTop: 26,
    height: 1,
    backgroundColor: t.colors.alpha.ink10,
  },
  ruleMobile: { marginTop: 18 },
  emptyCard: {
    marginTop: 32,
    maxWidth: 760,
    backgroundColor: t.colors.surfaces.s200,
    borderWidth: 1,
    borderColor: t.colors.alpha.ink08,
    borderRadius: 15,
    padding: 26,
  },
  emptyTitle: {
    color: t.colors.text.primary,
    fontFamily: t.typography.ui,
    fontSize: 17,
    fontWeight: t.fontWeights.bold,
  },
  emptyBody: {
    marginTop: 8,
    color: t.colors.text.secondary,
    fontFamily: t.typography.body,
    fontSize: 16,
    lineHeight: 25,
  },
  // Structural headings rather than decorative eyebrows: a card under one of them
  // prints no kind word and takes it from here, so this is 18px and weight 700
  // rather than the 13px section label used elsewhere (Design, accepted in
  // review). Letter-spacing is 0.2em, which React Native counts in pixels.
  groupHeading: {
    color: t.colors.text.greenOnLight,
    fontFamily: t.typography.ui,
    fontSize: 18,
    fontWeight: t.fontWeights.bold,
    letterSpacing: 3.6,
  },
  groupHeadingMobile: { fontSize: 16, letterSpacing: 3.2 },
  // First slot: below the page's rule. Second slot: below the card above it.
  groupHeadingFirst: { marginTop: 32 },
  groupHeadingLater: { marginTop: 56 },
  groupHeadingFirstMobile: { marginTop: 22 },
  groupHeadingLaterMobile: { marginTop: 34 },
  cardList: { marginTop: 18, gap: 20 },
  cardListMobile: { marginTop: 14, gap: 16 },
  card: {
    backgroundColor: t.colors.surfaces.base,
    borderWidth: 1,
    borderColor: t.colors.alpha.ink08,
    borderRadius: 16,
    paddingTop: 32,
    paddingBottom: 34,
    paddingHorizontal: 36,
  },
  cardMobile: { paddingTop: 22, paddingBottom: 24, paddingHorizontal: 20 },
  cardHover: {
    borderColor: 'rgba(45,212,126,0.85)',
    ...(isWeb ? ({ boxShadow: '0 22px 46px rgba(17,21,15,0.14)' } as object) : null),
  },
  cardHoverLift: { transform: [{ translateY: -3 }] },
  cardKindForScreenReaders: { position: 'absolute', width: 1, height: 1, overflow: 'hidden' },
  cardMeta: {
    color: '#656c66',
    fontFamily: t.typography.ui,
    fontSize: 11.5,
    lineHeight: 17.25,
    fontWeight: t.fontWeights.heavy,
    fontVariant: ['tabular-nums'],
    letterSpacing: 0.115,
  },
  cardMetaMobile: { fontSize: 10.5, lineHeight: 15.75, letterSpacing: 0.105 },
  cardTitle: {
    marginTop: 14,
    color: t.colors.text.primary,
    fontFamily: t.typography.title,
    fontSize: 32,
    lineHeight: 38,
    fontWeight: t.fontWeights.heavy,
    letterSpacing: -0.8,
  },
  cardTitleMobile: { marginTop: 11, fontSize: 25, lineHeight: 29, letterSpacing: -0.63 },
  cardSecondary: {
    marginTop: 14,
    maxWidth: 620,
    color: t.colors.text.secondary,
    fontFamily: t.typography.body,
    fontSize: 18,
    lineHeight: 28,
  },
  cardSecondaryMobile: { marginTop: 11, fontSize: 17, lineHeight: 26 },
});
