import { useEffect, useRef } from 'react';
import { Animated, Easing, Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';

import { ChangeBlock } from '../ChangeBlock';
import { Skeleton } from '../Skeleton';
import { isWeb, useHover } from '../billDetail/interactions';
import type { Bill } from '../../data/types';
import { formatNiceDate, latestActionEntry } from '../../lib/billDetail';
import type { SessionWatch, SessionWatchRow } from '../../lib/sessionWatch';
import { linkProps, pressInsideLink, routePath } from '../../navigation/links';
import { theme as t, prefersReducedMotion } from '../../theme/tokens';

// The signed-in homepage's "Session watch" card — the right half of the hero,
// replacing the signed-out answer card in the same slot, footprint and shadow
// (#1034). Five frames, all designed; which one shows is decided by
// `lib/sessionWatch`, so this file only renders.
//
// Two of the five are the ones that would be afterthoughts anywhere else and are
// deliberately first-class here: **tracking nothing** (the most common first case,
// an explainer rather than a stripped card) and **pending** (we have not yet asked
// when the reader last looked). Pending exists to prevent a specific lie — built
// the obvious way this card reports "nothing moved" to someone whose bills all
// moved.
//
// Nothing here says we will tell, notify or email anyone. Sending is not built
// (#36); coming back to this page IS the mechanism, and the empty state's copy says
// so without apologising for it.

type WatchBill = Pick<
  Bill,
  'id' | 'identifier' | 'title' | 'status' | 'isOmnibus' | 'actions' | 'aiAnalysis'
>;

export function SessionWatchCard({
  watch,
  onBill,
  onAllTracked,
  onSearchBills,
  onWhatsMoving,
}: {
  watch: SessionWatch<WatchBill>;
  onBill: (billId: string) => void;
  onAllTracked: () => void;
  onSearchBills: () => void;
  onWhatsMoving: () => void;
}) {
  const pending = watch.state === 'pending';

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <Text accessibilityRole="header" style={styles.title}>
          Session watch
        </Text>
        {watch.state !== 'tracking-nothing' ? (
          <CardLink label="All tracked bills" href={routePath.tracked()} onPress={onAllTracked} />
        ) : null}
      </View>
      <View style={styles.rule} />

      {pending ? <PendingFrame /> : null}

      {watch.state === 'tracking-nothing' ? (
        <TrackFirstBillFrame onSearchBills={onSearchBills} onWhatsMoving={onWhatsMoving} />
      ) : null}

      {watch.rows.length > 0 ? (
        <>
          {/* Above the rows, not below: a reader who stops after the first row must
              already know these are not all of them. */}
          {watch.capCaption ? <Text style={styles.cap}>{watch.capCaption}</Text> : null}
          <View style={styles.rows}>
            {watch.rows.map((row) => (
              <WatchRow key={row.bill.id} row={row} onBill={onBill} />
            ))}
          </View>
        </>
      ) : null}
    </View>
  );
}

// "Checking for anything new since you last looked" over two skeleton rows. Calm
// and neutral, never an error colour — we are working, nothing has failed. Distinct
// from the Track button's terminal "couldn't check" form, which means we asked and
// it failed and offers a retry; this means we have not asked yet and resolves on
// its own.
const PendingFrame = () => (
  // A plain `aria-busy` prop, NOT `useUnavailableControl` and not a ref helper.
  // The card is a REGION: nothing in it is focusable and nothing is disabled, and
  // `aria-disabled` is defined for interactive roles, so marking it would say
  // something untrue of a region. React Native types this prop and
  // react-native-web forwards it; the silent-drop problem is specific to
  // `accessibilityState={{ … }}`, which renders nothing at all
  // (docs/design/design-principles.md §3). Being a plain prop it is also
  // reactive, which matters here because this card resolves IN PLACE rather than
  // unmounting — React writes aria-busy="false" rather than leaving a stale
  // "still loading" marker on content that has already arrived.
  <View aria-busy style={styles.frame}>
    <View style={styles.pendingRow}>
      <Spinner />
      <Text style={styles.pendingText}>Checking for anything new since you last looked</Text>
    </View>
    <View style={styles.rows}>
      {[0, 1].map((i) => (
        <View key={i} style={styles.row}>
          <View style={styles.rowTop}>
            <Skeleton width={66} height={24} radius={6} />
            <Skeleton width={104} height={16} radius={6} />
          </View>
          <Skeleton width="74%" height={20} radius={6} style={styles.skeletonTitle} />
          <Skeleton width="100%" height={50} radius={11} style={styles.skeletonBlock} />
        </View>
      ))}
    </View>
  </View>
);

// A neutral ring with one lit arc. Stops turning under prefers-reduced-motion, where
// the caption beside it carries the whole message on its own (#193).
function Spinner() {
  const reduceMotion = prefersReducedMotion();
  const spin = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (reduceMotion) return;
    const loop = Animated.loop(
      Animated.timing(spin, {
        toValue: 1,
        duration: 800,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    );
    loop.start();
    return () => loop.stop();
  }, [reduceMotion, spin]);

  const glyph = (
    <Svg width={20} height={20} viewBox="0 0 24 24" fill="none" aria-hidden>
      <Circle cx={12} cy={12} r={9} stroke={t.colors.status.progressEmpty} strokeWidth={2.4} />
      <Path
        d="M21 12 a9 9 0 0 0 -9 -9"
        stroke={t.colors.text.muted}
        strokeWidth={2.4}
        strokeLinecap="round"
      />
    </Svg>
  );
  if (reduceMotion) return <View style={styles.spinner}>{glyph}</View>;
  return (
    <Animated.View
      style={[
        styles.spinner,
        {
          transform: [
            { rotate: spin.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] }) },
          ],
        },
      ]}
    >
      {glyph}
    </Animated.View>
  );
}

// Tracking nothing. A first-class frame: the card becomes the explainer rather than
// an emptier version of itself. The mechanic is stated in plain words, and the
// second link sends someone to the bill activity already further down this page,
// so they are never stuck at a dead end.
function TrackFirstBillFrame({
  onSearchBills,
  onWhatsMoving,
}: {
  onSearchBills: () => void;
  onWhatsMoving: () => void;
}) {
  const [hovered, hover] = useHover();
  return (
    <View style={styles.frame}>
      <View style={styles.bookmarkTile}>
        <Svg width={27} height={27} viewBox="0 0 24 24" fill="none" aria-hidden>
          <Path
            d="M7 4 h10 v16 l-5 -4 l-5 4 Z"
            stroke={t.colors.brand.deep}
            strokeWidth={2}
            strokeLinejoin="round"
          />
        </Svg>
      </View>
      <Text accessibilityRole="header" style={styles.emptyHeading}>
        Track your first bill
      </Text>
      <Text style={styles.emptyBody}>
        Tracking saves a bill to your account. When it moves in the official record — a committee
        hearing, a floor vote, a signature — the change shows up here the next time you come back.
      </Text>
      <View style={styles.emptyActions}>
        <Pressable
          {...linkProps(routePath.bills(), onSearchBills)}
          {...hover}
          style={[styles.cta, hovered && styles.ctaHover]}
        >
          <Text style={styles.ctaText}>Search bills</Text>
        </Pressable>
        <CardLink label="Or start from what’s moving now" onPress={onWhatsMoving} />
      </View>
    </View>
  );
}

function WatchRow({
  row,
  onBill,
}: {
  row: SessionWatchRow<WatchBill>;
  onBill: (billId: string) => void;
}) {
  const { bill, change } = row;
  // Only computed for a bill that did NOT move; a moved row's change block states
  // the same fact, and printing both would say one thing twice.
  const action = change ? null : latestActionEntry(bill.actions ?? [], new Date());
  return (
    <View style={styles.row}>
      <View style={styles.rowTop}>
        <Pressable
          {...linkProps(routePath.bill(bill.id), () => onBill(bill.id))}
          style={styles.badge}
        >
          <Text style={styles.badgeText}>{bill.identifier}</Text>
        </Pressable>
        {bill.isOmnibus ? (
          <View style={styles.omnibus} accessibilityRole="text" accessibilityLabel="Omnibus bill">
            <Text style={styles.omnibusText}>OMNIBUS</Text>
          </View>
        ) : null}
        <Text style={styles.status}>{bill.status}</Text>
      </View>
      <Text style={styles.rowTitle} numberOfLines={2}>
        {bill.aiAnalysis?.shortTitle ?? bill.title}
      </Text>
      {change ? (
        <View style={styles.rowChange}>
          {/* The SHARED block, not a copy — both specs ask for the identical
              treatment, and sharing the component is what makes that structural.
              It also carries its own panel-safe colours, which differ from the
              on-white greys used everywhere else. */}
          <ChangeBlock change={change} onHistory={() => onBill(bill.id)} compact />
        </View>
      ) : action ? (
        <Text style={styles.latest}>
          <Text style={styles.latestLabel}>Latest action: </Text>
          <Text style={styles.latestValue}>{action.label}</Text>
          {action.date ? (
            <Text style={styles.latestLabel}> · {formatNiceDate(action.date)}</Text>
          ) : null}
        </Text>
      ) : null}
    </View>
  );
}

// Green text link with a trailing arrow, used by the header and the empty frame.
function CardLink({ label, href, onPress }: { label: string; href?: string; onPress: () => void }) {
  const [hovered, hover] = useHover();
  const press = href ? linkProps(href, onPress) : { onPress: pressInsideLink(onPress) };
  return (
    <Pressable accessibilityRole="link" {...press} {...hover} style={styles.cardLink}>
      <Text style={[styles.cardLinkText, hovered && styles.cardLinkTextHover]}>
        {label}{' '}
        <Text style={styles.cardLinkArrow} aria-hidden>
          →
        </Text>
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    width: 600,
    maxWidth: '100%',
    backgroundColor: t.colors.surfaces.base,
    borderRadius: 20,
    paddingVertical: 30,
    paddingHorizontal: 32,
    ...(t.shadows.lg as object),
  },
  header: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: 14,
  },
  title: {
    fontFamily: t.typography.title,
    fontSize: t.fontSizes.subheadLg,
    fontWeight: t.fontWeights.heavy,
    letterSpacing: -0.19,
    color: t.colors.text.primary,
  },
  rule: { marginTop: 14, height: 1, backgroundColor: t.colors.alpha.ink08 },
  frame: { paddingTop: 22, paddingBottom: 6 },
  pendingRow: { flexDirection: 'row', alignItems: 'center', gap: 11 },
  spinner: { width: 20, height: 20 },
  pendingText: {
    flex: 1,
    fontFamily: t.typography.body,
    fontSize: t.fontSizes.body,
    fontWeight: t.fontWeights.semibold,
    color: t.colors.text.muted,
  },
  cap: {
    marginTop: 14,
    fontFamily: t.typography.body,
    fontSize: t.fontSizes.small,
    fontWeight: t.fontWeights.semibold,
    color: t.colors.text.muted,
  },
  rows: { marginTop: 16, gap: 11 },
  row: {
    borderWidth: 1,
    borderColor: t.colors.alpha.ink08,
    borderRadius: 14,
    paddingVertical: 14,
    paddingHorizontal: 16,
  },
  rowTop: { flexDirection: 'row', alignItems: 'center', gap: 10, flexWrap: 'wrap' },
  skeletonTitle: { marginTop: 13 },
  skeletonBlock: { marginTop: 13 },
  badge: {
    backgroundColor: t.colors.omnibus.fill,
    borderWidth: 1,
    borderColor: t.colors.omnibus.border,
    borderRadius: t.radii.xs,
    paddingVertical: 5,
    paddingHorizontal: 10,
  },
  badgeText: {
    fontFamily: t.typography.mono,
    fontSize: t.fontSizes.meta,
    fontWeight: t.fontWeights.bold,
    letterSpacing: 0.52,
    color: t.colors.omnibus.text,
  },
  omnibus: {
    borderWidth: 1,
    borderColor: t.colors.omnibus.ghostBorder,
    borderRadius: 8,
    paddingVertical: 5,
    paddingHorizontal: 10,
  },
  omnibusText: {
    fontFamily: t.typography.ui,
    fontSize: 10,
    fontWeight: t.fontWeights.bold,
    letterSpacing: 0.8,
    color: t.colors.omnibus.text,
  },
  status: {
    fontFamily: t.typography.ui,
    fontSize: t.fontSizes.meta,
    fontWeight: t.fontWeights.bold,
    color: t.colors.text.secondary,
    ...(isWeb ? ({ whiteSpace: 'nowrap' } as object) : null),
  },
  rowTitle: {
    marginTop: 10,
    fontFamily: t.typography.title,
    fontSize: t.fontSizes.lg,
    fontWeight: t.fontWeights.heavy,
    letterSpacing: -0.17,
    lineHeight: 22,
    color: t.colors.text.primary,
  },
  rowChange: { marginTop: 12 },
  latest: {
    marginTop: 9,
    fontFamily: t.typography.body,
    fontSize: t.fontSizes.small,
    lineHeight: 20,
    color: t.colors.text.secondary,
  },
  latestLabel: { color: t.colors.text.muted },
  latestValue: { color: t.colors.text.primary, fontWeight: t.fontWeights.semibold },
  bookmarkTile: {
    width: 56,
    height: 56,
    borderRadius: 15,
    backgroundColor: t.colors.tint.t150,
    borderWidth: 1,
    borderColor: t.colors.tint.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyHeading: {
    marginTop: 20,
    fontFamily: t.typography.title,
    fontSize: 26,
    fontWeight: t.fontWeights.heavy,
    letterSpacing: -0.26,
    color: t.colors.text.primary,
  },
  emptyBody: {
    marginTop: 12,
    fontFamily: t.typography.body,
    fontSize: t.fontSizes.lg,
    lineHeight: 26,
    color: t.colors.text.secondary,
  },
  emptyActions: {
    marginTop: 22,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    flexWrap: 'wrap',
  },
  cta: {
    backgroundColor: t.colors.brand.base,
    borderWidth: 1,
    borderColor: t.colors.brand.base,
    borderRadius: t.radii.md,
    paddingVertical: 14,
    paddingHorizontal: 24,
    ...(isWeb
      ? ({ transitionProperty: 'background-color', transitionDuration: '0.15s' } as object)
      : null),
  },
  ctaHover: { backgroundColor: t.colors.brand.hover, borderColor: t.colors.brand.hover },
  ctaText: {
    fontFamily: t.typography.ui,
    fontSize: t.fontSizes.lg,
    fontWeight: t.fontWeights.bold,
    color: t.colors.text.onGreen,
  },
  cardLink: { flexShrink: 0 },
  cardLinkText: {
    fontFamily: t.typography.ui,
    fontSize: t.fontSizes.small,
    fontWeight: t.fontWeights.bold,
    color: t.colors.brand.deep,
  },
  cardLinkTextHover: { color: t.colors.brand.forest },
  cardLinkArrow: { fontWeight: t.fontWeights.regular },
});
