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
  billStage,
  chiefAuthor,
  formatNiceDate,
  latestActionEntry,
  plainBillSummary,
  type BillChanges,
  type StageTone,
} from '../../lib/billDetail';
import { titleCaseIssue } from '../../lib/issues';
import { formatSessionLabel } from '../../lib/sessionLabel';
import { ChangeBlock } from '../ChangeBlock';
import { VoteCountLinkChip } from '../VoteCountLinkChip';
import { linkProps, pressInsideLink, routePath } from '../../navigation/links';
import { prefersReducedMotion, theme as t } from '../../theme/tokens';

const isWeb = Platform.OS === 'web';

// Bill card for the redesigned Search Bills screen (docs/mockups/search-bills).
// The whole card links to the bill detail; Track / author / roll-calls sit above
// the full-bleed anchor so they stay independently clickable.
//
// The card is a REAL <a href> (navigation/links.ts), so right-click → "Open link
// in new tab", ⌘-click and middle-click all work on it. Author and roll-call
// links are sibling anchors, never anchors nested in anchors.

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
  | 'session'
>;

interface BillResultCardProps {
  bill: BillCardData;
  onPress?: () => void;
  onSponsorPress?: (legislatorId: string) => void;
  onRollCalls?: () => void;
  // Whether to show the Track button in the card header — honoured by BOTH the
  // desktop and the phone layout (#1007; the phone layout used to ignore it and
  // render no control at all). Defaults on so both responsive layouts expose the
  // same action.
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
  /** The issue-answer page uses the same card anatomy at its tighter handoff
   * measurements, with Track in a full-width phone row. */
  variant?: 'default' | 'issueAnswer';
  /** A topic already named in the issue-answer count row is not repeated on
   * every card beneath it. Comparison is case- and whitespace-insensitive. */
  excludedPolicyArea?: string;
}

function ProgressBar({
  index,
  tone,
  compact,
}: {
  index: number;
  tone: StageTone;
  compact: boolean;
}) {
  return (
    <View style={styles.progress}>
      {[0, 1, 2, 3, 4].map((i) => {
        let color = t.colors.status.progressEmpty;
        if (tone === 'vetoed') {
          color = i < 4 ? t.colors.brand.base : t.colors.status.vetoedStep;
        } else if (i <= index) {
          color = t.colors.brand.base;
        }
        return (
          <View
            key={i}
            style={[
              styles.progressStep,
              compact && styles.progressStepIssueAnswer,
              { backgroundColor: color },
            ]}
          />
        );
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
// sits outside it. Own hover state so only the name recolors.
function ChiefAuthorLink({
  author,
  onPress,
}: {
  author: BillSponsor;
  onPress?: (legislatorId: string) => void;
}) {
  const [hovered, hover] = useHover();
  const clickable = Boolean(author.legislatorId && onPress);
  const destination = author.slug ?? author.legislatorId;
  return (
    <Pressable
      disabled={!clickable}
      {...(clickable && destination
        ? linkProps(routePath.legislator(destination), () => onPress?.(destination))
        : {})}
      {...hover}
      style={clickable ? styles.interactiveLayer : undefined}
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
  variant = 'default',
  excludedPolicyArea,
}: BillResultCardProps) {
  const [hovered, setHovered] = useState(false);
  const { isMobile } = useResponsive();
  const issueAnswer = variant === 'issueAnswer';
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
  const excludedIssue = excludedPolicyArea?.trim().toLocaleLowerCase();
  const policyAreas = (bill.aiAnalysis?.policyAreas ?? []).filter(
    (topic) => !excludedIssue || topic.trim().toLocaleLowerCase() !== excludedIssue,
  );
  const stage = billStage(bill.status);
  // Veto is not the fifth stage in the issue page's five-step bar. A vetoed
  // bill reached both chambers but was not signed, so leave the final segment
  // empty and let the adjacent status text carry the veto fact.
  const { index, tone } =
    issueAnswer && stage.tone === 'vetoed' ? { index: 3, tone: 'neutral' as const } : stage;
  const statusColor =
    tone === 'green'
      ? t.colors.text.green
      : issueAnswer
        ? t.colors.text.secondary
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
    <View
      style={[
        styles.card,
        issueAnswer && styles.cardIssueAnswer,
        issueAnswer && isMobile && styles.cardIssueAnswerMobile,
        hovered && styles.cardHover,
      ]}
    >
      {/* One full-bleed anchor owns the whole card without wrapping the real
          controls. Track, author, and votes sit above it as sibling controls, so
          the web markup never nests buttons or links inside another link. */}
      <Pressable
        {...linkProps(routePath.bill(bill.id), onPress)}
        accessibilityLabel={`Open ${bill.identifier}`}
        onPressIn={warm}
        onHoverIn={() => {
          setHovered(true);
          warm();
        }}
        onHoverOut={() => setHovered(false)}
        style={[
          styles.cardOverlay,
          issueAnswer && styles.cardOverlayIssueAnswer,
          issueAnswer && isMobile && styles.cardOverlayIssueAnswerMobile,
        ]}
      />
      <View style={[styles.cardMain, issueAnswer && styles.cardMainIssueAnswer]}>
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
                {bill.session ? (
                  <Text style={styles.sessionTag}>{formatSessionLabel(bill.session)}</Text>
                ) : null}
                {bill.isOmnibus ? <OmnibusPill /> : null}
                {hotIssue ? <HotIssuePill /> : null}
              </View>
              {/* The phone card used to render NO Track control at all, so a bill could
                be tracked but never untracked from a phone — while the Tracked page's
                own subhead told the reader to "Tap Track on any bill to add or remove
                it" (#1007). It honours the same showTrackButton prop the desktop
                branch does and shows the action by default at every viewport (#1138).
                Bill cards use the compact size at every viewport; all three sizes
                carry the same 44px minimum touch target. */}
              {!issueAnswer && showTrackButton && onToggleTrack ? (
                <View style={[styles.headerTrackSlot, styles.interactiveLayer]}>
                  <BillTrackButton
                    size="card"
                    tracked={tracked}
                    onPress={pressInsideLink(onToggleTrack)}
                  />
                </View>
              ) : null}
            </View>
            <View style={styles.headerRow}>
              <Text
                style={[
                  styles.statusLabel,
                  issueAnswer && styles.statusLabelIssueAnswer,
                  { color: statusColor },
                ]}
              >
                {bill.status}
              </Text>
              <ProgressBar index={index} tone={tone} compact={issueAnswer} />
            </View>
          </View>
        ) : (
          <View style={styles.topRow}>
            <View style={styles.badge}>
              <Text style={styles.badgeText}>{bill.identifier}</Text>
            </View>
            {bill.session ? (
              <Text style={styles.sessionTag}>{formatSessionLabel(bill.session)}</Text>
            ) : null}
            {bill.isOmnibus ? <OmnibusPill /> : null}
            <Text
              style={[
                styles.statusLabel,
                issueAnswer && styles.statusLabelIssueAnswer,
                { color: statusColor },
              ]}
            >
              {bill.status}
            </Text>
            <ProgressBar index={index} tone={tone} compact={issueAnswer} />
            <View style={styles.topSpacer} />
            {/* Right group: the "🔥 Hot issue" flag sits to the LEFT of Track with a
              16px gap, on the same row — it adds no card height. */}
            {hotIssue || showTrackButton ? (
              <View style={styles.topRight}>
                {hotIssue ? <HotIssuePill /> : null}
                {showTrackButton && onToggleTrack ? (
                  // The card is a real link, so swallow the tap (pressInsideLink) or
                  // clicking Track would follow the card's href to the bill.
                  <View style={styles.interactiveLayer}>
                    <BillTrackButton
                      size="card"
                      tracked={tracked}
                      onPress={pressInsideLink(onToggleTrack)}
                    />
                  </View>
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
          <View
            style={[
              summary ? undefined : styles.changeAfterTitle,
              onChangeHistory && styles.interactiveLayer,
            ]}
          >
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
        </View>
      </View>
      {policyAreas.length > 0 || bill.rollCallCount > 0 ? (
        <View style={styles.tagRow}>
          {policyAreas.map((topic) => (
            <View key={topic} style={styles.tag}>
              <Text style={[styles.tagText, issueAnswer && styles.tagTextIssueAnswer]}>
                {titleCaseIssue(topic)}
              </Text>
            </View>
          ))}
          {bill.rollCallCount > 0 ? (
            <View style={styles.interactiveLayer}>
              <VoteCountLinkChip
                count={bill.rollCallCount}
                href={routePath.bill(bill.id, { tab: 'votes' })}
                onPress={pressInsideLink(() => onRollCalls?.())}
              />
            </View>
          ) : null}
        </View>
      ) : null}
      {issueAnswer && isMobile && showTrackButton && onToggleTrack ? (
        <View style={[styles.issueAnswerMobileTrack, styles.interactiveLayer]}>
          <BillTrackButton
            size="mobile"
            fullWidth
            tracked={tracked}
            onPress={pressInsideLink(onToggleTrack)}
          />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    position: 'relative',
    backgroundColor: t.colors.surfaces.base,
    borderWidth: 1,
    borderColor: t.colors.alpha.ink08,
    borderRadius: 18,
    paddingVertical: 26,
    paddingHorizontal: 30,
    gap: 12,
    ...(t.shadows.card as object),
    ...(isWeb && !prefersReducedMotion()
      ? ({ transitionProperty: 'border-color, box-shadow', transitionDuration: '0.16s' } as object)
      : null),
  },
  cardIssueAnswer: { borderRadius: 16, paddingVertical: 20, paddingHorizontal: 22, gap: 13 },
  cardIssueAnswerMobile: { borderRadius: 14, padding: 16 },
  cardHover: {
    borderColor: 'rgba(45,212,126,0.55)',
    ...(isWeb
      ? ({ boxShadow: '0 14px 34px rgba(17,21,15,0.10)' } as object)
      : (t.shadows.lg as object)),
  },
  cardOverlay: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    zIndex: 1,
    borderRadius: 18,
  },
  cardOverlayIssueAnswer: { borderRadius: 16 },
  cardOverlayIssueAnswerMobile: { borderRadius: 14 },
  cardMain: { gap: 12 },
  cardMainIssueAnswer: { gap: 13 },
  interactiveLayer: { position: 'relative', zIndex: 2 },
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
  sessionTag: {
    fontFamily: t.typography.ui,
    fontSize: 11,
    fontWeight: t.fontWeights.semibold,
    letterSpacing: 0.5,
    color: t.colors.text.faint,
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
  statusLabelIssueAnswer: { fontSize: 15 },
  progress: { flexDirection: 'row', gap: 4 },
  progressStep: { width: 30, height: 7, borderRadius: 4 },
  progressStepIssueAnswer: { width: 22, height: 5, borderRadius: 3 },
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
  tagTextIssueAnswer: { fontSize: 13, fontWeight: t.fontWeights.semibold, letterSpacing: 0 },
  issueAnswerMobileTrack: { width: '100%' },
});
