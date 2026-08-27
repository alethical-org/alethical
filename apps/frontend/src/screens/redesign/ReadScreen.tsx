import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';

import { useResponsive } from '../../hooks/useResponsive';
import {
  READ_GUIDES_GROUP_HEADING,
  READ_PAGE_EMPTY_BODY,
  READ_PAGE_EMPTY_TITLE,
  READ_PAGE_HEADING,
  READ_PAGE_INTRO,
  READ_RESEARCH_GROUP_HEADING,
  pieceCardCta,
  pieceCardMetaLine,
  piecesLabelledGuide,
  piecesLabelledResearch,
  type ResearchPiece,
} from '../../lib/research';
import { linkProps, routePath } from '../../navigation/links';
import type { RootScreenProps } from '../../navigation/types';
import { Container, Footer, PageBackground, TopNav } from '../../theme/primitives';
import { theme as t } from '../../theme/tokens';

/**
 * The /read page — everything Alethical publishes in its own name, reached
 * from the bar's Read item and from the money landing's "What we found"
 * card (grounded-answers.md rule 13; "Money report web.dc.html", screen A). It
 * sat at /money/reports until #1698, at /reports until the morning of 27 Aug
 * 2026, and at /reading until that evening
 * (docs/architecture/published-writing-decisions.md §2.1).
 *
 * The page holds both kinds of writing, in 2 groups: **RESEARCH first, then
 * GUIDES**, in source order (Eugene, 27 Aug 2026, overruling the drawn order).
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
 * source and the card inherits it (§2.10). Newest first inside each group; a
 * year's worth of pieces is what would earn grouping by year, so each group is a
 * flat list.
 *
 * Not built here, deliberately: the set box, its fold control, and a set's own
 * page. §2.5 makes a set box a declaration that the next piece is coming shortly,
 * and "How the Money Works" has 1 published piece with no owner and no date for
 * the next, so it does not qualify — the guide appears as a standalone card,
 * which §2.2 allows.
 */

/** Left-pointing chevron for the back link, drawn — the site font has no arrow glyphs. */
function BackChevron() {
  return (
    <Svg width={18} height={18} viewBox="0 0 24 24" fill="none" aria-hidden>
      <Path
        d="M15 5 L8 12 L15 19"
        stroke={t.colors.text.secondary}
        strokeWidth={2.2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

function PieceCard({
  piece,
  onOpen,
  isMobile,
}: {
  piece: ResearchPiece;
  onOpen: () => void;
  isMobile: boolean;
}) {
  return (
    <Pressable {...linkProps(routePath.piece(piece), onOpen)} style={styles.card}>
      <View style={styles.cardBody}>
        {/* A research piece's card carries its publication date, as it has since
            it posted. A guide's carries its reading time and no date: a date on a
            guide says which event it is and belongs on the piece, never on a
            listing row, which is where staleness reads worst and a date does
            least work (settled 26 Aug 2026). */}
        <Text style={styles.cardDates}>{pieceCardMetaLine(piece)}</Text>
        <Text style={[styles.cardTitle, isMobile && styles.cardTitleMobile]}>{piece.title}</Text>
        {piece.dek ? <Text style={styles.cardDek}>{piece.dek}</Text> : null}
        <Text style={styles.cardCtaText}>{pieceCardCta(piece)}</Text>
      </View>
    </Pressable>
  );
}

/** One group on the page: its heading, and the pieces under it. */
type PieceGroup = { heading: string; pieces: ResearchPiece[] };

export function ReadScreen({ navigation }: RootScreenProps<'Read'>) {
  const { isMobile } = useResponsive();
  // Source order, research first. An empty group is dropped here rather than
  // hidden in the markup, so the group that renders first is genuinely first for
  // a screen reader and for the keyboard as well as in ink.
  const groups: PieceGroup[] = [
    { heading: READ_RESEARCH_GROUP_HEADING, pieces: piecesLabelledResearch() },
    { heading: READ_GUIDES_GROUP_HEADING, pieces: piecesLabelledGuide() },
  ].filter((group) => group.pieces.length > 0);

  return (
    <PageBackground>
      <ScrollView contentContainerStyle={styles.page}>
        <TopNav onHome={() => navigation.navigate('Tabs', { screen: 'Home' })} />

        <Container style={[styles.main, isMobile && styles.mainMobile]}>
          {/* A back link names its destination, never the page it sits on: this
              one goes to the money landing, which the nav calls "Money in
              politics" (#1707 follow-up, 20 Aug 2026). */}
          <Pressable
            {...linkProps(routePath.money(), () => navigation.navigate('MoneyLanding'))}
            style={styles.backLink}
          >
            <View style={styles.backChevron}>
              <BackChevron />
            </View>
            <Text style={styles.backLinkText}>Money in politics</Text>
          </Pressable>

          {/* No eyebrow above the heading: a back link plus a label plus a
              heading is three lines of navigation furniture before the page
              says anything, and the label's words ("CAMPAIGN MONEY") are the
              subject the heading was missing, so they moved into it. The
              heading names the things on the page rather than the act of
              finding them, and stays uncountable so one piece and a collection
              both read right (header design prompt, 20 Aug 2026).

              The description says who wrote what is on the page and what it was
              drawn from. It deliberately does not promise that figures link to
              their filings: no posted piece links one yet, and rule 6 of
              .claude/rules/grounded-answers.md only lets copy claim what the
              shipped surface delivers. That sentence belongs here the day a
              piece carries the links. */}
          <Text
            accessibilityRole="header"
            aria-level={1}
            style={[styles.heading, isMobile && styles.headingMobile]}
          >
            {READ_PAGE_HEADING}
          </Text>
          <Text style={styles.intro}>{READ_PAGE_INTRO}</Text>

          <View style={styles.rule} />

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
                <View style={styles.cardList}>
                  {group.pieces.map((piece) => (
                    <PieceCard
                      key={piece.slug}
                      piece={piece}
                      isMobile={isMobile}
                      onOpen={() =>
                        piece.traits.research
                          ? navigation.navigate('Research', { slug: piece.slug })
                          : navigation.navigate('Guide', { slug: piece.slug })
                      }
                    />
                  ))}
                </View>
              </View>
            ))
          )}
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
  main: { paddingTop: 44, paddingBottom: 72, flexGrow: 1 },
  mainMobile: { paddingTop: 28, paddingBottom: 52 },
  backLink: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
  },
  backChevron: { width: 18, height: 18 },
  backLinkText: {
    color: t.colors.text.secondary,
    fontFamily: t.typography.ui,
    fontSize: 16,
    fontWeight: t.fontWeights.semibold,
  },
  heading: {
    // 22, the gap the removed eyebrow held: the heading takes the label's
    // place under the back link rather than closing up against it.
    marginTop: 22,
    color: t.colors.text.primary,
    fontFamily: t.typography.title,
    fontSize: 46,
    lineHeight: 50,
    fontWeight: t.fontWeights.heavy,
    letterSpacing: -1.4,
  },
  headingMobile: { fontSize: 34, lineHeight: 38, letterSpacing: -1 },
  intro: {
    marginTop: 16,
    maxWidth: 820,
    color: t.colors.text.secondary,
    fontFamily: t.typography.body,
    fontSize: 19,
    lineHeight: 29,
  },
  rule: {
    marginTop: 36,
    height: 1,
    backgroundColor: t.colors.alpha.ink10,
  },
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
  cardList: { marginTop: 16, gap: 16 },
  card: {
    backgroundColor: t.colors.surfaces.base,
    borderWidth: 1,
    borderColor: t.colors.alpha.ink10,
    borderRadius: 16,
    padding: 28,
  },
  cardBody: { gap: 12 },
  cardDates: {
    color: t.colors.text.muted,
    fontFamily: t.typography.mono,
    fontSize: 11.5,
    fontWeight: t.fontWeights.bold,
    letterSpacing: 0.9,
  },
  cardTitle: {
    color: t.colors.text.primary,
    fontFamily: t.typography.title,
    fontSize: 30,
    lineHeight: 36,
    fontWeight: t.fontWeights.heavy,
    letterSpacing: -0.7,
  },
  cardTitleMobile: { fontSize: 24, lineHeight: 29 },
  cardDek: {
    maxWidth: 760,
    color: t.colors.text.secondary,
    fontFamily: t.typography.body,
    fontSize: 17.5,
    lineHeight: 27,
  },
  cardCtaText: {
    marginTop: 6,
    color: t.colors.text.greenOnLight,
    fontFamily: t.typography.ui,
    fontSize: 16,
    fontWeight: t.fontWeights.bold,
  },
});
