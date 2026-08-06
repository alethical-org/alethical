import { useEffect, useMemo, useRef, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';

import { Bill, BillSponsor } from '../../data/types';
import { usePrefetchBill } from '../../hooks/useAppQueries';
import { useResponsive } from '../../hooks/useResponsive';
import { BillTrackButton } from '../billDetail/BillTrackButton';
import { useHover } from '../billDetail/interactions';
import {
  authorNameOnly,
  authorTitleLabel,
  chiefAuthor,
  formatNiceDate,
  latestActionEntry,
  plainBillSummary,
  type BillChanges,
} from '../../lib/billDetail';
import { titleCaseIssue } from '../../lib/issues';
import { ChangeBlock } from '../ChangeBlock';
import { linkProps, pressInsideLink, routePath } from '../../navigation/links';
import { theme as t } from '../../theme/tokens';

const isWeb = Platform.OS === 'web';

// Bill card for the redesigned Search Bills screen (docs/mockups/search-bills).
// The whole card links to the bill detail; Track / author / roll-calls sit above
// it (stopPropagation) so they stay independently clickable.
//
// The card is a REAL <a href> (navigation/links.ts), so right-click → "Open link
// in new tab", ⌘-click and middle-click all work on it. The author name and the
// roll-calls chip stay plain pressables rather than anchors of their own: an <a>
// inside an <a> is invalid markup and reads as one confused control to a screen
// reader, and the card is the target worth having (issue #760 tracks giving those
// two their own new-tab behaviour without nesting).

type BillCardData = Pick<
  Bill,
  | 'id'
  | 'identifier'
  | 'title'
  | 'status'
  | 'isOmnibus'
  | 'effectiveDate'
  | 'actions'
  | 'chamber'
  | 'sponsors'
  | 'aiAnalysis'
  | 'rollCallCount'
>;

interface BillResultCardProps {
  bill: BillCardData;
  onPress?: () => void;
  onSponsorPress?: (legislatorId: string) => void;
  onRollCalls?: () => void;
  // Whether to show the Track button in the card header — honoured by BOTH the
  // desktop and the phone layout (#1007; the phone layout used to ignore it and
  // render no control at all). Search passes false on the mobile-web layout to
  // keep its top row uncluttered (#596); defaults on so other surfaces are
  // unchanged.
  showTrackButton?: boolean;
  // Whether this bill is on the signed-in user's watchlist (flips the button to
  // "Tracked"). Supplied by the screen via useBillTracking.
  tracked?: boolean;
  // Toggle this bill's tracked state (or route a signed-out user to sign-in). When
  // omitted, the Track button is not rendered — a surface must opt in by wiring it.
  onToggleTrack?: () => void;
  // Editorial "🔥 Hot issue" flag (NEXT-home-spec §Bill Activity — Card chrome).
  // Shown on both web (top-right, left of Track) and mobile (right of the identity
  // row). The editor marks which bills carry it via lib/hotIssues.ts; off by
  // default so nothing shows it unasked.
  hotIssue?: boolean;
  // What this bill did since the reader last looked, from lib/billDetail's
  // changesSince (#1009). Supplied only by the Tracked page, which is the one
  // surface with a per-reader comparison point. When present the card shows the
  // green change block and DROPS its "Latest action:" row — the block already
  // states that same fact, and printing both says one thing twice.
  change?: BillChanges;
  // Opens the bill's full history, for the change block's earlier-steps link.
  onChangeHistory?: () => void;
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

// Ghosted OMNIBUS indicator: transparent amber pill with a small capitol/gavel
// glyph, shown in the card's top row (after the code badge) only for omnibus
// bills — deliberately less prominent than the solid amber code badge.
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

// Editorial "🔥 Hot issue" flag: a NEUTRAL pill (never amber — amber is reserved
// for bill-code identity). The 🔥 carries the signal; the pill stays quiet grey.
function HotIssuePill() {
  return (
    <View style={styles.hotPill} accessibilityRole="text" accessibilityLabel="Hot issue">
      <Text style={styles.hotPillText}>🔥 Hot issue</Text>
    </View>
  );
}

// The chief author's NAME is the only link (green, → arrow), spelled-out honorific
// sits outside it. pressInsideLink keeps the card's own press — and the card
// anchor's own URL — from firing when the name is tapped. Own hover state so only
// the name (not the whole card) recolors.
function ChiefAuthorLink({
  author,
  onPress,
}: {
  author: BillSponsor;
  onPress?: (legislatorId: string) => void;
}) {
  const [hovered, hover] = useHover();
  const clickable = Boolean(author.legislatorId && onPress);
  return (
    <Pressable
      accessibilityRole={clickable ? 'link' : undefined}
      disabled={!clickable}
      onPress={pressInsideLink(() => {
        if (author.legislatorId) onPress?.(author.slug ?? author.legislatorId);
      })}
      {...hover}
    >
      <Text style={[styles.metaText, styles.authorLink, hovered && styles.authorLinkHover]}>
        {authorNameOnly(author.name)}{' '}
        {/* Arrow marks the name as a profile link: name's own font/size, weight 400,
            hidden from screen readers (the link's accessible name is the member's). */}
        <Text style={styles.nameArrow} aria-hidden>
          →
        </Text>
      </Text>
    </Pressable>
  );
}

export function BillResultCard({
  bill,
  onPress,
  onSponsorPress,
  onRollCalls,
  showTrackButton = true,
  tracked = false,
  onToggleTrack,
  hotIssue = false,
  change,
  onChangeHistory,
}: BillResultCardProps) {
  const [hovered, setHovered] = useState(false);
  const { isMobile } = useResponsive();
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
  // Through the shared cleaner, like every other surface that shows a summary: the
  // amber code badge above already states the bill number, so a summary opening
  // with it repeats itself, and a statute citation reads as legalese
  // (grounded-answers rule 9). No firstSentenceOnly — this card shows the whole
  // summary, so truncating to one sentence would drop content it means to show.
  //
  // Empty when the bill has no AI summary yet, and the summary line is then
  // dropped entirely rather than falling back to bill.title (#1007). The title
  // line right above already prints that same title in this case, so the fallback
  // showed it twice; and the statutory title is the legalese the plain-language
  // summary exists to replace, so repeating it as the summary is worse than
  // showing no summary (grounded-answers rule 10). The Ask answer card already
  // renders its summary this way (AskAnswerScreen's AskAnswerBillCard).
  const summary = plainBillSummary(bill.aiAnalysis?.summary);
  const policyAreas = bill.aiAnalysis?.policyAreas ?? [];
  const { index, tone } = billStage(bill.status);
  const statusColor =
    tone === 'green'
      ? t.colors.brand.deep
      : tone === 'vetoed'
        ? t.colors.status.vetoedText
        : t.colors.text.secondary;
  // Per-file chief author only: chiefAuthor scopes to this file's own chamber, so a
  // Senate file shows its Senate chief (not the House companion's author). Co-authors
  // and the count live on the bill profile, not this card.
  const chief = chiefAuthor(bill);
  // Curated plain-language latest action (matching the bill's Actions tab) in
  // place of the raw status string, paired with the humanized date of that SAME
  // action ("May 27, 2026") — not the bill's generic timestamp. `now` is stable
  // per mount so the memo is too.
  const now = useMemo(() => new Date(), []);
  const action = useMemo(() => latestActionEntry(bill.actions ?? [], now), [bill.actions, now]);
  const actionLabel = action?.label ?? null;
  const actionDate = action?.date ?? null;
  // Signed laws carry a forward-looking Effective line: the verified statutory date
  // ("Aug 1, 2026", humanized to match) or "various dates" for an omnibus. The
  // backend sets effectiveDate only for enacted bills with a groundable value, so
  // its mere presence gates the line (grounded-answers rule 9).
  const effectiveDate = bill.effectiveDate ? formatNiceDate(bill.effectiveDate) : null;

  return (
    <Pressable
      {...linkProps(routePath.bill(bill.id), onPress)}
      onPressIn={warm}
      onHoverIn={() => {
        setHovered(true);
        warm();
      }}
      onHoverOut={() => setHovered(false)}
      style={[styles.card, hovered && styles.cardHover]}
    >
      {isMobile ? (
        // Mobile: a stable two-row header on EVERY card — row 1 identity (code
        // badge, optional OMNIBUS tag, optional hot-issue pill) with Track holding
        // the right edge, row 2 the status/progress unit — so the progress bar sits
        // in the same place whether or not a label is present, instead of reflowing
        // card-to-card. Measured at a 375px viewport: the card leaves 265px of
        // content width, the progress bar alone takes 166px of it and the Track
        // button 107px, so Track and the progress bar cannot share a row even
        // before the status word.
        //
        // Row 1's shape is load-bearing, and it is the constraint that keeps this
        // card off the path that got the phone Track button removed once before
        // (#596, crowded top row). The label group is flex:1 with minWidth:0 and
        // wraps INTERNALLY; Track is flex:none with marginLeft:auto. So the button
        // sits in the identical spot whether a bill carries zero, one or both
        // labels — a two-label bill wraps its labels onto a second line underneath
        // themselves rather than pushing the button onto a line of its own.
        <View style={styles.headerMobile}>
          <View style={styles.headerTopRow}>
            <View style={styles.headerLabels}>
              <View style={styles.badge}>
                <Text style={styles.badgeText}>{bill.identifier}</Text>
              </View>
              {bill.isOmnibus ? <OmnibusPill /> : null}
              {hotIssue ? <HotIssuePill /> : null}
            </View>
            {/* The phone card used to render NO Track control at all, so a bill could
                be tracked but never untracked from a phone — while the Tracked page's
                own subhead told the reader to "Tap Track on any bill to add or remove
                it" (#1007). It honours the same showTrackButton prop the desktop
                branch does, so Search still opts out on mobile (#596's crowded-top-row
                decision, which it makes by passing the prop) and every other surface
                gets the control. size="mobile" rather than "card": it is the variant
                that carries the 44pt minimum touch target, and it is narrower than
                "card" (11/14 vs 18/18 horizontal padding), so it also fits the
                narrower viewport better. Same size the mobile bill-detail header uses. */}
            {showTrackButton && onToggleTrack ? (
              <View style={styles.headerTrackSlot}>
                <BillTrackButton
                  size="mobile"
                  tracked={tracked}
                  onPress={pressInsideLink(onToggleTrack)}
                />
              </View>
            ) : null}
          </View>
          <View style={styles.headerRow}>
            <Text style={[styles.statusLabel, { color: statusColor }]}>{bill.status}</Text>
            <ProgressBar index={index} tone={tone} />
          </View>
        </View>
      ) : (
        <View style={styles.topRow}>
          <View style={styles.badge}>
            <Text style={styles.badgeText}>{bill.identifier}</Text>
          </View>
          {bill.isOmnibus ? <OmnibusPill /> : null}
          <Text style={[styles.statusLabel, { color: statusColor }]}>{bill.status}</Text>
          <ProgressBar index={index} tone={tone} />
          <View style={styles.topSpacer} />
          {/* Right group: the "🔥 Hot issue" flag sits to the LEFT of Track with a
              16px gap, on the same row — it adds no card height. */}
          {hotIssue || showTrackButton ? (
            <View style={styles.topRight}>
              {hotIssue ? <HotIssuePill /> : null}
              {showTrackButton && onToggleTrack ? (
                // The card is a real link, so swallow the tap (pressInsideLink) or
                // clicking Track would follow the card's href to the bill.
                <BillTrackButton
                  size="card"
                  tracked={tracked}
                  onPress={pressInsideLink(onToggleTrack)}
                />
              ) : null}
            </View>
          ) : null}
        </View>
      )}

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

      {summary ? <Text style={styles.summary}>{summary}</Text> : null}

      {/* With no summary the change block follows the title directly, and the
          card's own 12px gap reads tight under a 25px bold heading — so it takes
          20px there. On BOTH surfaces: the handoff says this case is invisible on
          a phone because the phone card renders no summary line, and that is
          wrong. The isMobile branch above covers the HEADER only and closes
          before the title; the title and the summary are rendered once, outside
          it, by both layouts. Verified in this file and in the committed 375px
          screenshots at docs/verification/1007-tracked-bills-phone/. */}
      {change ? (
        <View style={summary ? undefined : styles.changeAfterTitle}>
          <ChangeBlock change={change} onHistory={onChangeHistory} />
        </View>
      ) : null}

      <View style={styles.meta}>
        <View style={styles.metaRow}>
          <Text style={[styles.metaText, styles.metaLabel]}>Chief author: </Text>
          {chief ? (
            <>
              <Text style={styles.metaText}>{authorTitleLabel(chief.chamber)} </Text>
              <ChiefAuthorLink author={chief} onPress={onSponsorPress} />
            </>
          ) : (
            <Text style={styles.metaText}>Unavailable</Text>
          )}
        </View>
        {/* Dropped when the change block is showing: the block states this same
            action, so printing both puts one fact on the card twice. */}
        {!change && (actionLabel || actionDate) ? (
          <View style={[styles.metaRow, styles.actionRow]}>
            <Text style={[styles.metaText, styles.metaLabel]}>Latest action:</Text>
            {actionLabel ? (
              <Text style={[styles.metaText, styles.actionValue]}>{actionLabel}</Text>
            ) : null}
            {actionDate ? (
              <Text style={[styles.metaText, styles.metaLabel]}>{actionDate}</Text>
            ) : null}
          </View>
        ) : null}
        {effectiveDate ? (
          <View style={styles.metaRow}>
            <Text style={[styles.metaText, styles.metaLabel]}>Effective: </Text>
            <Text style={[styles.metaText, styles.actionValue]}>{effectiveDate}</Text>
          </View>
        ) : null}
        {/* Skipped entirely when there is nothing to put in it: the issue tags come
            from the AI enrichment, so a bill still awaiting one has none, and with
            no roll calls either the row would render empty and still collect the
            meta block's 11px gap as a stray space under the card (#1007). */}
        {policyAreas.length > 0 || bill.rollCallCount > 0 ? (
          <View style={styles.tagRow}>
            {policyAreas.map((topic) => (
              <View key={topic} style={styles.tag}>
                <Text style={styles.tagText}>{titleCaseIssue(topic)}</Text>
              </View>
            ))}
            {bill.rollCallCount > 0 ? (
              <Pressable
                accessibilityRole="link"
                onPress={pressInsideLink(() => onRollCalls?.())}
                style={styles.rollCalls}
              >
                <Text style={styles.rollCallsText}>
                  {bill.rollCallCount} {bill.rollCallCount === 1 ? 'vote' : 'votes'}
                </Text>
              </Pressable>
            ) : null}
          </View>
        ) : null}
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
  // Right-aligned group holding the Hot-issue flag + Track, 16px apart.
  topRight: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  hotPill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: t.colors.surfaces.s400, // #f1f1f4 — neutral grey, never amber
    borderWidth: 1,
    borderColor: t.colors.alpha.ink08,
    borderRadius: t.radii.pill,
    paddingVertical: 5,
    paddingHorizontal: 11,
  },
  hotPillText: {
    fontFamily: t.typography.ui,
    fontSize: 13,
    fontWeight: t.fontWeights.bold,
    letterSpacing: 0.26,
    color: t.colors.text.secondary, // #4f5651
    ...(isWeb ? ({ whiteSpace: 'nowrap' } as object) : null),
  },
  // Mobile header: two stacked rows (identity, then status/progress) with a
  // steady ~11px vertical gap between them.
  headerMobile: { gap: 11 },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: 10, flexWrap: 'wrap' },
  // Mobile row 1. It does NOT wrap: the labels wrap inside their own group and the
  // Track button holds the right edge, so the button lands in the same place on
  // every card whatever labels a bill carries. flex-start rather than center so a
  // two-line label group grows downward instead of pushing the button off-centre.
  headerTopRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  // minWidth 0 is what makes flex:1 actually shrinkable here — without it the
  // group's content sets a floor and long labels push Track off the card.
  headerLabels: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap',
  },
  headerTrackSlot: { flexShrink: 0, marginLeft: 'auto' },
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
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: t.colors.omnibus.ghostBorder,
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
  // 8px on top of the card's own 12px gap = the 20px the design asks for below a
  // title with no summary between it and the block.
  changeAfterTitle: { marginTop: 8 },
  meta: {
    borderTopWidth: 1,
    borderTopColor: t.colors.alpha.ink08,
    paddingTop: 12,
    gap: 11,
  },
  metaRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'baseline' },
  metaText: {
    fontFamily: t.typography.body,
    fontSize: t.fontSizes.small,
    lineHeight: 21,
    color: t.colors.text.secondary, // #4f5651 — medium tier (honorific / line base)
  },
  // Muted label tier for both meta labels ("Chief author:" / "Latest action:") and
  // the latest-action date — lighter than the medium honorific so the label reads
  // distinct. No exact theme token at this value (sits between text.muted #656c66
  // and text.faint #70776f); AA-compliant on the card surface (~4.7:1 on white).
  metaLabel: { color: '#6f756f' },
  authorLink: { color: t.colors.brand.deep, fontWeight: t.fontWeights.bold },
  authorLinkHover: { color: t.colors.brand.forest }, // #0f7a45
  nameArrow: { fontWeight: t.fontWeights.regular }, // arrow at weight 400 inside the bold link
  actionValue: { color: t.colors.text.primary, fontWeight: t.fontWeights.semibold }, // #11150f / 600
  // Latest-action line only (not the shared metaRow, which the Chief-author line
  // reuses): a flex-wrap row whose column-gap gives the 8px between label/action/date
  // on the same line but ZERO leading space when the date wraps — so a wrapped date
  // aligns flush-left under "Latest action:" instead of the ragged indent a
  // marginLeft would leave. row-gap keeps a small breath between wrapped lines.
  actionRow: { columnGap: 8, rowGap: 2 },
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
