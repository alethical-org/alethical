import { useEffect, useRef, useState } from 'react';
import { GestureResponderEvent, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';

import { Bill } from '../../data/types';
import { usePrefetchBill } from '../../hooks/useAppQueries';
import { titleCaseIssue } from '../../lib/issues';
import { theme as t } from '../../theme/tokens';

const isWeb = Platform.OS === 'web';

// Bill card for the redesigned Search Bills screen (docs/mockups/search-bills).
// The whole card links to the bill detail; Track / author / roll-calls sit above
// it (stopPropagation) so they stay independently clickable.

type BillCardData = Pick<
  Bill,
  | 'id'
  | 'identifier'
  | 'title'
  | 'status'
  | 'isOmnibus'
  | 'updatedAt'
  | 'aiAnalysis'
  | 'chiefSponsorIds'
  | 'rollCallCount'
  | 'actions'
> & { sponsorNames?: string[]; coAuthorCount?: number };

interface BillResultCardProps {
  bill: BillCardData;
  tracked?: boolean;
  onPress?: () => void;
  onToggleTrack?: () => void;
  onSponsorPress?: (legislatorId: string) => void;
  onRollCalls?: () => void;
}

type Tone = 'neutral' | 'green' | 'vetoed';

// Derive the 5-stage progress + tone from the bill's status text (client-side, so
// the bar always agrees with the status label shown — no #295 dependency).
// Stages: Introduced 0 · In Committee 1 · Passed House 2 · Passed Senate 3 · Signed 4.
function billStage(status: string): { index: number; tone: Tone } {
  const s = status.toLowerCase();
  if (s.includes('veto')) return { index: 4, tone: 'vetoed' };
  if (s.includes('signed') || s.includes('law') || s.includes('enacted'))
    return { index: 4, tone: 'green' };
  if (s.includes('senate')) return { index: 3, tone: 'neutral' };
  if (s.includes('house')) return { index: 2, tone: 'neutral' };
  if (s.includes('committee')) return { index: 1, tone: 'neutral' };
  return { index: 0, tone: 'neutral' };
}

function ProgressBar({ index, tone }: { index: number; tone: Tone }) {
  return (
    <View style={styles.progress}>
      {[0, 1, 2, 3, 4].map((i) => {
        let color = t.colors.status.progressEmpty;
        if (tone === 'vetoed') {
          color = i < 4 ? t.colors.brand.base : t.colors.status.vetoedStep;
        } else if (i <= index) {
          color = t.colors.brand.base;
        }
        return <View key={i} style={[styles.progressStep, { backgroundColor: color }]} />;
      })}
    </View>
  );
}

// Prominent OMNIBUS indicator: amber pill with a small capitol/gavel glyph, shown
// in the card's top row (after the code badge) only for omnibus bills.
function OmnibusPill() {
  return (
    <View style={styles.omnibus} accessibilityRole="text" accessibilityLabel="Omnibus bill">
      <Svg width={12} height={12} viewBox="0 0 24 24" fill="none">
        <Path
          d="M12 4 v16 M6 8 h12 M7 8 l-3 6 h6 Z M17 8 l-3 6 h6 Z"
          stroke={t.colors.omnibus.text}
          strokeWidth={1.9}
          strokeLinejoin="round"
        />
      </Svg>
      <Text style={styles.omnibusText}>OMNIBUS</Text>
    </View>
  );
}

export function BillResultCard({
  bill,
  tracked = false,
  onPress,
  onToggleTrack,
  onSponsorPress,
  onRollCalls,
}: BillResultCardProps) {
  const [hovered, setHovered] = useState(false);
  const prefetchBill = usePrefetchBill();
  // Warm the bill-detail cache the instant the card shows navigation intent so
  // the detail page opens without its "Loading bill…" spinner.
  const warm = () => prefetchBill(bill.id);
  // Full statutory title as a web hover tooltip. RN-Web drops the `title` prop, so
  // set it on the DOM node directly; aria-label carries it for screen readers.
  const titleRef = useRef<Text>(null);
  useEffect(() => {
    if (isWeb && titleRef.current) {
      (titleRef.current as unknown as HTMLElement).title = bill.title;
    }
  }, [bill.title]);
  const summary = bill.aiAnalysis?.summary ?? bill.title;
  const policyAreas = bill.aiAnalysis?.policyAreas ?? [];
  const { index, tone } = billStage(bill.status);
  const statusColor =
    tone === 'green'
      ? t.colors.brand.deep
      : tone === 'vetoed'
        ? t.colors.status.vetoedText
        : t.colors.text.secondary;
  const sponsors = (bill.sponsorNames ?? []).map((name, i) => ({
    name,
    legislatorId: bill.chiefSponsorIds[i],
  }));
  const latestAction = bill.actions?.[bill.actions.length - 1];
  const actionDate =
    latestAction?.date ?? (bill.updatedAt && bill.updatedAt !== 'Unknown' ? bill.updatedAt : null);

  return (
    <Pressable
      accessibilityRole="link"
      onPress={onPress}
      onPressIn={warm}
      onHoverIn={() => {
        setHovered(true);
        warm();
      }}
      onHoverOut={() => setHovered(false)}
      style={[styles.card, hovered && styles.cardHover]}
    >
      <View style={styles.topRow}>
        <View style={styles.badge}>
          <Text style={styles.badgeText}>{bill.identifier}</Text>
        </View>
        {bill.isOmnibus ? <OmnibusPill /> : null}
        <Text style={[styles.statusLabel, { color: statusColor }]}>{bill.status}</Text>
        <ProgressBar index={index} tone={tone} />
        <View style={styles.topSpacer} />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={tracked ? 'Tracking bill' : 'Track bill'}
          onPress={(e: GestureResponderEvent) => {
            e.stopPropagation();
            onToggleTrack?.();
          }}
          style={[styles.trackBtn, tracked ? styles.trackBtnOn : styles.trackBtnOff]}
        >
          <Text style={tracked ? styles.trackTextOn : styles.trackTextOff}>
            {tracked ? '✓ Tracking' : '+ Track'}
          </Text>
        </Pressable>
      </View>

      <Text
        ref={titleRef}
        style={styles.title}
        // Only clamp when falling back to the long statutory title — the
        // AI-generated short title is already short and shouldn't get an
        // ellipsis just because it wraps to 3 lines on a narrow viewport.
        numberOfLines={bill.aiAnalysis?.shortTitle ? undefined : 2}
        accessibilityLabel={bill.title}
      >
        {bill.aiAnalysis?.shortTitle ?? bill.title}
      </Text>

      <Text style={styles.summary}>{summary}</Text>

      <View style={styles.meta}>
        <View style={styles.authorRow}>
          <Text style={styles.metaText}>Author: </Text>
          {sponsors.length > 0 ? (
            sponsors.map((sponsor, i) => {
              const clickable = Boolean(sponsor.legislatorId && onSponsorPress);
              return (
                <Pressable
                  key={`${sponsor.legislatorId ?? sponsor.name}-${i}`}
                  accessibilityRole={clickable ? 'link' : undefined}
                  disabled={!clickable}
                  onPress={(e: GestureResponderEvent) => {
                    e.stopPropagation();
                    if (sponsor.legislatorId) onSponsorPress?.(sponsor.legislatorId);
                  }}
                >
                  <Text style={[styles.metaText, clickable && styles.authorLink]}>
                    {sponsor.name}
                    {i < sponsors.length - 1 ? ', ' : ''}
                  </Text>
                </Pressable>
              );
            })
          ) : (
            <Text style={styles.metaText}>Unavailable</Text>
          )}
          {bill.coAuthorCount && bill.coAuthorCount > 0 ? (
            <Text style={styles.metaText}> · +{bill.coAuthorCount} co-authors</Text>
          ) : null}
        </View>
        {actionDate ? (
          <Text style={styles.metaText}>
            Latest action{latestAction?.description ? `: ${latestAction.description}` : ''} ·{' '}
            {actionDate}
          </Text>
        ) : null}
        <View style={styles.tagRow}>
          {policyAreas.map((topic) => (
            <View key={topic} style={styles.tag}>
              <Text style={styles.tagText}>{titleCaseIssue(topic)}</Text>
            </View>
          ))}
          {bill.rollCallCount > 0 ? (
            <Pressable
              accessibilityRole="link"
              onPress={(e: GestureResponderEvent) => {
                e.stopPropagation();
                onRollCalls?.();
              }}
              style={styles.rollCalls}
            >
              <Text style={styles.rollCallsText}>
                {bill.rollCallCount} roll {bill.rollCallCount === 1 ? 'call' : 'calls'}
              </Text>
            </Pressable>
          ) : null}
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: t.colors.surfaces.base,
    borderWidth: 1,
    borderColor: t.colors.alpha.ink08,
    borderRadius: 18,
    paddingVertical: 26,
    paddingHorizontal: 30,
    gap: 12,
    ...(t.shadows.card as object),
    ...(isWeb
      ? ({ transitionProperty: 'border-color, box-shadow', transitionDuration: '0.15s' } as object)
      : null),
  },
  cardHover: {
    borderColor: 'rgba(45,212,126,0.55)',
    ...(t.shadows.lg as object),
  },
  topRow: { flexDirection: 'row', alignItems: 'center', gap: 14, flexWrap: 'wrap' },
  topSpacer: { flex: 1 },
  badge: {
    backgroundColor: t.colors.omnibus.fill,
    borderWidth: 1,
    borderColor: t.colors.omnibus.border,
    borderRadius: t.radii.badge,
    paddingVertical: 5,
    paddingHorizontal: 10,
  },
  badgeText: {
    fontFamily: t.typography.mono,
    fontSize: t.fontSizes.meta,
    fontWeight: t.fontWeights.bold,
    letterSpacing: 0.4,
    color: t.colors.omnibus.text,
  },
  omnibus: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: t.colors.omnibus.fill,
    borderWidth: 1,
    borderColor: t.colors.omnibus.border,
    borderRadius: 8,
    paddingVertical: 6,
    paddingHorizontal: 12,
  },
  omnibusText: {
    fontFamily: t.typography.ui,
    fontSize: 11,
    fontWeight: t.fontWeights.bold,
    letterSpacing: 0.88,
    color: t.colors.omnibus.text,
  },
  statusLabel: {
    fontFamily: t.typography.ui,
    fontSize: t.fontSizes.meta,
    fontWeight: t.fontWeights.bold,
    letterSpacing: 0.3,
  },
  progress: { flexDirection: 'row', gap: 4 },
  progressStep: { width: 30, height: 7, borderRadius: 4 },
  trackBtn: { borderRadius: t.radii.sm, paddingVertical: 9, paddingHorizontal: 15 },
  trackBtnOff: { backgroundColor: t.colors.ink },
  trackBtnOn: { backgroundColor: t.colors.brand.base },
  trackTextOff: {
    fontFamily: t.typography.ui,
    fontSize: t.fontSizes.small,
    fontWeight: t.fontWeights.bold,
    color: t.colors.white,
  },
  trackTextOn: {
    fontFamily: t.typography.ui,
    fontSize: t.fontSizes.small,
    fontWeight: t.fontWeights.bold,
    color: t.colors.text.onGreen,
  },
  title: {
    fontFamily: t.typography.title,
    fontSize: t.fontSizes.h2,
    fontWeight: t.fontWeights.heavy,
    lineHeight: 31,
    color: t.colors.text.primary,
    maxWidth: 1040,
  },
  summary: {
    fontFamily: t.typography.body,
    fontSize: t.fontSizes.bodyLg,
    lineHeight: 24,
    color: t.colors.text.secondary,
    maxWidth: 1040,
  },
  meta: {
    borderTopWidth: 1,
    borderTopColor: t.colors.alpha.ink08,
    paddingTop: 12,
    gap: 11,
  },
  authorRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'baseline' },
  metaText: {
    fontFamily: t.typography.body,
    fontSize: t.fontSizes.small,
    lineHeight: 21,
    color: t.colors.text.secondary,
  },
  authorLink: { color: t.colors.brand.deep, fontWeight: t.fontWeights.bold },
  tagRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 },
  tag: {
    backgroundColor: t.colors.surfaces.s400,
    borderRadius: t.radii.sm,
    paddingVertical: 6,
    paddingHorizontal: 12,
  },
  tagText: {
    fontFamily: t.typography.ui,
    fontSize: t.fontSizes.label,
    fontWeight: t.fontWeights.bold,
    letterSpacing: 0.7,
    color: t.colors.text.secondary,
  },
  rollCalls: {
    backgroundColor: t.colors.tint.t150,
    borderWidth: 1,
    borderColor: t.colors.tint.border,
    borderRadius: t.radii.sm,
    paddingVertical: 6,
    paddingHorizontal: 12,
  },
  rollCallsText: {
    fontFamily: t.typography.ui,
    fontSize: t.fontSizes.label,
    fontWeight: t.fontWeights.bold,
    letterSpacing: 0.4,
    color: t.colors.brand.deep,
  },
});
