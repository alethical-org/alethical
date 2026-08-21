import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';

import { useResponsive } from '../../hooks/useResponsive';
import { publishedReports, reportDatesLine, type MoneyReport } from '../../lib/moneyReports';
import { linkProps, routePath } from '../../navigation/links';
import type { RootScreenProps } from '../../navigation/types';
import { Container, Footer, PageBackground, TopNav } from '../../theme/primitives';
import { theme as t } from '../../theme/tokens';

/**
 * The reports shelf at /reports — the site's research lane, reached from the
 * nav's Reports group and from the money landing's "What we found" card
 * (grounded-answers.md rule 13; "Money report web.dc.html", screen A). It sat
 * at /money/reports until #1698 moved it out of the money section.
 *
 * Ships in its nothing-published state: `publishedReports()` is empty until a
 * report's text is approved for publication, and this screen renders whatever
 * that registry holds. Newest first, one card per report; a year's worth is what
 * earns grouping by year, so the shelf is a flat list.
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

/** Right-pointing "read on" arrow, drawn for the same reason. */
function ForwardArrow({ color }: { color: string }) {
  return (
    <Svg width={15} height={15} viewBox="0 0 24 24" fill="none" aria-hidden>
      <Path
        d="M5 12 H19 M14 7 L19 12 L14 17"
        stroke={color}
        strokeWidth={2.2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

function ReportCard({
  report,
  onOpen,
  isMobile,
}: {
  report: MoneyReport;
  onOpen: () => void;
  isMobile: boolean;
}) {
  return (
    <Pressable {...linkProps(routePath.moneyReport(report.slug), onOpen)} style={styles.card}>
      <View style={styles.cardBody}>
        <Text style={styles.cardDates}>{reportDatesLine(report)}</Text>
        <Text style={[styles.cardTitle, isMobile && styles.cardTitleMobile]}>{report.title}</Text>
        <Text style={styles.cardDek}>{report.dek}</Text>
        <View style={styles.cardCta}>
          <Text style={styles.cardCtaText}>Read the report</Text>
          <ForwardArrow color={t.colors.text.greenOnLight} />
        </View>
      </View>
    </Pressable>
  );
}

export function MoneyReportsShelfScreen({ navigation }: RootScreenProps<'MoneyReports'>) {
  const { isMobile } = useResponsive();
  const reports = publishedReports();

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
              heading names the things on the shelf rather than the act of
              finding them, and stays plural so one report and a collection
              both read right (header design prompt, 20 Aug 2026).

              The description says who wrote the research and what it was drawn
              from. It deliberately does not promise that figures link to their
              filings: no posted report links one yet, and rule 6 of
              .claude/rules/grounded-answers.md only lets copy claim what the
              shipped surface delivers. That sentence belongs here the day a
              report carries the links. */}
          <Text
            accessibilityRole="header"
            aria-level={1}
            style={[styles.heading, isMobile && styles.headingMobile]}
          >
            Campaign money reports
          </Text>
          <Text style={styles.intro}>
            Our own research, in plain language, drawn from the filings Minnesota campaigns, parties
            and funds make with the state.
          </Text>

          <View style={styles.rule} />

          {reports.length === 0 ? (
            <View style={styles.emptyCard}>
              <Text style={styles.emptyTitle}>Nothing published yet.</Text>
              {/* No promise of future reports — "an index promising work we have
                  not done is the one claim here we could not link" (design rule;
                  wording approved by the design-review session, 19 Aug 2026). */}
              <Text style={styles.emptyBody}>
                When we publish research on these records, it appears here, dated and carrying the
                date its records run through.
              </Text>
            </View>
          ) : (
            <View style={styles.cardList}>
              {reports.map((report) => (
                <ReportCard
                  key={report.slug}
                  report={report}
                  isMobile={isMobile}
                  onOpen={() => navigation.navigate('MoneyReport', { slug: report.slug })}
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
  cardCta: { marginTop: 6, flexDirection: 'row', alignItems: 'center', gap: 10 },
  cardCtaText: {
    color: t.colors.text.greenOnLight,
    fontFamily: t.typography.ui,
    fontSize: 16,
    fontWeight: t.fontWeights.bold,
  },
});
