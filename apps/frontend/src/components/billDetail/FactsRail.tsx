import { Pressable, StyleSheet, Text, View } from 'react-native';

import { theme as t } from '../../theme/tokens';
import { Bill } from '../../data/types';
import { titleCaseIssue } from '../../lib/issues';
import {
  authorDisplayName,
  billStage,
  chamberBillLabel,
  chiefAuthor,
  coAuthorCount,
  formatNiceDate,
  isKnownDistrict,
  isLaw,
  partyFull,
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
}: {
  bill: Bill;
  onOpenUrl: (url: string) => void;
  onOpenLegislator: (legislatorId: string) => void;
  onOpenBill: (billId: string) => void;
}) {
  const { index, tone } = billStage(bill.status);
  const label = stageLabel(bill.status);
  const law = isLaw(bill.status);

  const dateLabel = law ? 'EFFECTIVE' : 'LATEST ACTION';
  const dateValue = law
    ? formatNiceDate(bill.updatedAt)
    : bill.latestActionText
      ? `${bill.latestActionText}${bill.updatedAt ? ` · ${formatNiceDate(bill.updatedAt)}` : ''}`
      : formatNiceDate(bill.updatedAt);

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
            <TextLink label="Bill overview →" onPress={() => onOpenUrl(overviewUrl)} />
          ) : null}
          {readUrl ? (
            <TextLink label={`${readLabel(bill.status)} →`} onPress={() => onOpenUrl(readUrl)} />
          ) : null}
        </View>
        {bill.companion ? (
          <View style={styles.companionRow}>
            <Text style={styles.authorFieldLabel}>Companion</Text>
            <TextLink
              label={`${bill.companion.chamber} (${bill.companion.identifier}) →`}
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
          <View style={styles.authorName}>
            {author.legislatorId ? (
              <TextLink
                label={`${authorDisplayName(author.name, author.chamber)} →`}
                large
                onPress={() => onOpenLegislator(author.legislatorId as string)}
              />
            ) : (
              <Text style={styles.authorNamePlain}>
                {authorDisplayName(author.name, author.chamber)}
              </Text>
            )}
          </View>
          <View style={styles.authorFields}>
            {author.party ? (
              <View style={styles.authorFieldRow}>
                <Text style={styles.authorFieldLabel}>Party</Text>
                <Text style={styles.authorFieldValue}>{partyFull(author.party)}</Text>
              </View>
            ) : null}
            {isKnownDistrict(author.district) ? (
              <View style={styles.authorFieldRow}>
                <Text style={styles.authorFieldLabel}>District</Text>
                <Text style={styles.authorFieldValue}>{author.district}</Text>
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
  onPress,
  large,
}: {
  label: string;
  onPress: () => void;
  large?: boolean;
}) {
  const [hovered, hover] = useHover();
  return (
    <Pressable accessibilityRole="link" onPress={onPress} {...hover}>
      <Text style={[styles.tlink, large && styles.tlinkLarge, hovered && styles.tlinkHover]}>
        {label}
      </Text>
    </Pressable>
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
  authorName: { marginTop: 11 },
  authorNamePlain: {
    fontFamily: t.typography.body,
    fontSize: t.fontSizes.bodyLg,
    fontWeight: t.fontWeights.semibold,
    color: t.colors.text.primary,
  },
  authorFields: { marginTop: 10, gap: 6 },
  authorFieldRow: { flexDirection: 'row', gap: 10 },
  authorFieldLabel: {
    fontFamily: t.typography.body,
    fontSize: t.fontSizes.meta,
    color: t.colors.text.muted,
    minWidth: 52,
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
