import { useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { theme as t } from '../../theme/tokens';
import { Bill } from '../../data/types';
import { useBillVersionText } from '../../hooks/useAppQueries';
import { useResponsive } from '../../hooks/useResponsive';
import {
  asHeadingCaption,
  changeKindsPresent,
  parseChangeRuns,
  parseSectionBody,
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
const SCROLL_OFFSET = 90;
// The same offset for a browser-native anchor jump, which doesn't route through
// our scroll handler (web only; RN has no CSS scroll-margin). Cast out of the
// typed style union.
const SCROLL_MARGIN = { scrollMarginTop: SCROLL_OFFSET } as object;
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

  // Sections the Summary tab quotes, so each one can say so — the intro promises
  // citations land on their passage, and nothing marked them before.
  const citedSectionIds = useMemo(
    () => new Set((bill.citations ?? []).map((c) => c.sectionId).filter(Boolean)),
    [bill.citations],
  );

  const parsed = useMemo(
    () =>
      sections.map((section) => {
        const { number, title } = splitSectionLabel(section.heading);
        const body = parseSectionBody(section.text ?? '', { hasTitle: !!title });
        // The Legislature's caption, wherever it was published: fused into the
        // stored heading on some bills, loose in the body on others.
        const heading = title ?? asHeadingCaption(body.caption);
        return { section, number, heading, body };
      }),
    [sections],
  );

  // Only claim the treatments this bill actually shows. Ingestion currently
  // strips the "new text" markers, so most bills carry removals only and the
  // legend must not promise an underline the reader will never see
  // (grounded-answers rule 6).
  const changeKinds = useMemo(() => changeKindsPresent(sections.map((s) => s.text)), [sections]);

  const indexItems: SectionIndexItem[] = useMemo(
    () =>
      parsed.map(({ section, number }) => ({
        sectionId: section.sectionId,
        number,
        label: sectionIndexLabel(section.heading, section.text ?? ''),
        articleHeading: section.articleHeading,
      })),
    [parsed],
  );

  const showRail = isWeb && isDesktop && sections.length >= RAIL_MIN_SECTIONS;

  // Jump to a section. Three details each fix a way this lands in the wrong
  // place: the scroll is INSTANT, because a smooth scroll started in the same
  // beat as a re-render gets dropped or interrupted part-way and stops short;
  // the target is measured immediately before scrolling, because a rect read
  // before the re-render is stale by however much the layout moved; and the
  // position is re-asserted once after the render settles, which corrects any
  // shift the first jump raced.
  const scrollToSection = (sectionId: string) => {
    if (typeof document === 'undefined' || typeof window === 'undefined') return;
    const jump = () => {
      const node = document.getElementById(`ft-${sectionId}`);
      if (!node) return;
      const top = node.getBoundingClientRect().top + window.scrollY - SCROLL_OFFSET;
      window.scrollTo({ top: Math.max(0, top), behavior: 'instant' as ScrollBehavior });
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

  // Shared-link jump: a ?tab=text#ft-<id> (or #section-<id>) URL scrolls to
  // that section once on load. Runs only when no in-app anchor is pending.
  useEffect(() => {
    if (!ready || targetSectionId) return;
    if (typeof window === 'undefined' || typeof document === 'undefined') return;
    const match = window.location.hash.match(/^#(?:ft|section)-(.+)$/);
    if (!match) return;
    const id = match[1];
    const timer = setTimeout(() => {
      scrollToSection(id);
      setHighlighted(id);
    }, 80);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);

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

  const legend = changeLegend(changeKinds);

  const column = (
    <View style={showRail ? styles.column : styles.columnAlone}>
      <Text style={styles.intro}>
        The complete text of this version, section by section, as published by the Minnesota
        Legislature. Cited sections from the summary link straight to their passage here.
      </Text>

      {legend ? <Text style={styles.legend}>{legend}</Text> : null}

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

/** The legend above the sections, naming only the treatments this bill shows. */
function changeLegend({ removed, added }: { removed: boolean; added: boolean }): string | null {
  if (removed && added) {
    return 'Struck text is removed from current law · underlined text is added';
  }
  if (removed) return 'Struck text is removed from current law';
  if (added) return 'Underlined text is added to current law';
  return null;
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
  legend: {
    marginTop: 10,
    fontFamily: t.typography.body,
    fontSize: t.fontSizes.meta,
    lineHeight: 20,
    color: t.colors.text.muted,
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
