import { Pressable, StyleSheet, Text, View } from 'react-native';

import { theme as t } from '../../theme/tokens';
import { Bill } from '../../data/types';
import { formatMonoDate, orderBillVersions } from '../../lib/billDetail';
import { SourceLine } from './SourceLine';
import { useHover } from './interactions';

// Versions tab — one card row per version linking to the official document. Session
// Law rows carry a ghosted-amber CHAPTER chip + "Read the full law" (spec §Versions).
export function VersionsTab({
  bill,
  onOpenUrl,
  updatedLabel,
}: {
  bill: Bill;
  onOpenUrl: (url: string) => void;
  updatedLabel: string;
}) {
  return (
    <View>
      <Text style={styles.intro}>
        A bill’s exact wording changes as it moves through the Legislature. Each version is a
        snapshot of the full text at one stage — from the day it was introduced to the final law —
        and links to the official document. An <Text style={styles.introStrong}>engrossment</Text>{' '}
        is an updated draft that folds in the latest amendments.
      </Text>

      <View style={styles.rows}>
        {orderBillVersions(bill.versions, bill.actions).map((v) => {
          const law = /session law|chapter|final law/i.test(v.label);
          return (
            <VersionRow
              key={v.id}
              name={v.label}
              date={formatMonoDate(v.date)}
              law={law}
              chapter={law ? extractChapter(v.summary) || extractChapter(v.label) : null}
              linkLabel={law ? 'Read the full law' : 'Read the bill text'}
              onPress={() => (v.url ? onOpenUrl(v.url) : undefined)}
            />
          );
        })}
      </View>

      <SourceLine text={`Source: Minnesota Legislature · revisor.mn.gov · ${updatedLabel}`} />
    </View>
  );
}

function extractChapter(text: string | undefined): string | null {
  if (!text) return null;
  const m = text.match(/chapter\s+(\d+)/i);
  return m ? `CHAPTER ${m[1]}` : null;
}

function VersionRow({
  name,
  date,
  law,
  chapter,
  linkLabel,
  onPress,
}: {
  name: string;
  date: string;
  law: boolean;
  chapter: string | null;
  linkLabel: string;
  onPress: () => void;
}) {
  const [hovered, hover] = useHover();
  return (
    <Pressable
      accessibilityRole="link"
      onPress={onPress}
      {...hover}
      style={[styles.row, hovered && styles.rowHover]}
    >
      <View style={styles.rowMain}>
        <View style={styles.rowTitleRow}>
          <Text style={styles.rowName}>{name}</Text>
          {law && chapter ? (
            <View style={styles.chapterChip}>
              <Text style={styles.chapterText}>{chapter}</Text>
            </View>
          ) : null}
        </View>
        {date ? <Text style={styles.rowDate}>{date}</Text> : null}
      </View>
      <Text style={styles.rowLink}>{linkLabel} →</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  intro: {
    fontFamily: t.typography.body,
    fontSize: t.fontSizes.body,
    lineHeight: 23,
    color: t.colors.text.faint,
  },
  introStrong: { fontWeight: t.fontWeights.semibold, color: t.colors.text.secondary },
  rows: { marginTop: 22, gap: 12 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    backgroundColor: t.colors.surfaces.base,
    borderWidth: 1,
    borderColor: t.colors.alpha.ink08,
    borderRadius: t.radii.lg,
    paddingVertical: 18,
    paddingHorizontal: 24,
  },
  rowHover: { borderColor: t.colors.brand.base },
  rowMain: { flex: 1, minWidth: 0 },
  rowTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 10, flexWrap: 'wrap' },
  rowName: {
    fontFamily: t.typography.body,
    fontSize: t.fontSizes.lg,
    fontWeight: t.fontWeights.bold,
    color: t.colors.text.primary,
  },
  chapterChip: {
    paddingVertical: 4,
    paddingHorizontal: 10,
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: t.colors.omnibus.border,
    borderRadius: t.radii.badge,
  },
  chapterText: {
    fontFamily: t.typography.mono,
    fontSize: t.fontSizes.caption,
    fontWeight: t.fontWeights.bold,
    letterSpacing: 0.6,
    color: t.colors.omnibus.text,
  },
  rowDate: {
    marginTop: 3,
    fontFamily: t.typography.mono,
    fontSize: t.fontSizes.label,
    letterSpacing: 0.5,
    color: t.colors.text.muted,
  },
  rowLink: {
    fontFamily: t.typography.ui,
    fontSize: t.fontSizes.meta,
    fontWeight: t.fontWeights.bold,
    letterSpacing: 0.5,
    color: t.colors.text.green,
  },
});
