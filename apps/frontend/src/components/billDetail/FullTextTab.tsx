import { useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { theme as t } from '../../theme/tokens';
import { Bill } from '../../data/types';
import { useBillVersionText } from '../../hooks/useAppQueries';
import { useResponsive } from '../../hooks/useResponsive';
import {
  appropriationColumnLabels,
  asHeadingCaption,
  blockTexts,
  changeKindsPresent,
  parseChangeRuns,
  parseSectionBody,
  parseStructuredBody,
  SectionTable,
  sectionIndexLabel,
  splitSectionLabel,
  TextRun,
} from '../../lib/billText';
import { Skeleton } from '../Skeleton';
import { SectionIndexRail, SectionIndexItem } from './SectionIndexRail';
import { SourceLine } from './SourceLine';
import { isWeb } from './interactions';

// Where a jumped-to section comes to rest: far enough below the top of the
// window to clear the sticky tab bar and still read as the top of the page.
// scrollIntoView honours scroll-margin-top, so this one value sets the offset
// for our own jumps and for a browser-native anchor jump alike (web only; RN has
// no CSS scroll-margin). Cast out of the typed style union.
const SCROLL_MARGIN = { scrollMarginTop: 90 } as object;
const STICKY_RAIL = { position: 'sticky', top: 24 } as object;
// Ring drawn around the section a citation chip jumped to, so the landing spot
// reads as the answer to the click rather than just a tinted card. Web-only —
// RN has no spread-only shadow.
const HIT_RING = isWeb ? ({ boxShadow: '0 0 0 3px rgba(91,48,214,0.16)' } as object) : null;
const HIGHLIGHT_MS = 2500;
// How long to leave the render before re-asserting the scroll position.
const SCROLL_SETTLE_MS = 250;
// Any bill with something to navigate gets the index. Showing it from two
// sections up also holds the reading column in one place from bill to bill —
// with the rail conditional, moving between a long and a short bill slid the
// text sideways.
const RAIL_MIN_SECTIONS = 2;

// Bill Text tab — renders the current bill version's statute sections. Cited-
// section chips (Summary) deep-link here and highlight the matched section; a
// shared ?tab=text#ft-<id> URL scrolls to it on load (grounded-answers rule
// 5 — the location is URL-addressable). The same component renders on web and
// on the mobile single-scroll page.
//
// The Revisor's change markers arrive as words in the stored text; turning them
// back into strike-through / underline, and recovering the section and
// subdivision landmarks, both live in lib/billText.ts.

function ChangeRuns({ runs, style }: { runs: TextRun[]; style: object | object[] }) {
  return (
    <Text style={style}>
      {runs.map((run, i) => {
        if (run.kind === 'plain') return run.text;
        // Strike-through and underline alone convey the change by presentation
        // only. The label keeps it available to a screen reader, which would
        // otherwise hear the removed and added words as equal prose.
        return (
          <Text
            key={i}
            accessibilityLabel={
              run.kind === 'removed'
                ? `removed from current law: ${run.text}`
                : `added to current law: ${run.text}`
            }
            style={run.kind === 'removed' ? styles.removed : styles.added}
          >
            {run.text}
          </Text>
        );
      })}
    </Text>
  );
}

/**
 * An appropriation table, laid out as a table.
 *
 * The Legislature publishes a budget section as real `<table>` markup, and
 * flattening it to text put each cell on its own line — a dollar sign, then its
 * amount, then a second amount with nothing saying which year either belonged to
 * (#752). Ingestion now captures the rows, so:
 *
 * - the fiscal years sit above the figure columns they head, when the article
 *   published them (they live in the article's FIRST section, so they are carried
 *   in from there — never invented, and never shown when the column count
 *   disagrees);
 * - on a narrow screen the same row stacks, pairing each figure with its own year,
 *   because three columns of statute text and money do not fit on a phone.
 */
function AppropriationTable({ table, narrow }: { table: SectionTable; narrow: boolean }) {
  const { columnLabels, rows } = table;

  if (narrow) {
    return (
      <View style={styles.tableStack}>
        {rows.map((row, rowIndex) => {
          const [label, ...figures] = row;
          return (
            <View key={rowIndex} style={styles.stackRow}>
              {label.text ? (
                <ChangeRuns runs={parseChangeRuns(label.text)} style={styles.stackLabel} />
              ) : null}
              {figures.map((cell, figureIndex) =>
                cell.text ? (
                  <View key={figureIndex} style={styles.stackFigure}>
                    {columnLabels?.[figureIndex] ? (
                      <Text style={styles.stackYear}>{columnLabels[figureIndex]}</Text>
                    ) : null}
                    <ChangeRuns runs={parseChangeRuns(cell.text)} style={styles.stackValue} />
                  </View>
                ) : null,
              )}
            </View>
          );
        })}
      </View>
    );
  }

  return (
    <View style={styles.table}>
      {columnLabels ? (
        <View style={[styles.tableRow, styles.tableHeaderRow]}>
          <View style={styles.tableLabelCell} />
          {columnLabels.map((label, index) => (
            <View key={index} style={styles.tableFigureCell}>
              <Text style={styles.tableHeaderText}>{label}</Text>
            </View>
          ))}
        </View>
      ) : null}
      {rows.map((row, rowIndex) => (
        <View key={rowIndex} style={styles.tableRow}>
          {row.map((cell, cellIndex) => (
            <View
              key={cellIndex}
              style={cellIndex === 0 ? styles.tableLabelCell : styles.tableFigureCell}
            >
              <ChangeRuns
                runs={parseChangeRuns(cell.text)}
                style={[
                  styles.tableCellText,
                  cellIndex > 0 && styles.tableFigureText,
                  cell.align === 'center' && styles.tableCellCentre,
                ]}
              />
            </View>
          ))}
        </View>
      ))}
    </View>
  );
}

export function FullTextTab({
  bill,
  targetSectionId,
  onAnchorConsumed,
  updatedLabel,
}: {
  bill: Bill;
  targetSectionId?: string | null;
  onAnchorConsumed?: () => void;
  updatedLabel: string;
}) {
  const version = bill.versions.find((v) => v.isCurrent) ?? bill.versions[0];
  const versionCode = version?.versionCode;
  const { isDesktop, isMobile } = useResponsive();

  const query = useBillVersionText(bill.id, versionCode);
  const sections = query.data ?? [];
  const ready = query.isSuccess;

  // The section currently tinted after a jump; cleared on a timer.
  const [highlighted, setHighlighted] = useState<string | null>(null);
  // The section the reader is looking at, for the index rail's active row.
  const [activeSectionId, setActiveSectionId] = useState<string | null>(null);
  // The section a shared ?tab=text#ft-<id> link asked for, read once on the first
  // render. It has to be captured here rather than inside the effect that acts on
  // it: when the bill text is already cached the effect runs before the router
  // has applied the fragment, finds no hash, and — having no reason to run again
  // — gives up for good, which is why a shared link scrolled but never
  // highlighted its section.
  const [hashTarget] = useState<string | null>(() => {
    if (typeof window === 'undefined') return null;
    const match = window.location.hash.match(/^#(?:ft|section)-(.+)$/);
    return match ? match[1] : null;
  });

  // Sections the Summary tab quotes, so each one can say so — the intro promises
  // citations land on their passage, and nothing marked them before.
  const citedSectionIds = useMemo(
    () => new Set((bill.citations ?? []).map((c) => c.sectionId).filter(Boolean)),
    [bill.citations],
  );

  // An appropriation article states its fiscal years once, in its FIRST section,
  // and puts the figures they head in the sections after it — so a figure table
  // cannot label its own columns. Collected per article here, in source order, so
  // the years are known by the time a later section needs them (#752).
  const columnLabelsByArticle = useMemo(() => {
    const labels = new Map<string, string[]>();
    for (const section of sections) {
      if (!section.bodyBlocks?.length) continue;
      const key = section.articleHeading ?? '';
      if (labels.has(key)) continue;
      const years = appropriationColumnLabels(section.bodyBlocks);
      if (years) labels.set(key, years);
    }
    return labels;
  }, [sections]);

  const parsed = useMemo(
    () =>
      sections.map((section) => {
        const { number, title } = splitSectionLabel(section.heading);
        // Read the section's real landmarks where ingestion captured them
        // (`bodyBlocks`, #741); fall back to inferring them from the flattened
        // text on any section not yet re-read from the Revisor.
        const body = section.bodyBlocks?.length
          ? parseStructuredBody(section.bodyBlocks, {
              hasTitle: !!title,
              columnLabels: columnLabelsByArticle.get(section.articleHeading ?? '') ?? null,
            })
          : parseSectionBody(section.text ?? '', { hasTitle: !!title });
        // The Legislature's caption, wherever it was published: fused into the
        // stored heading on some bills, a subdivision headnote on others.
        const heading = title ?? asHeadingCaption(body.caption);
        return { section, number, heading, body };
      }),
    [sections, columnLabelsByArticle],
  );

  // Only claim the treatments this bill actually shows (grounded-answers rule 6).
  // A section re-read from the Revisor carries both marker kinds, so the legend
  // names the underline too; one still on the flattened text carries removals
  // only, and must not promise an underline the reader will never see.
  const changeKinds = useMemo(
    () =>
      changeKindsPresent(
        sections.flatMap((s) => (s.bodyBlocks?.length ? blockTexts(s.bodyBlocks) : [s.text])),
      ),
    [sections],
  );

  const indexItems: SectionIndexItem[] = useMemo(
    () =>
      parsed.map(({ section, number }) => ({
        sectionId: section.sectionId,
        number,
        label: sectionIndexLabel(section.heading, section.text ?? '', section.bodyBlocks),
        articleHeading: section.articleHeading,
      })),
    [parsed],
  );

  const showRail = isWeb && isDesktop && sections.length >= RAIL_MIN_SECTIONS;

  // Jump to a section. Three details each fix a way this lands in the wrong
  // place:
  //
  // - INSTANT, not smooth: a smooth scroll started in the same beat as a
  //   re-render gets dropped or interrupted part-way and stops short.
  // - scrollIntoView, not a computed window.scrollTo: this page scrolls an inner
  //   container rather than the document, so scrolling the window moves nothing
  //   at all. scrollIntoView finds the real scroll parent, and honours the
  //   target's scroll-margin-top, which is what sets the resting offset.
  // - Re-asserted once after the render settles, correcting any layout shift the
  //   first jump raced.
  const scrollToSection = (sectionId: string) => {
    if (typeof document === 'undefined') return;
    const jump = () => {
      document
        .getElementById(`ft-${sectionId}`)
        ?.scrollIntoView({ behavior: 'instant' as ScrollBehavior, block: 'start' });
    };
    jump();
    setTimeout(jump, SCROLL_SETTLE_MS);
  };

  // A citation chip asked us to jump: scroll + highlight after the sections have
  // painted, then release the anchor. Deferred a frame so layout has settled.
  useEffect(() => {
    if (!ready || !targetSectionId) return;
    const timer = setTimeout(() => {
      scrollToSection(targetSectionId);
      setHighlighted(targetSectionId);
      onAnchorConsumed?.();
    }, 60);
    return () => clearTimeout(timer);
    // onAnchorConsumed is a stable setter-wrapper from the parent.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, targetSectionId]);

  // Shared-link jump: a ?tab=text#ft-<id> (or #section-<id>) URL scrolls to that
  // section and highlights it, the same as arriving from a citation card. Runs
  // only when no in-app anchor is pending.
  useEffect(() => {
    if (!ready || targetSectionId || !hashTarget) return;
    const timer = setTimeout(() => {
      scrollToSection(hashTarget);
      setHighlighted(hashTarget);
    }, 80);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, hashTarget, targetSectionId]);

  // Clear the highlight tint a few seconds after it lands.
  useEffect(() => {
    if (!highlighted) return;
    const timer = setTimeout(() => setHighlighted(null), HIGHLIGHT_MS);
    return () => clearTimeout(timer);
  }, [highlighted]);

  // Track which section is in view for the index rail. IntersectionObserver is
  // the web-only route; RN's measurement APIs don't fire on document scroll.
  useEffect(() => {
    if (!showRail || !ready) return;
    if (typeof IntersectionObserver === 'undefined' || typeof document === 'undefined') return;

    const visible = new Map<string, number>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const id = entry.target.id.replace(/^ft-/, '');
          if (entry.isIntersecting) visible.set(id, entry.boundingClientRect.top);
          else visible.delete(id);
        }
        if (!visible.size) return;
        // The topmost section still on screen is the one being read.
        const [topId] = [...visible.entries()].sort((a, b) => a[1] - b[1])[0];
        setActiveSectionId(topId);
      },
      // Discount the sticky tab bar so a section counts as current only once it
      // has cleared it.
      { rootMargin: '-80px 0px -60% 0px', threshold: 0 },
    );

    for (const item of indexItems) {
      const node = document.getElementById(`ft-${item.sectionId}`);
      if (node) observer.observe(node);
    }
    return () => observer.disconnect();
  }, [showRail, ready, indexItems]);

  const source = <SourceLine updatedLabel={updatedLabel} />;

  if (!version || !versionCode) {
    return (
      <View>
        <Text style={styles.stateText}>Bill text is not available for this bill yet.</Text>
        {source}
      </View>
    );
  }

  if (query.isLoading) {
    return (
      <View>
        <Skeleton width={140} height={16} />
        <View style={styles.sections}>
          {[0, 1, 2].map((i) => (
            <View key={i} style={styles.card}>
              <Skeleton width={90} height={20} radius={t.radii.badge} />
              <View style={styles.skLines}>
                <Skeleton width="100%" height={13} />
                <Skeleton width="96%" height={13} />
                <Skeleton width="90%" height={13} />
              </View>
            </View>
          ))}
        </View>
      </View>
    );
  }

  if (query.isError) {
    return (
      <View>
        <Text style={styles.stateText}>
          We couldn’t load the full text right now. Please try again in a moment.
        </Text>
        {source}
      </View>
    );
  }

  if (sections.length === 0) {
    return (
      <View>
        <Text style={styles.stateText}>The full text for this version isn’t available yet.</Text>
        {source}
      </View>
    );
  }

  const column = (
    <View style={showRail ? styles.column : styles.columnAlone}>
      {/* "The complete text" is a claim, so it is checkable, not decorative.
          #776 removed the word while ingestion was dropping a section whenever a
          bill's page gave two sections the same id (#763), and #763 fixed the
          cause and restored all 64 sections. It went back in once
          scripts/check_bill_section_gaps.py printed OK against production, which
          it now does daily (.github/workflows/bill-section-gaps.yml). If that
          check ever goes red, this word comes out again in the same release —
          .claude/rules/grounded-answers.md rule 6 cuts both ways. See
          docs/product-onboarding/bill-text-tab-spec.md § 'The intro says "the
          complete text", and that is a checkable claim'. */}
      <Text style={styles.intro}>
        The complete text of this version, section by section, as published by the Minnesota
        Legislature. Cited sections from the summary link straight to their passage here.
      </Text>

      <ChangeLegend removed={changeKinds.removed} added={changeKinds.added} />

      <View style={styles.sections}>
        {parsed.map(({ section, number, heading, body }, i) => {
          const isHit = highlighted === section.sectionId;
          const isCited = citedSectionIds.has(section.sectionId);
          return (
            <View
              key={`${section.sectionId}-${i}`}
              nativeID={`ft-${section.sectionId}`}
              style={[styles.card, isHit && styles.cardHit, isHit && HIT_RING, SCROLL_MARGIN]}
            >
              {section.articleHeading?.trim() ? (
                <Text style={styles.eyebrow}>{section.articleHeading.trim()}</Text>
              ) : null}

              <View style={styles.badgeRow}>
                {number ? (
                  <View style={styles.numberBadge}>
                    <Text style={styles.numberBadgeText}>{number}</Text>
                  </View>
                ) : null}
                {isCited ? (
                  <View style={styles.citedBadge}>
                    <Text style={styles.citedBadgeText} numberOfLines={1}>
                      CITED IN SUMMARY
                    </Text>
                  </View>
                ) : null}
              </View>

              {/* Provenance, not the title: which existing law this section
                  rewrites. Sits above the title, quiet, so the Legislature's
                  own caption is the one heading on the card. */}
              {body.leadIn ? (
                <ChangeRuns runs={parseChangeRuns(body.leadIn)} style={styles.provenance} />
              ) : null}

              {heading ? (
                <Text accessibilityRole="header" style={styles.sectionHeading}>
                  {heading}
                </Text>
              ) : null}

              {body.blocks.map((block, blockIndex) => {
                if (block.kind === 'table' && block.table) {
                  return (
                    <AppropriationTable key={blockIndex} table={block.table} narrow={isMobile} />
                  );
                }
                const runs = parseChangeRuns(block.text);
                if (block.kind === 'subheading') {
                  return (
                    <ChangeRuns
                      key={blockIndex}
                      runs={runs}
                      style={[styles.subheading, blockIndex === 0 && styles.subheadingFirst]}
                    />
                  );
                }
                return (
                  <ChangeRuns
                    key={blockIndex}
                    runs={runs}
                    style={[
                      styles.bodyText,
                      block.kind === 'clause' && (isMobile ? styles.clauseNarrow : styles.clause),
                      block.kind === 'subclause' &&
                        (isMobile ? styles.subclauseNarrow : styles.subclause),
                    ]}
                  />
                );
              })}
            </View>
          );
        })}
      </View>

      {source}
    </View>
  );

  if (!showRail) return column;

  return (
    <View style={styles.grid}>
      {column}
      <View style={[styles.railCol, STICKY_RAIL]}>
        <SectionIndexRail
          items={indexItems}
          activeSectionId={activeSectionId}
          onSelect={scrollToSection}
        />
      </View>
    </View>
  );
}

// The key above the sections. Each item's sample word carries the very mark it
// explains — styles.removed / styles.added, the same two styles the section text
// uses — so the reader sees the treatment here instead of holding a description
// in their head while hunting for it below.
//
// Each item is gated on the mark being present in this version, so the key never
// points at something that appears nowhere on the page (grounded-answers rule 6);
// with neither present there is nothing to key, and the card does not render.
function ChangeLegend({ removed, added }: { removed: boolean; added: boolean }) {
  if (!removed && !added) return null;
  return (
    <View style={styles.legend}>
      {removed ? (
        <View style={styles.legendItem}>
          <Text style={[styles.legendSample, styles.removed]}>Struck text</Text>
          <Text style={styles.legendGloss}>is removed from current law</Text>
        </View>
      ) : null}
      {added ? (
        <View style={styles.legendItem}>
          <Text style={[styles.legendSample, styles.added]}>Underlined text</Text>
          <Text style={styles.legendGloss}>is added</Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', alignItems: 'flex-start', gap: 56 },
  // The reading measure. Uncapped, the text ran ~190 characters a line on a wide
  // window — roughly twice a comfortable line.
  column: { flex: 1, minWidth: 0, maxWidth: 880 },
  // A one-section bill has nothing to navigate, so it shows no rail. Centring
  // the measure is only safe here, where there is no other bill layout for it to
  // sit out of step with.
  columnAlone: { width: '100%', maxWidth: 880, alignSelf: 'center' },
  railCol: { width: 244, flexShrink: 0 },
  intro: {
    fontFamily: t.typography.body,
    fontSize: t.fontSizes.body,
    lineHeight: 23,
    color: t.colors.text.faint,
  },
  // Its own quiet panel, so the key reads as a key rather than as a third
  // sentence of the intro paragraph above it.
  legend: {
    marginTop: 16,
    paddingVertical: 11,
    paddingHorizontal: 15,
    backgroundColor: '#f7f9f8',
    borderWidth: 1,
    borderColor: t.colors.alpha.ink08,
    borderRadius: 11,
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 20,
  },
  legendItem: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 7 },
  legendSample: {
    fontFamily: t.typography.body,
    fontSize: t.fontSizes.meta,
    lineHeight: 20,
  },
  legendGloss: {
    fontFamily: t.typography.body,
    fontSize: t.fontSizes.meta,
    lineHeight: 20,
    color: t.colors.text.secondary,
    // Lets the gloss wrap its own words on a narrow phone instead of pushing
    // past the card edge.
    flexShrink: 1,
  },
  sections: { marginTop: 22, gap: 16 },
  card: {
    backgroundColor: t.colors.surfaces.base,
    borderWidth: 1,
    borderColor: t.colors.alpha.ink08,
    borderLeftWidth: 3,
    borderLeftColor: t.colors.alpha.ink08,
    borderRadius: t.radii.lg,
    paddingVertical: 18,
    paddingHorizontal: 20,
  },
  // Transient tint applied to a section a citation chip jumped to.
  cardHit: {
    backgroundColor: t.colors.purple.tint,
    borderColor: t.colors.purple.border,
    borderLeftColor: t.colors.purple.base,
  },
  eyebrow: {
    fontFamily: t.typography.mono,
    fontSize: t.fontSizes.label,
    fontWeight: t.fontWeights.bold,
    letterSpacing: 0.7,
    color: t.colors.text.muted,
    marginBottom: 8,
  },
  badgeRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  // The badge holds the section NUMBER only — the title is its own line below.
  numberBadge: {
    backgroundColor: t.colors.surfaces.s200,
    borderWidth: 1,
    borderColor: t.colors.alpha.ink08,
    borderRadius: t.radii.badge,
    paddingVertical: 3,
    paddingHorizontal: 9,
  },
  numberBadgeText: {
    fontFamily: t.typography.mono,
    fontSize: t.fontSizes.label,
    fontWeight: t.fontWeights.bold,
    letterSpacing: 0.3,
    color: t.colors.text.faint,
  },
  citedBadge: {
    backgroundColor: t.colors.purple.tint,
    borderWidth: 1,
    borderColor: t.colors.purple.border,
    borderRadius: t.radii.badge,
    paddingVertical: 3,
    paddingHorizontal: 9,
    // Keeps "CITED IN SUMMARY" on one line rather than wrapping mid-phrase.
    flexShrink: 0,
  },
  citedBadgeText: {
    fontFamily: t.typography.mono,
    fontSize: t.fontSizes.caption,
    fontWeight: t.fontWeights.bold,
    letterSpacing: 0.5,
    color: t.colors.purple.base,
  },
  sectionHeading: {
    marginTop: 6,
    fontFamily: t.typography.title,
    fontSize: t.fontSizes.subheadLg,
    fontWeight: t.fontWeights.bold,
    lineHeight: 26,
    color: t.colors.text.primary,
  },
  // "Minnesota Statutes 2024, section 62A.011 … is amended to read:" — a
  // reference, so it stays at body size and regular weight. Styled as a heading
  // it competed with the caption right below it and the card read as having two
  // titles.
  provenance: {
    marginTop: 10,
    fontFamily: t.typography.body,
    fontSize: t.fontSizes.small,
    lineHeight: 21,
    color: t.colors.text.faint,
  },
  // Subdivision headnote inside a section body — a lead-in line, never a
  // paragraph of its own.
  subheading: {
    marginTop: 7,
    fontFamily: t.typography.body,
    fontSize: t.fontSizes.body,
    fontWeight: t.fontWeights.bold,
    lineHeight: 22,
    color: t.colors.text.primary,
  },
  subheadingFirst: { marginTop: 12 },
  bodyText: {
    marginTop: 12,
    fontFamily: t.typography.body,
    fontSize: t.fontSizes.small,
    lineHeight: 24,
    color: t.colors.text.secondary,
  },
  // Hanging indent so "(1) … (15)" form a scannable column.
  clause: { paddingLeft: 46, textIndent: -18 } as object,
  // "(i) … (iii)" are children of the numbered clause above them, so they sit one
  // level deeper rather than flush left under an indented parent.
  subclause: { paddingLeft: 74, textIndent: -18 } as object,
  // The web indents would eat a sixth of a phone's reading width (46px of a
  // ~263px card), so the same structure reads at a narrower step on mobile.
  clauseNarrow: { paddingLeft: 26, textIndent: -14 } as object,
  subclauseNarrow: { paddingLeft: 44, textIndent: -14 } as object,
  // An appropriation table. Ruled rows rather than a full grid: money reads down a
  // column, so the vertical lines a full grid would add are noise, while a rule
  // under each row is what keeps a figure tied to its label across the gap.
  table: {
    marginTop: 14,
    borderTopWidth: 1,
    borderTopColor: t.colors.alpha.ink08,
  },
  tableRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    paddingVertical: 7,
    borderBottomWidth: 1,
    borderBottomColor: t.colors.alpha.ink08,
  },
  tableHeaderRow: { borderBottomColor: t.colors.alpha.ink08, paddingBottom: 5 },
  // The label carries statute prose and wraps; a figure never does, so the label
  // takes the slack.
  tableLabelCell: { flex: 2, minWidth: 0 },
  tableFigureCell: { flex: 1, minWidth: 0 },
  tableCellText: {
    fontFamily: t.typography.body,
    fontSize: t.fontSizes.small,
    lineHeight: 22,
    color: t.colors.text.secondary,
  },
  // Figures right-align so their digits line up down the column, which is the
  // whole reason to lay this out as a table.
  tableFigureText: { textAlign: 'right', fontVariant: ['tabular-nums'] },
  tableCellCentre: { textAlign: 'center' },
  tableHeaderText: {
    fontFamily: t.typography.mono,
    fontSize: t.fontSizes.label,
    fontWeight: t.fontWeights.bold,
    letterSpacing: 0.3,
    textAlign: 'right',
    color: t.colors.text.muted,
  },
  // Phone form: the row stacks, and each figure carries its own year, so the
  // header row is not needed and nothing depends on remembering column order.
  tableStack: { marginTop: 14, gap: 12 },
  stackRow: {
    gap: 4,
    paddingBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: t.colors.alpha.ink08,
  },
  stackLabel: {
    fontFamily: t.typography.body,
    fontSize: t.fontSizes.small,
    fontWeight: t.fontWeights.semibold,
    lineHeight: 21,
    color: t.colors.text.primary,
  },
  stackFigure: { flexDirection: 'row', alignItems: 'baseline', gap: 8 },
  stackYear: {
    fontFamily: t.typography.mono,
    fontSize: t.fontSizes.label,
    fontWeight: t.fontWeights.bold,
    letterSpacing: 0.3,
    color: t.colors.text.muted,
  },
  stackValue: {
    fontFamily: t.typography.body,
    fontSize: t.fontSizes.small,
    lineHeight: 21,
    color: t.colors.text.secondary,
    fontVariant: ['tabular-nums'],
  },
  removed: {
    textDecorationLine: 'line-through',
    color: t.colors.text.faint,
  },
  added: {
    textDecorationLine: 'underline',
    fontWeight: t.fontWeights.semibold,
    color: t.colors.text.primary,
    ...(isWeb ? ({ textUnderlineOffset: 3 } as object) : null),
  },
  skLines: { marginTop: 14, gap: 10 },
  stateText: {
    paddingVertical: 40,
    fontFamily: t.typography.body,
    fontSize: t.fontSizes.body,
    lineHeight: 23,
    color: t.colors.text.muted,
    textAlign: 'center',
  },
});
