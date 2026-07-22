import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { theme as t } from '../../theme/tokens';
import { Bill } from '../../data/types';
import { useBillVersionText } from '../../hooks/useAppQueries';
import { Skeleton } from '../Skeleton';
import { SourceLine } from './SourceLine';

// scroll-margin-top keeps a jumped-to section clear of the sticky tab bar
// (web only; RN has no CSS scroll-margin). Cast out of the typed style union.
const SCROLL_MARGIN = { scrollMarginTop: 80 } as object;
const HIGHLIGHT_MS = 2500;

// Full Text tab — renders the current bill version's statute sections. Cited-
// section chips (Summary) deep-link here and highlight the matched section; a
// shared ?tab=fulltext#ft-<id> URL scrolls to it on load (grounded-answers rule
// 5 — the location is URL-addressable). The same component renders on web and
// on the mobile single-scroll page.

// Statute source text carries long runs of blank lines between subdivision
// headnotes and their bodies; collapse them to a single paragraph break (and
// drop trailing spaces) so the rendered section reads cleanly instead of with
// large vertical gaps.
function cleanSectionText(raw: string): string {
  return raw
    .replace(/[ \t]+$/gm, '')
    .replace(/\n{2,}/g, '\n\n')
    .trim();
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

  const query = useBillVersionText(bill.id, versionCode);
  const sections = query.data ?? [];
  const ready = query.isSuccess;

  // The section currently tinted after a jump; cleared on a timer.
  const [highlighted, setHighlighted] = useState<string | null>(null);

  const scrollToSection = (sectionId: string) => {
    if (typeof document === 'undefined') return;
    document
      .getElementById(`ft-${sectionId}`)
      ?.scrollIntoView({ behavior: 'auto', block: 'start' });
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

  // Shared-link jump: a ?tab=fulltext#ft-<id> (or #section-<id>) URL scrolls to
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

  const source = (
    <SourceLine text={`Source: Minnesota Legislature · revisor.mn.gov · ${updatedLabel}`} />
  );

  if (!version || !versionCode) {
    return (
      <View>
        <Text style={styles.stateText}>Full text is not available for this bill yet.</Text>
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

  return (
    <View>
      <Text style={styles.intro}>
        The complete text of this version, section by section, as published by the Minnesota
        Legislature. Cited sections from the summary link straight to their passage here.
      </Text>

      <View style={styles.sections}>
        {sections.map((section, i) => {
          const isHit = highlighted === section.sectionId;
          const label = section.heading?.trim() || `§ ${section.sectionId}`;
          return (
            <View
              key={`${section.sectionId}-${i}`}
              nativeID={`ft-${section.sectionId}`}
              style={[styles.card, isHit && styles.cardHit, SCROLL_MARGIN]}
            >
              {section.articleHeading?.trim() ? (
                <Text style={styles.eyebrow}>{section.articleHeading.trim()}</Text>
              ) : null}
              <View style={styles.labelChipRow}>
                <View style={styles.labelChip}>
                  <Text style={styles.labelChipText}>{label}</Text>
                </View>
              </View>
              <Text style={styles.bodyText}>{cleanSectionText(section.text)}</Text>
            </View>
          );
        })}
      </View>

      {source}
    </View>
  );
}

const styles = StyleSheet.create({
  intro: {
    fontFamily: t.typography.body,
    fontSize: t.fontSizes.body,
    lineHeight: 23,
    color: t.colors.text.faint,
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
  labelChipRow: { flexDirection: 'row' },
  labelChip: {
    backgroundColor: t.colors.purple.tint,
    borderWidth: 1,
    borderColor: t.colors.purple.border,
    borderRadius: t.radii.badge,
    paddingVertical: 3,
    paddingHorizontal: 9,
  },
  labelChipText: {
    fontFamily: t.typography.mono,
    fontSize: t.fontSizes.meta,
    fontWeight: t.fontWeights.bold,
    letterSpacing: 0.3,
    color: t.colors.purple.base,
  },
  bodyText: {
    marginTop: 12,
    fontFamily: t.typography.body,
    fontSize: t.fontSizes.small,
    lineHeight: 24,
    color: t.colors.text.secondary,
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
