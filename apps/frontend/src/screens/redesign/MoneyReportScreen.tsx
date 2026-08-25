import { useEffect, useMemo, useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';

import { useHover } from '../../components/billDetail/interactions';
import { SharePopover } from '../../components/billDetail/SharePopover';
import { useHistoryScrollRestoration } from '../../hooks/useHistoryScrollRestoration';
import { useResponsive } from '../../hooks/useResponsive';
import {
  reportBySlug,
  reportDatesLine,
  reportSectionAnchors,
  reportShareDescription,
  reportSharePanelDescription,
  type MoneyReport,
  type ReportBlock,
  type ReportInline,
  type ReportSection,
} from '../../lib/moneyReports';
import { publicPageUrl, type ShareContent } from '../../lib/share';
import { externalLinkProps, linkProps, routePath } from '../../navigation/links';
import type { RootScreenProps } from '../../navigation/types';
import { Container, Footer, PageBackground, TopNav } from '../../theme/primitives';
import { theme as t } from '../../theme/tokens';

/**
 * One published research report at /reports/{slug} — the one surface that
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
 * - The masthead carries the 2 dates and nothing else (Eugene, 20 Aug 2026). The
 *   author line, the filing bodies, and the undated-records note were removed
 *   from it; the sources block still names every filing body and the years each
 *   set of outside records covers.
 * - Links run one way. The report may link outward to record pages and official
 *   sources; nothing here writes report claims into any record surface.
 * - Share previews carry title and dates only (lib/share.ts
 *   moneyReportPageMetadata); the Share control's prepared text says the same.
 * - A correction replaces the wrong figure in the report's own text; the dated
 *   correction banner, when the report carries one, is the only trace, and a
 *   wrong number is never left readable (rule 13, Eugene 25 Aug 2026).
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

// How far below the top of the window a section comes to rest after a jump, so
// the heading is not flush against the edge and reads as the top of a page
// rather than as a link that missed. scrollIntoView and the browser's own
// fragment jump both honour scroll-margin-top, so this one value sets the
// offset for a rail click, a shared #link, and Back alike. Web only — React
// Native has no CSS scroll margin. Cast out of the typed style union.
const SCROLL_MARGIN = { scrollMarginTop: 24 } as object;

// A section counts as the one being read once its top has passed this line.
// Comfortably below SCROLL_MARGIN, so the section a reader just jumped to is
// the one the rail marks.
const ACTIVE_LINE = 140;

/**
 * Jump to a section in place, for the one case the browser cannot handle
 * itself: a page opened at a #section address, where the article has not
 * rendered yet when the browser looks for the target.
 *
 * Instant, not animated: a page someone has just opened at a #section address
 * should already be there, and the browser's own fragment jump — which is what
 * every rail click now uses — is instant too, so animating this one path would
 * be the odd one out. Nothing here animates, so prefers-reduced-motion has
 * nothing to reduce.
 *
 * A measured warning against reaching for `behavior: 'smooth'` here. Chrome
 * only advances a smooth scroll while the page is actually rendering, so in a
 * tab that is hidden or occluded the call returns having moved nothing, with no
 * error. This page's earlier rail cancelled its own anchor and then scrolled
 * that way, which made it look completely dead under automation (20 Aug 2026).
 * In a visible window the same call did scroll, so that is a caveat about
 * measuring, not the explanation for a reader seeing a rail do nothing.
 */
function jumpToAnchor(anchor: string) {
  if (!isWeb || typeof document === 'undefined') return;
  document.getElementById(anchor)?.scrollIntoView({ behavior: 'auto', block: 'start' });
}

/**
 * Which section the reader is in, for the rail's marked entry — web only, and
 * only while the rail is on screen.
 *
 * Recomputed from every section's position rather than from the entry that just
 * crossed, so exactly one is marked at every scroll position, including at the
 * top of the article and on a page opened at a #section address. The observer
 * is the signal that something crossed the line; the answer comes from the pass
 * over all of them.
 */
function useActiveSection(anchors: string[], enabled: boolean): string | null {
  const [active, setActive] = useState<string | null>(anchors[0] ?? null);

  useEffect(() => {
    if (!enabled || !isWeb || typeof document === 'undefined') return;
    if (typeof IntersectionObserver === 'undefined') return;

    const pick = () => {
      let current = anchors[0] ?? null;
      for (const anchor of anchors) {
        const node = document.getElementById(anchor);
        if (node && node.getBoundingClientRect().top <= ACTIVE_LINE) current = anchor;
      }
      setActive(current);
    };

    const observer = new IntersectionObserver(pick, {
      rootMargin: `-${ACTIVE_LINE}px 0px 0px 0px`,
      threshold: 0,
    });
    for (const anchor of anchors) {
      const node = document.getElementById(anchor);
      if (node) observer.observe(node);
    }
    pick();
    return () => observer.disconnect();
  }, [anchors, enabled]);

  return enabled ? active : null;
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
        }
      })}
    </>
  );
}

function Blocks({ blocks }: { blocks: ReportBlock[] }) {
  return (
    <>
      {blocks.map((block, index) => {
        if (block.kind === 'paragraph') {
          return (
            <Text key={index} style={styles.paragraph}>
              <InlineRuns runs={block.runs} />
            </Text>
          );
        }
        if (block.kind === 'table') {
          return <BlockTable key={index} columns={block.columns} rows={block.rows} />;
        }
        return (
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
        );
      })}
    </>
  );
}

/**
 * A report's table. Marked up as a real table so a screen reader announces each
 * figure with its column, and scrollable on its own so a long row never pushes
 * the page sideways.
 */
function BlockTable({ columns, rows }: { columns: string[]; rows: string[][] }) {
  return (
    <View style={styles.tableScroll}>
      <View role="table" style={styles.table}>
        <View role="row" style={[styles.tableRow, styles.tableHeadRow]}>
          {columns.map((column, index) => (
            <Text
              key={column}
              role="columnheader"
              style={[styles.tableHeadCell, index > 0 && styles.tableCellNumeric]}
            >
              {column}
            </Text>
          ))}
        </View>
        {rows.map((row) => (
          <View role="row" key={row[0]} style={styles.tableRow}>
            {row.map((cell, index) => (
              <Text
                key={index}
                role="cell"
                style={[styles.tableCell, index > 0 && styles.tableCellNumeric]}
              >
                {cell}
              </Text>
            ))}
          </View>
        ))}
      </View>
    </View>
  );
}

function SectionView({ section, anchor }: { section: ReportSection; anchor: string }) {
  return (
    <View nativeID={anchor} style={SCROLL_MARGIN as never}>
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

/**
 * The contents list: one ordinary link per section, in document order, built
 * from the report's own sections so it cannot list a section the article does
 * not have.
 *
 * The click is left to the browser on purpose — no onPress, so nothing cancels
 * the anchor. That is what puts `#the-one-way-valve` in the address bar, makes
 * Back return the reader, and does the scrolling itself, honouring the target's
 * scroll-margin-top. The previous version cancelled the anchor and scrolled by
 * hand, which threw all of that away: it moved the page and left the address
 * bar untouched, so no section here could be linked to (grounded-answers rule 5
 * — anything linked to must be URL-addressable).
 */
function ContentsLinks({
  report,
  anchors,
  activeAnchor,
  compact,
}: {
  report: MoneyReport;
  anchors: string[];
  activeAnchor?: string | null;
  compact?: boolean;
}) {
  return (
    <View
      accessibilityRole={isWeb ? ('navigation' as 'none') : undefined}
      accessibilityLabel="Sections in this report"
      style={compact ? styles.contentsListCompact : styles.contentsList}
    >
      {report.sections.map((section, index) => (
        <ContentsLink
          key={anchors[index]}
          anchor={anchors[index]}
          label={section.railLabel}
          active={anchors[index] === activeAnchor}
        />
      ))}
    </View>
  );
}

function ContentsLink({
  anchor,
  label,
  active,
}: {
  anchor: string;
  label: string;
  active: boolean;
}) {
  const [hovered, hoverProps] = useHover();
  return (
    <Pressable
      {...hoverProps}
      accessibilityRole="link"
      // Marks the reader's place for assistive technology too, not only in ink.
      aria-current={active ? 'location' : undefined}
      {...(isWeb ? { href: `#${anchor}` } : { onPress: () => jumpToAnchor(anchor) })}
    >
      <Text
        style={[
          styles.contentsLink,
          hovered && styles.contentsLinkHovered,
          active && styles.contentsLinkActive,
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

export function MoneyReportScreen({ navigation, route }: RootScreenProps<'MoneyReport'>) {
  const { isMobile } = useResponsive();
  // Back out of a #section address should return the reader to where they were
  // reading, not to the top. The browser cannot do it here — the page scrolls
  // an inner container, not the document — so this is the shared hook that
  // saves the position against the exact history entry.
  const scrollRestoration = useHistoryScrollRestoration();
  const report = reportBySlug(route.params.slug);

  // One list of section link targets, read by both the rail and the article.
  const anchors = useMemo(() => reportSectionAnchors(report?.sections ?? []), [report]);
  const activeAnchor = useActiveSection(anchors, !isMobile);

  // A page opened at /reports/{slug}#{section} has to jump itself: the article
  // is drawn by JavaScript, so when the browser looks for the fragment's target
  // on load there is nothing there yet. Read once on the first render, then
  // re-asserted after the layout settles.
  const [openingAnchor] = useState(() =>
    isWeb && typeof window !== 'undefined' ? window.location.hash.replace(/^#/, '') : '',
  );
  useEffect(() => {
    if (!openingAnchor || !anchors.includes(openingAnchor)) return;
    const jump = () => jumpToAnchor(openingAnchor);
    const first = setTimeout(jump, 0);
    const settled = setTimeout(jump, 250);
    return () => {
      clearTimeout(first);
      clearTimeout(settled);
    };
  }, [openingAnchor, anchors]);

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
    previewDescription: reportSharePanelDescription(report),
    url: publicPageUrl(routePath.moneyReport(report.slug)),
  };

  return (
    <PageBackground>
      <ScrollView {...scrollRestoration} contentContainerStyle={styles.page}>
        <TopNav onHome={() => navigation.navigate('Tabs', { screen: 'Home' })} />

        <Container style={[styles.main, isMobile && styles.mainMobile]}>
          <Pressable
            {...linkProps(routePath.moneyReports(), () => navigation.navigate('MoneyReports'))}
            style={styles.backLink}
          >
            <BackChevron />
            <Text style={styles.backLinkText}>Campaign money reports</Text>
          </Pressable>

          <View style={[styles.grid, isMobile && styles.gridMobile]}>
            {!isMobile ? (
              <View style={[styles.rail, webSticky as never]}>
                <Text style={styles.railLabel}>CONTENTS</Text>
                <ContentsLinks report={report} anchors={anchors} activeAnchor={activeAnchor} />
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
                  <Text style={styles.mastheadLineMuted}>{reportDatesLine(report)}</Text>
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
                  <ContentsLinks report={report} anchors={anchors} compact />
                </View>
              ) : null}

              <View style={styles.shortVersionBox}>
                <Text style={[styles.insetLabel, styles.shortVersionLabel]}>SHORT VERSION</Text>
                <Blocks blocks={report.shortVersion} />
              </View>

              {report.sections.map((section, index) => (
                <SectionView key={anchors[index]} section={section} anchor={anchors[index]} />
              ))}

              <View style={styles.sourcesBlock}>
                <Text style={styles.insetLabel}>WHERE THESE NUMBERS COME FROM</Text>
                <View style={styles.sourcesList}>
                  {report.sources.map((source, index) => (
                    <Text key={index} style={styles.sourceItem}>
                      <Text>{source.text} </Text>
                      {source.note ? <Text>{source.note} </Text> : null}
                      {source.noteLink ? (
                        <Text {...externalLinkProps(source.noteLink.href)} style={styles.runLink}>
                          {source.noteLink.text}
                        </Text>
                      ) : null}
                    </Text>
                  ))}
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
  // Literal inks from the report design: resting #4b524b, and #11150f for the
  // section being read and for hover. The ink ramp has no role name for either
  // shade at this weight, and the rest of this screen names its mockup colours
  // the same way.
  contentsLink: {
    color: '#4b524b',
    fontFamily: t.typography.ui,
    fontSize: 14,
    lineHeight: 19,
  },
  contentsLinkHovered: { color: '#11150f' },
  contentsLinkActive: { color: '#11150f', fontWeight: t.fontWeights.heavy },
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
    backgroundColor: t.colors.cyan.surface,
    borderWidth: 1,
    borderColor: t.colors.cyan.border,
    borderRadius: 15,
    paddingHorizontal: 28,
    paddingBottom: 28,
    paddingTop: 26,
  },
  shortVersionLabel: { color: t.colors.cyan.ink },
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
  tableScroll: { marginTop: 22, overflow: 'scroll' },
  table: {
    borderWidth: 1,
    borderColor: t.colors.alpha.ink08,
    borderRadius: 12,
    overflow: 'hidden',
    minWidth: 320,
  },
  tableRow: {
    flexDirection: 'row',
    borderTopWidth: 1,
    borderTopColor: t.colors.alpha.ink08,
  },
  tableHeadRow: { borderTopWidth: 0, backgroundColor: t.colors.surfaces.s200 },
  tableHeadCell: {
    flex: 1,
    paddingVertical: 12,
    paddingHorizontal: 16,
    color: t.colors.text.secondary,
    fontFamily: t.typography.mono,
    fontSize: 11,
    fontWeight: t.fontWeights.bold,
    letterSpacing: 0.7,
    textTransform: 'uppercase',
  },
  tableCell: {
    flex: 1,
    paddingVertical: 13,
    paddingHorizontal: 16,
    color: t.colors.text.primary,
    fontFamily: t.typography.body,
    fontSize: 16,
    lineHeight: 24,
  },
  tableCellNumeric: { flex: 0, minWidth: 140, textAlign: 'right' },
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
});
