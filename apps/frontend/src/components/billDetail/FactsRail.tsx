import { Pressable, StyleSheet, Text, View } from 'react-native';

import { theme as t } from '../../theme/tokens';
import { Bill } from '../../data/types';
import { externalLinkProps, linkProps, routePath } from '../../navigation/links';
import { titleCaseIssue } from '../../lib/issues';
import {
  authorNameOnly,
  authorTitleLabel,
  billStage,
  chamberBillLabel,
  chiefAuthor,
  coAuthorCount,
  districtRowLabel,
  formatAuthorDistrict,
  formatNiceDate,
  isKnownDistrict,
  effectiveRailValue,
  latestActionEntry,
  partyFull,
  PHASED_CAPTION,
  POINTER_CAPTION,
  readLabel,
  stageLabel,
} from '../../lib/billDetail';
import { useHover } from './interactions';

// Facts rail (Summary right column, sticky). Order per spec §Summary tab: WHERE IT
// STANDS (status label first, then progress bar, then date), {CHAMBER} BILL
// (code badge + official links), CHIEF AUTHOR (labeled Party / District + co-author
// count), ISSUES.
export function FactsRail({
  bill,
  onOpenUrl,
  onOpenLegislator,
  onOpenBill,
  onJumpToActions,
}: {
  bill: Bill;
  onOpenUrl: (url: string) => void;
  onOpenLegislator: (legislatorId: string) => void;
  onOpenBill: (billId: string) => void;
  onJumpToActions: () => void;
}) {
  const { index, tone } = billStage(bill.status);
  const label = stageLabel(bill.status);

  // Show EFFECTIVE {date} only when the backend served a statutory effective date
  // verified verbatim from the enacted bill text (#483). Otherwise the honest
  // LATEST ACTION {text · date} — we never label a last-action date as EFFECTIVE,
  // which is wrong whenever the real effective date is in the future (see #455).
  // The action text is the plain-language headline of the newest action (the same
  // latestActionEntry the list card uses), so the rail names the committee
  // ("Referred to Transportation") and reads like the Actions timeline, not the
  // raw clerk string ("Referred to"). Falls back to the stored status text when a
  // bill has no action rows (#599 follow-up). The served date is a verbatim
  // statutory string ("August 1, 2025"), so it goes through formatNiceDate for the
  // rail's abbreviated month — matching the LATEST ACTION branch below, the Actions
  // timeline, and the search card, which already formats this same field (#711).
  // A law whose sections start on different days keeps the EFFECTIVE label and
  // leads with the earliest date it states about itself ("From May 28, 2026"),
  // plus one muted caption pointing at the Actions timeline for the rest (#715).
  const latest = latestActionEntry(bill.actions ?? [], new Date());
  const effective = effectiveRailValue(bill);
  const dateLabel = effective ? 'EFFECTIVE' : 'LATEST ACTION';
  const dateValue =
    effective?.value ??
    (latest
      ? `${latest.label}${latest.date ? ` · ${latest.date}` : ''}`
      : bill.latestActionText
        ? `${bill.latestActionText}${bill.updatedAt ? ` · ${formatNiceDate(bill.updatedAt)}` : ''}`
        : formatNiceDate(bill.updatedAt));

  const overviewUrl = bill.officialLinks?.[0]?.url;
  const readUrl = bill.versions?.[0]?.url ?? overviewUrl;

  const author = chiefAuthor(bill);
  const coauthors = coAuthorCount(bill);

  const issues = (bill.topics?.length ? bill.topics : (bill.aiAnalysis?.policyAreas ?? [])).slice(
    0,
    6,
  );

  const statusColor =
    tone === 'green'
      ? t.colors.brand.deep
      : tone === 'vetoed'
        ? t.colors.status.vetoedText
        : t.colors.text.secondary;

  return (
    <View style={styles.card}>
      {/* WHERE IT STANDS */}
      <View style={styles.section}>
        <Text style={styles.sectionLabel}>WHERE IT STANDS</Text>
        <View style={styles.standRow}>
          <Text style={[styles.stageLabel, { color: statusColor }]}>{label}</Text>
          <View style={styles.steps}>
            {[0, 1, 2, 3, 4].map((i) => {
              let color = t.colors.status.progressEmpty;
              if (tone === 'vetoed')
                color = i < 4 ? t.colors.brand.base : t.colors.status.vetoedStep;
              else if (i <= index) color = t.colors.brand.base;
              return <View key={i} style={[styles.step, { backgroundColor: color }]} />;
            })}
          </View>
        </View>
        {dateValue ? (
          <>
            <Text style={styles.dateLabel}>{dateLabel}</Text>
            <Text style={styles.dateValue}>{dateValue}</Text>
            {effective?.phased ? (
              <PhasedCaption billId={bill.id} onJumpToActions={onJumpToActions} />
            ) : null}
            {/* The record's newest entry is a pointer somewhere else, not a further
                step for this bill. Said here because the status above it reads
                "Introduced" on 1,190 such bills, which alone implies an ordinary
                proposal still waiting its turn (#757). */}
            {latest?.kind === 'crossReference' ? (
              <Text style={styles.pointerCaption}>{POINTER_CAPTION}</Text>
            ) : null}
          </>
        ) : null}
      </View>

      {/* {CHAMBER} BILL */}
      <View style={styles.sectionBordered}>
        <Text style={styles.sectionLabel}>{chamberBillLabel(bill.identifier)}</Text>
        <View style={styles.codeRow}>
          <View style={styles.codeBadge}>
            <Text style={styles.codeBadgeText}>{bill.identifier}</Text>
          </View>
        </View>
        <View style={styles.linkCol}>
          {overviewUrl ? (
            <TextLink
              label="Bill overview →"
              href={overviewUrl}
              external
              onPress={() => onOpenUrl(overviewUrl)}
            />
          ) : null}
          {readUrl ? (
            <TextLink
              label={`${readLabel(bill.status)} →`}
              href={readUrl}
              external
              onPress={() => onOpenUrl(readUrl)}
            />
          ) : null}
        </View>
        {bill.companion ? (
          <View style={styles.companionRow}>
            <Text style={styles.authorFieldLabel}>Companion</Text>
            <TextLink
              label={`${bill.companion.chamber} (${bill.companion.identifier}) →`}
              href={routePath.bill(bill.companion.id)}
              onPress={() => onOpenBill(bill.companion!.id)}
            />
          </View>
        ) : null}
      </View>

      {/* CHIEF AUTHOR */}
      {author ? (
        <View style={styles.sectionBordered}>
          <View style={styles.authorHead}>
            <Text style={styles.sectionLabel}>CHIEF AUTHOR</Text>
            {coauthors > 0 ? <Text style={styles.coauthors}>+{coauthors} co-authors</Text> : null}
          </View>
          <View style={styles.authorFields}>
            {/* Name row: honorific is the grey label, only the name + arrow is the
                green link. */}
            <View style={styles.authorFieldRow}>
              <Text style={styles.authorFieldLabel}>{authorTitleLabel(author.chamber)}</Text>
              {author.legislatorId ? (
                <TextLink
                  label={`${authorNameOnly(author.name)} →`}
                  href={routePath.legislator(author.legislatorId)}
                  onPress={() => onOpenLegislator(author.legislatorId as string)}
                />
              ) : (
                <Text style={styles.authorNamePlain}>{authorNameOnly(author.name)}</Text>
              )}
            </View>
            {author.party ? (
              <View style={styles.authorFieldRow}>
                <Text style={styles.authorFieldLabel}>Party</Text>
                <Text style={styles.authorFieldValue}>{partyFull(author.party)}</Text>
              </View>
            ) : null}
            {isKnownDistrict(author.district) ? (
              <View style={styles.authorFieldRow}>
                <Text style={styles.authorFieldLabel}>{districtRowLabel(author.chamber)}</Text>
                <Text style={styles.authorFieldValue}>
                  {formatAuthorDistrict(author.district, author.representedCity)}
                </Text>
              </View>
            ) : null}
          </View>
        </View>
      ) : null}

      {/* ISSUES */}
      {issues.length ? (
        <View style={styles.sectionBordered}>
          <Text style={styles.sectionLabel}>ISSUES</Text>
          <View style={styles.issueRow}>
            {issues.map((issue) => (
              <View key={issue} style={styles.issueChip}>
                <Text style={styles.issueChipText}>{titleCaseIssue(issue).toUpperCase()}</Text>
              </View>
            ))}
          </View>
        </View>
      ) : null}
    </View>
  );
}

function TextLink({
  label,
  href,
  external,
  onPress,
  large,
}: {
  label: string;
  href: string;
  // Official-source URL (revisor.mn.gov) rather than an in-app page.
  external?: boolean;
  onPress: () => void;
  large?: boolean;
}) {
  const [hovered, hover] = useHover();
  const anchor = external ? externalLinkProps(href, onPress) : linkProps(href, onPress);
  return (
    <Pressable {...anchor} {...hover}>
      <Text style={[styles.tlink, large && styles.tlinkLarge, hovered && styles.tlinkHover]}>
        {label}
      </Text>
    </Pressable>
  );
}

// The phased law's one muted caption. "See dates" is a REAL anchor on the
// existing deep-link pattern (/bills/{id}?tab=actions, via linkProps/routePath),
// so the location stays shareable and keyboard-operable (grounded-answers rule
// 5) — the click is then intercepted to switch tabs in place, because we are
// already on that page and a raw navigation would reload it. The arrow is the
// text glyph the product already uses for inline trailing link arrows,
// aria-hidden so it is never read aloud.
//
// The three parts sit in a wrapping ROW, not inside one parent Text: RN-Web
// renders a NESTED Text as a <span> and silently drops its href, which turned the
// anchor into a role="link" span with no URL in the markup. Laid out this way the
// link is a genuine <a href>, and the caption still wraps in the narrow column
// (between the chunks) rather than truncating.
//
// The dropped-href half of that no longer holds on the installed react-native-web
// (0.21.2): Text picks span-vs-div from its ancestor and *then* overrides the tag
// to 'a' when href is set, so a nested Text keeps its anchor — which is why the
// inline bill codes inside an action sentence (ActionsTab's BillCodeLink) do come
// out as real links. The ROW layout still earns its keep for the wrapping.
function PhasedCaption({
  billId,
  onJumpToActions,
}: {
  billId: string;
  onJumpToActions: () => void;
}) {
  const [hovered, hover] = useHover();
  return (
    <View style={styles.phasedCaptionRow}>
      <Text style={styles.phasedCaption}>
        {PHASED_CAPTION}
        <Text style={styles.phasedSep}>{' · '}</Text>
      </Text>
      <Text
        {...linkProps(routePath.bill(billId, { tab: 'actions' }), onJumpToActions)}
        {...hover}
        style={[styles.phasedCaption, styles.phasedLink, hovered && styles.phasedLinkHover]}
      >
        {/* Non-breaking space: a plain one lets the arrow orphan onto its own
            line in the narrow column, leaving a lone "→" under the label. */}
        {'See dates\u00A0'}
        <Text aria-hidden style={styles.phasedArrow}>
          →
        </Text>
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: t.colors.surfaces.base,
    borderWidth: 1,
    borderColor: t.colors.alpha.ink10,
    borderRadius: t.radii.xl,
    overflow: 'hidden',
    ...(t.shadows.card as object),
  },
  section: { paddingVertical: 20, paddingHorizontal: 22 },
  sectionBordered: {
    paddingVertical: 20,
    paddingHorizontal: 22,
    borderTopWidth: 1,
    borderTopColor: t.colors.alpha.ink08,
  },
  sectionLabel: {
    fontFamily: t.typography.mono,
    fontSize: t.fontSizes.caption,
    fontWeight: t.fontWeights.bold,
    letterSpacing: 1.4,
    color: t.colors.text.muted,
  },
  standRow: {
    marginTop: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    flexWrap: 'wrap',
  },
  stageLabel: {
    fontFamily: t.typography.body,
    fontSize: t.fontSizes.bodyLg,
    fontWeight: t.fontWeights.bold,
  },
  steps: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  step: { width: 34, height: 8, borderRadius: 4 },
  dateLabel: {
    marginTop: 16,
    fontFamily: t.typography.mono,
    fontSize: t.fontSizes.caption,
    fontWeight: t.fontWeights.bold,
    letterSpacing: 1.4,
    color: t.colors.text.muted,
  },
  dateValue: {
    marginTop: 5,
    fontFamily: t.typography.body,
    fontSize: t.fontSizes.bodyLg,
    fontWeight: t.fontWeights.semibold,
    color: t.colors.text.primary,
  },
  // Phased caption — 13px muted, and it WRAPS rather than truncating.
  phasedCaptionRow: { marginTop: 6, flexDirection: 'row', flexWrap: 'wrap' },
  phasedCaption: {
    fontFamily: t.typography.body,
    fontSize: t.fontSizes.meta,
    lineHeight: 20,
    color: t.colors.text.muted,
  },
  phasedSep: { color: t.colors.text.muted },
  phasedLink: { fontWeight: t.fontWeights.bold, color: t.colors.text.green },
  phasedLinkHover: { color: t.colors.brand.forest, textDecorationLine: 'underline' },
  phasedArrow: { fontWeight: t.fontWeights.regular },
  // Same quiet caption weight as the phased-law one above: it qualifies the status
  // it sits under without competing with it (#757).
  pointerCaption: {
    marginTop: 8,
    fontFamily: t.typography.body,
    fontSize: t.fontSizes.meta,
    lineHeight: 20,
    color: t.colors.text.muted,
  },
  codeRow: { marginTop: 11, flexDirection: 'row' },
  codeBadge: {
    backgroundColor: t.colors.omnibus.fill,
    borderWidth: 1,
    borderColor: t.colors.omnibus.border,
    borderRadius: t.radii.badge,
    paddingVertical: 7,
    paddingHorizontal: 13,
  },
  codeBadgeText: {
    fontFamily: t.typography.mono,
    fontWeight: t.fontWeights.bold,
    fontSize: t.fontSizes.bodyLg,
    letterSpacing: 0.5,
    color: t.colors.omnibus.text,
  },
  linkCol: { marginTop: 12, gap: 8, alignItems: 'flex-start' },
  companionRow: { marginTop: 12, flexDirection: 'row', alignItems: 'baseline', gap: 10 },
  tlink: {
    fontFamily: t.typography.body,
    fontSize: t.fontSizes.body,
    fontWeight: t.fontWeights.bold,
    color: t.colors.text.green,
  },
  tlinkLarge: { fontSize: t.fontSizes.bodyLg },
  tlinkHover: {
    color: t.colors.brand.forest,
    textDecorationLine: 'underline',
  },
  authorHead: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: 12,
  },
  coauthors: {
    fontFamily: t.typography.body,
    fontSize: t.fontSizes.label,
    color: t.colors.text.muted,
  },
  authorNamePlain: {
    fontFamily: t.typography.body,
    fontSize: t.fontSizes.body,
    fontWeight: t.fontWeights.semibold,
    color: t.colors.text.primary,
    flex: 1,
  },
  authorFields: { marginTop: 12, gap: 9 },
  authorFieldRow: { flexDirection: 'row', alignItems: 'baseline', gap: 12 },
  authorFieldLabel: {
    fontFamily: t.typography.body,
    fontSize: t.fontSizes.meta,
    color: t.colors.text.muted,
    minWidth: 116,
    flexShrink: 0,
  },
  authorFieldValue: {
    fontFamily: t.typography.body,
    fontSize: t.fontSizes.meta,
    fontWeight: t.fontWeights.medium,
    color: t.colors.text.primary,
    flex: 1,
  },
  issueRow: {
    marginTop: 12,
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 9,
  },
  issueChip: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    backgroundColor: t.colors.surfaces.s400,
    borderRadius: t.radii.sm,
  },
  issueChipText: {
    fontFamily: t.typography.body,
    fontSize: t.fontSizes.label,
    fontWeight: t.fontWeights.bold,
    letterSpacing: 0.7,
    color: t.colors.text.secondary,
  },
});
