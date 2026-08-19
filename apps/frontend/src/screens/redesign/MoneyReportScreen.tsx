import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';

import { SharePopover } from '../../components/billDetail/SharePopover';
import { useResponsive } from '../../hooks/useResponsive';
import {
  reportBySlug,
  reportDatesLine,
  reportShareDescription,
  type MoneyReport,
  type ReportBlock,
  type ReportInline,
  type ReportSection,
} from '../../lib/moneyReports';
import { publicPageUrl, type ShareContent } from '../../lib/share';
import { externalLinkProps, linkProps, routePath } from '../../navigation/links';
import type { RootScreenProps } from '../../navigation/types';
import { Container, Footer, PageBackground, TopNav } from '../../theme/primitives';
import { prefersReducedMotion, theme as t } from '../../theme/tokens';

/**
 * One published research report at /money/reports/{slug} — the one surface that
 * may add figures up across members, under `.claude/rules/grounded-answers.md`
 * rule 13's conditions ("Money report web.dc.html", screen B).
 *
 * Everything here renders from the published-report registry
 * (lib/moneyReports.ts), which ships EMPTY: no reader reaches this screen until
 * a report is approved for publication, because the router resolves unknown and
 * unpublished slugs to NotFound. The populated states — masthead, correction,
 * newer-filings banner, methodology inset — are pinned by tests with sample
 * content instead.
 *
 * Rule 13 constraints this layout owns:
 * - Links run one way. The report may link outward to record pages and official
 *   sources; nothing here writes report claims into any record surface.
 * - Share previews carry title and dates only (lib/share.ts
 *   moneyReportPageMetadata); the Share control's prepared text says the same.
 * - A corrected figure stays readable — struck through and dated — and the
 *   correction banner is dated, never a silent edit.
 * - The downloadable copy is this page, regenerated at each publish: the
 *   control prints the current page, so there is no second stored document to
 *   drift from it.
 */

const isWeb = Platform.OS === 'web';

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

/** Down-into-tray "download" glyph beside the PDF control, drawn (no font arrows). */
function DownloadGlyph({ color }: { color: string }) {
  return (
    <Svg width={14} height={14} viewBox="0 0 24 24" fill="none" aria-hidden>
      <Path
        d="M12 4 V15 M8 11 L12 15 L16 11"
        stroke={color}
        strokeWidth={2.2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path
        d="M5 17 v2 a1 1 0 0 0 1 1 h12 a1 1 0 0 0 1-1 v-2"
        stroke={color}
        strokeWidth={2.2}
        strokeLinecap="round"
      />
    </Svg>
  );
}

/** Jump to a section anchor in place. Web-only mechanics, honoring reduced motion. */
function jumpToAnchor(anchor: string) {
  if (!isWeb || typeof document === 'undefined') return;
  document
    .getElementById(anchor)
    ?.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', block: 'start' });
}

function InlineRuns({ runs }: { runs: ReportInline[] }) {
  return (
    <>
      {runs.map((run, index) => {
        switch (run.kind) {
          case 'text':
            return <Text key={index}>{run.text}</Text>;
          case 'bold':
            return (
              <Text key={index} style={styles.runBold}>
                {run.text}
              </Text>
            );
          case 'italic':
            return (
              <Text key={index} style={styles.runItalic}>
                {run.text}
              </Text>
            );
          case 'externalLink':
            return (
              <Text key={index} {...externalLinkProps(run.href)} style={styles.runLink}>
                {run.text}
              </Text>
            );
          case 'correctedFigure':
            // The earlier figure stays readable — struck through, then the
            // current figure, then the dated marker (rule 13).
            return (
              <Text key={index}>
                <Text style={styles.runStruck}>{run.was}</Text>
                <Text> {run.now} </Text>
                <Text style={styles.runCorrectedLabel}>{run.datedLabel}</Text>
              </Text>
            );
        }
      })}
    </>
  );
}

function Blocks({ blocks }: { blocks: ReportBlock[] }) {
  return (
    <>
      {blocks.map((block, index) =>
        block.kind === 'paragraph' ? (
          <Text key={index} style={styles.paragraph}>
            <InlineRuns runs={block.runs} />
          </Text>
        ) : (
          <View key={index} style={styles.bullets}>
            {block.items.map((item, itemIndex) => (
              <View key={itemIndex} style={styles.bulletRow}>
                <Text style={styles.bulletDot}>{'•'}</Text>
                <Text style={[styles.paragraph, styles.bulletText]}>
                  <InlineRuns runs={item} />
                </Text>
              </View>
            ))}
          </View>
        ),
      )}
    </>
  );
}

function SectionView({ section }: { section: ReportSection }) {
  return (
    <View nativeID={section.anchor}>
      <Text accessibilityRole="header" aria-level={2} style={styles.sectionHeading}>
        {section.heading}
      </Text>
      <Blocks blocks={section.blocks} />
      {section.methodologyInset ? (
        <View style={styles.insetBox}>
          <Text style={styles.insetLabel}>{section.methodologyInset.title.toUpperCase()}</Text>
          <Text style={styles.insetBody}>{section.methodologyInset.body}</Text>
        </View>
      ) : null}
    </View>
  );
}

function ContentsLinks({ report, compact }: { report: MoneyReport; compact?: boolean }) {
  return (
    <View style={compact ? styles.contentsListCompact : styles.contentsList}>
      {report.sections.map((section) => (
        <Pressable
          key={section.anchor}
          accessibilityRole="link"
          {...(isWeb ? { href: `#${section.anchor}` } : {})}
          onPress={(event) => {
            (event as unknown as { preventDefault?: () => void })?.preventDefault?.();
            jumpToAnchor(section.anchor);
          }}
        >
          <Text style={styles.contentsLink}>{section.railLabel}</Text>
        </Pressable>
      ))}
    </View>
  );
}

function DownloadPdf({ subtle }: { subtle?: boolean }) {
  const color = subtle ? t.colors.text.greenOnLight : '#2c322c';
  return (
    <Pressable
      accessibilityRole="button"
      onPress={() => {
        if (isWeb && typeof window !== 'undefined') window.print();
      }}
      style={subtle ? styles.pdfLink : styles.pdfButton}
    >
      <Text style={subtle ? styles.pdfLinkText : styles.pdfButtonText}>Download as PDF</Text>
      <DownloadGlyph color={color} />
    </Pressable>
  );
}

export function MoneyReportScreen({ navigation, route }: RootScreenProps<'MoneyReport'>) {
  const { isMobile } = useResponsive();
  const report = reportBySlug(route.params.slug);

  // The router only produces this route for published slugs, so this is a
  // belt-and-braces guard, not a reachable state.
  if (!report) {
    return (
      <PageBackground>
        <ScrollView contentContainerStyle={styles.page}>
          <TopNav onHome={() => navigation.navigate('Tabs', { screen: 'Home' })} />
          <Container style={styles.main}>
            <Text style={styles.paragraph}>This report is not published.</Text>
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

  const shareContent: ShareContent = {
    subject: 'report',
    title: report.title,
    // Title and dates only — no dek, no figures (rule 13).
    description: reportShareDescription(report),
    url: publicPageUrl(routePath.moneyReport(report.slug)),
  };

  return (
    <PageBackground>
      <ScrollView contentContainerStyle={styles.page}>
        <TopNav onHome={() => navigation.navigate('Tabs', { screen: 'Home' })} />

        <Container style={[styles.main, isMobile && styles.mainMobile]}>
          <Pressable
            {...linkProps(routePath.moneyReports(), () => navigation.navigate('MoneyReports'))}
            style={styles.backLink}
          >
            <BackChevron />
            <Text style={styles.backLinkText}>What we found</Text>
          </Pressable>

          <View style={[styles.grid, isMobile && styles.gridMobile]}>
            {!isMobile ? (
              <View style={[styles.rail, webSticky as never]}>
                <Text style={styles.railLabel}>CONTENTS</Text>
                <ContentsLinks report={report} />
                <View style={styles.railRule} />
                <DownloadPdf subtle />
              </View>
            ) : null}

            <View style={styles.column}>
              {report.newerFilingsNote ? (
                <View style={[styles.newerBanner, isMobile && styles.bannerMobile]}>
                  <Text style={styles.newerBannerLabel}>NEWER FILINGS EXIST</Text>
                  <Text style={styles.newerBannerText}>{report.newerFilingsNote}</Text>
                </View>
              ) : null}

              <Text style={styles.eyebrow}>REPORT</Text>
              <Text
                accessibilityRole="header"
                aria-level={1}
                style={[styles.heading, isMobile && styles.headingMobile]}
              >
                {report.title}
              </Text>
              <Text style={styles.dek}>{report.dek}</Text>

              <View style={styles.mastheadRow}>
                <View style={styles.mastheadMeta}>
                  <Text style={styles.mastheadLine}>{report.authorLine}</Text>
                  <Text style={styles.mastheadLineMuted}>{reportDatesLine(report)}</Text>
                  <Text style={styles.mastheadLineMuted}>
                    {report.filingBodies.join(' · ').toUpperCase()}
                  </Text>
                </View>
                <SharePopover content={shareContent} />
              </View>

              {report.correction ? (
                <View style={[styles.correctionBanner, isMobile && styles.bannerMobile]}>
                  <Text style={styles.correctionLabel}>{report.correction.datedLabel}</Text>
                  <Text style={styles.correctionText}>{report.correction.note}</Text>
                </View>
              ) : null}

              {isMobile ? (
                <View style={styles.mobileContents}>
                  <Text style={styles.railLabel}>CONTENTS</Text>
                  <ContentsLinks report={report} compact />
                </View>
              ) : null}

              <View style={styles.shortVersionBox}>
                <Text style={styles.insetLabel}>THE SHORT VERSION</Text>
                <Blocks blocks={report.shortVersion} />
              </View>

              {report.sections.map((section) => (
                <SectionView key={section.anchor} section={section} />
              ))}

              <View style={styles.sourcesBlock}>
                <Text style={styles.insetLabel}>WHERE THESE NUMBERS COME FROM</Text>
                <View style={styles.sourcesList}>
                  {report.sources.map((source, index) => (
                    <Text key={index} style={styles.sourceItem}>
                      <Text>{source.text} </Text>
                      {source.note ? <Text style={styles.sourceNote}>{source.note} </Text> : null}
                      {source.noteLink ? (
                        <Text {...externalLinkProps(source.noteLink.href)} style={styles.runLink}>
                          {source.noteLink.text}
                        </Text>
                      ) : null}
                    </Text>
                  ))}
                </View>
                <View style={styles.pdfRow}>
                  <DownloadPdf />
                  <Text style={styles.pdfNote}>
                    The PDF is this page, regenerated at each publish — one current copy per
                    published version, never a second document maintained beside the page.
                  </Text>
                </View>
              </View>
            </View>
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

const webSticky = isWeb ? ({ position: 'sticky', top: 24 } as object) : null;

const styles = StyleSheet.create({
  page: { flexGrow: 1 },
  main: { paddingTop: 40, paddingBottom: 72, flexGrow: 1 },
  mainMobile: { paddingTop: 26, paddingBottom: 52 },
  backLink: { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 9 },
  backLinkText: {
    color: t.colors.text.secondary,
    fontFamily: t.typography.ui,
    fontSize: 16,
    fontWeight: t.fontWeights.semibold,
  },
  grid: { marginTop: 28, flexDirection: 'row', gap: 56, alignItems: 'flex-start' },
  gridMobile: { flexDirection: 'column', gap: 0 },
  rail: { width: 226, flexShrink: 0 },
  railLabel: {
    color: t.colors.text.secondary,
    fontFamily: t.typography.mono,
    fontSize: 10.5,
    fontWeight: t.fontWeights.bold,
    letterSpacing: 1.3,
  },
  contentsList: { marginTop: 16, gap: 13 },
  contentsListCompact: { marginTop: 12, gap: 10 },
  contentsLink: {
    color: t.colors.text.secondary,
    fontFamily: t.typography.ui,
    fontSize: 14,
    lineHeight: 19,
  },
  railRule: { marginTop: 22, height: 1, backgroundColor: t.colors.alpha.ink10 },
  column: { flex: 1, maxWidth: 760, minWidth: 0 },
  mobileContents: {
    marginTop: 24,
    backgroundColor: t.colors.surfaces.s200,
    borderWidth: 1,
    borderColor: t.colors.alpha.ink08,
    borderRadius: 13,
    padding: 18,
  },
  // Phone widths stack a banner's label above its sentence; side by side the
  // label column eats half the screen.
  bannerMobile: { flexDirection: 'column', gap: 8 },
  newerBanner: {
    marginBottom: 26,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 13,
    backgroundColor: t.colors.omnibus.fill,
    borderWidth: 1,
    borderColor: t.colors.omnibus.border,
    borderRadius: 13,
    padding: 17,
  },
  newerBannerLabel: {
    marginTop: 1,
    color: t.colors.omnibus.text,
    fontFamily: t.typography.mono,
    fontSize: 10,
    fontWeight: t.fontWeights.bold,
    letterSpacing: 0.8,
  },
  newerBannerText: {
    flex: 1,
    minWidth: 0,
    color: t.colors.text.primary,
    fontFamily: t.typography.body,
    fontSize: 15.5,
    lineHeight: 24,
  },
  eyebrow: {
    color: '#2b6377',
    fontFamily: t.typography.mono,
    fontSize: 11,
    fontWeight: t.fontWeights.bold,
    letterSpacing: 1.5,
  },
  heading: {
    marginTop: 14,
    color: t.colors.text.primary,
    fontFamily: t.typography.title,
    fontSize: 52,
    lineHeight: 55,
    fontWeight: t.fontWeights.heavy,
    letterSpacing: -1.6,
  },
  headingMobile: { fontSize: 32, lineHeight: 37, letterSpacing: -0.9 },
  dek: {
    marginTop: 20,
    color: t.colors.text.secondary,
    fontFamily: t.typography.body,
    fontSize: 22,
    lineHeight: 33,
  },
  mastheadRow: {
    marginTop: 24,
    paddingTop: 20,
    borderTopWidth: 1,
    borderTopColor: t.colors.alpha.ink10,
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 24,
    flexWrap: 'wrap',
  },
  mastheadMeta: { flexShrink: 1, minWidth: 0, gap: 7 },
  mastheadLine: {
    color: t.colors.text.muted,
    fontFamily: t.typography.mono,
    fontSize: 11.5,
    fontWeight: t.fontWeights.bold,
    letterSpacing: 0.9,
  },
  mastheadLineMuted: {
    color: t.colors.text.muted,
    fontFamily: t.typography.mono,
    fontSize: 11.5,
    letterSpacing: 0.9,
  },
  correctionBanner: {
    marginTop: 22,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 13,
    backgroundColor: t.colors.surfaces.s200,
    borderWidth: 1,
    borderColor: t.colors.alpha.ink12,
    borderRadius: 13,
    padding: 17,
  },
  correctionLabel: {
    marginTop: 1,
    color: t.colors.omnibus.text,
    fontFamily: t.typography.mono,
    fontSize: 10,
    fontWeight: t.fontWeights.bold,
    letterSpacing: 0.8,
  },
  correctionText: {
    flex: 1,
    minWidth: 0,
    color: t.colors.text.primary,
    fontFamily: t.typography.body,
    fontSize: 15.5,
    lineHeight: 24,
  },
  shortVersionBox: {
    marginTop: 32,
    backgroundColor: t.colors.surfaces.s200,
    borderWidth: 1,
    borderColor: t.colors.alpha.ink08,
    borderRadius: 15,
    paddingHorizontal: 28,
    paddingBottom: 28,
    paddingTop: 26,
  },
  sectionHeading: {
    marginTop: 44,
    color: t.colors.text.primary,
    fontFamily: t.typography.title,
    fontSize: 30,
    lineHeight: 36,
    fontWeight: t.fontWeights.heavy,
    letterSpacing: -0.6,
  },
  paragraph: {
    marginTop: 16,
    color: t.colors.ink,
    fontFamily: t.typography.body,
    fontSize: 19,
    lineHeight: 32,
  },
  runBold: { fontWeight: t.fontWeights.bold },
  runItalic: { fontStyle: 'italic' },
  runLink: {
    color: t.colors.text.greenOnLight,
    textDecorationLine: 'underline',
  },
  runStruck: {
    color: t.colors.text.muted,
    textDecorationLine: 'line-through',
  },
  runCorrectedLabel: {
    color: t.colors.omnibus.text,
    fontFamily: t.typography.mono,
    fontSize: 11,
    fontWeight: t.fontWeights.bold,
    letterSpacing: 0.7,
  },
  bullets: { marginTop: 16, gap: 10 },
  bulletRow: { flexDirection: 'row', gap: 10 },
  bulletDot: {
    color: t.colors.text.secondary,
    fontFamily: t.typography.body,
    fontSize: 19,
    lineHeight: 32,
  },
  bulletText: { flex: 1, marginTop: 0 },
  insetBox: {
    marginTop: 26,
    backgroundColor: t.colors.surfaces.s200,
    borderWidth: 1,
    borderColor: t.colors.alpha.ink08,
    borderRadius: 15,
    padding: 25,
  },
  insetLabel: {
    color: t.colors.text.secondary,
    fontFamily: t.typography.mono,
    fontSize: 10.5,
    fontWeight: t.fontWeights.bold,
    letterSpacing: 1.3,
  },
  insetBody: {
    marginTop: 13,
    color: t.colors.ink,
    fontFamily: t.typography.body,
    fontSize: 17.5,
    lineHeight: 29,
  },
  sourcesBlock: {
    marginTop: 44,
    paddingTop: 28,
    borderTopWidth: 1,
    borderTopColor: t.colors.alpha.ink10,
  },
  sourcesList: { marginTop: 16, gap: 13 },
  sourceItem: {
    color: t.colors.ink,
    fontFamily: t.typography.body,
    fontSize: 17,
    lineHeight: 27,
  },
  sourceNote: { color: t.colors.text.secondary },
  pdfRow: { marginTop: 24, flexDirection: 'row', alignItems: 'center', gap: 12, flexWrap: 'wrap' },
  pdfButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    backgroundColor: t.colors.surfaces.base,
    borderWidth: 1,
    borderColor: t.colors.alpha.ink16,
    borderRadius: 11,
    paddingVertical: 13,
    paddingHorizontal: 19,
  },
  pdfButtonText: {
    color: '#2c322c',
    fontFamily: t.typography.ui,
    fontSize: 15.5,
    fontWeight: t.fontWeights.bold,
  },
  pdfLink: { marginTop: 20, flexDirection: 'row', alignItems: 'center', gap: 8 },
  pdfLinkText: {
    color: t.colors.text.greenOnLight,
    fontFamily: t.typography.ui,
    fontSize: 14,
    fontWeight: t.fontWeights.bold,
  },
  pdfNote: {
    flex: 1,
    minWidth: 220,
    maxWidth: 520,
    color: t.colors.text.muted,
    fontFamily: t.typography.body,
    fontSize: 15,
    lineHeight: 23,
  },
});
