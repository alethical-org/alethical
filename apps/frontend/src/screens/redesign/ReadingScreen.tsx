import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';

import { useResponsive } from '../../hooks/useResponsive';
import {
  READING_PAGE_EMPTY_BODY,
  READING_PAGE_EMPTY_TITLE,
  READING_PAGE_HEADING,
  READING_PAGE_INTRO,
  publishedResearch,
  isoDateCapsLabel,
  type ResearchPiece,
} from '../../lib/research';
import { linkProps, routePath } from '../../navigation/links';
import type { RootScreenProps } from '../../navigation/types';
import { Container, Footer, PageBackground, TopNav } from '../../theme/primitives';
import { theme as t } from '../../theme/tokens';

/**
 * The /reading page — everything Alethical publishes in its own name, reached
 * from the nav's Reading group and from the money landing's "What we found"
 * card (grounded-answers.md rule 13; "Money report web.dc.html", screen A). It
 * sat at /money/reports until #1698, and at /reports until 27 Aug 2026
 * (docs/architecture/published-writing-decisions.md §2.1).
 *
 * Every card here is a piece carrying the research trait, because that is all
 * the registry holds today. Guides and sets are planned and unbuilt: the 2
 * trait flags, set membership, reading time and the checked date the combined
 * listing needs are the missing fields in §4 of that same file, tracked on
 * issue 1752. Newest first, one card per piece; a year's worth is what earns
 * grouping by year, so this is a flat list.
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

function ResearchCard({
  piece,
  onOpen,
  isMobile,
}: {
  piece: ResearchPiece;
  onOpen: () => void;
  isMobile: boolean;
}) {
  return (
    <Pressable {...linkProps(routePath.research(piece.slug), onOpen)} style={styles.card}>
      <View style={styles.cardBody}>
        <Text style={styles.cardDates}>PUBLISHED {isoDateCapsLabel(piece.publishedOn)}</Text>
        <Text style={[styles.cardTitle, isMobile && styles.cardTitleMobile]}>{piece.title}</Text>
        <Text style={styles.cardDek}>{piece.dek}</Text>
        <Text style={styles.cardCtaText}>Read the research →</Text>
      </View>
    </Pressable>
  );
}

export function ReadingScreen({ navigation }: RootScreenProps<'Reading'>) {
  const { isMobile } = useResponsive();
  const pieces = publishedResearch();

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

              The description says who wrote the research and what it was drawn
              from. It deliberately does not promise that figures link to their
              filings: no posted piece links one yet, and rule 6 of
              .claude/rules/grounded-answers.md only lets copy claim what the
              shipped surface delivers. That sentence belongs here the day a
              piece carries the links. */}
          <Text
            accessibilityRole="header"
            aria-level={1}
            style={[styles.heading, isMobile && styles.headingMobile]}
          >
            {READING_PAGE_HEADING}
          </Text>
          <Text style={styles.intro}>{READING_PAGE_INTRO}</Text>

          <View style={styles.rule} />

          {pieces.length === 0 ? (
            <View style={styles.emptyCard}>
              <Text style={styles.emptyTitle}>{READING_PAGE_EMPTY_TITLE}</Text>
              {/* No promise of future pieces — "an index promising work we have
                  not done is the one claim here we could not link" (design rule;
                  wording approved by the design-review session, 19 Aug 2026). */}
              <Text style={styles.emptyBody}>{READING_PAGE_EMPTY_BODY}</Text>
            </View>
          ) : (
            <View style={styles.cardList}>
              {pieces.map((piece) => (
                <ResearchCard
                  key={piece.slug}
                  piece={piece}
                  isMobile={isMobile}
                  onOpen={() => navigation.navigate('Research', { slug: piece.slug })}
                />
              ))}
            </View>
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
  cardList: { marginTop: 32, gap: 16 },
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
