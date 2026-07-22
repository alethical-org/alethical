import { Pressable, StyleSheet, Text, View } from 'react-native';

import { theme as t } from '../../theme/tokens';
import { Bill } from '../../data/types';
import { formatMonoDate, orderBillVersions, versionTrackTag } from '../../lib/billDetail';
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
          const chapter = law ? extractChapter(v.summary) || extractChapter(v.label) : null;
          const tag = law ? null : versionTrackTag(v.label);
          return (
            <VersionRow
              key={v.id}
              // The chapter shows once, in the CHAPTER chip — strip it from the title so
              // an enacted row reads "Session Law", not "Session Law — Chapter N" twice.
              name={chapter ? stripChapterSuffix(v.label) : v.label}
              date={formatMonoDate(v.date)}
              law={law}
              chapter={chapter}
              tag={tag}
              // Unofficial engrossments fold in amendments between numbered drafts, so by
              // date they can sit out of numeric order — a faint "working draft" note
              // explains the apparent jump without changing the date-descending order.
              hint={tag === 'UNOFFICIAL' ? 'working draft' : null}
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

// Drop a trailing "— Chapter N" (em/en dash or hyphen) from a Session Law title so the
// chapter isn't shown twice — it lives in the CHAPTER chip. Falls back to "Session Law"
// if stripping leaves nothing (display only; never re-authors the source record).
function stripChapterSuffix(label: string): string {
  const stripped = label.replace(/\s*[—–-]?\s*chapter\s+\d+\s*$/i, '').trim();
  return stripped || 'Session Law';
}

function VersionRow({
  name,
  date,
  law,
  chapter,
  tag,
  hint,
  linkLabel,
  onPress,
}: {
  name: string;
  date: string;
  law: boolean;
  chapter: string | null;
  tag: 'UNOFFICIAL' | 'CONFERENCE' | null;
  hint: string | null;
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
          ) : tag ? (
            <View style={styles.trackTag}>
              <Text style={styles.trackTagText}>{tag}</Text>
            </View>
          ) : null}
        </View>
        {date || hint ? (
          <Text style={styles.rowDate}>
            {date}
            {date && hint ? '  ·  ' : ''}
            {hint ? <Text style={styles.rowHint}>{hint}</Text> : null}
          </Text>
        ) : null}
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
  // Neutral grey track marker (UNOFFICIAL / CONFERENCE) — deliberately NOT amber;
  // amber is reserved for the bill/law CODE and omnibus indicators.
  trackTag: {
    paddingVertical: 3,
    paddingHorizontal: 8,
    backgroundColor: t.colors.alpha.ink06,
    borderRadius: t.radii.badge,
  },
  trackTagText: {
    fontFamily: t.typography.mono,
    fontSize: t.fontSizes.caption,
    fontWeight: t.fontWeights.bold,
    letterSpacing: 1.1,
    color: t.colors.text.faint,
  },
  rowDate: {
    marginTop: 3,
    fontFamily: t.typography.mono,
    fontSize: t.fontSizes.label,
    letterSpacing: 0.5,
    color: t.colors.text.muted,
  },
  // Faint clarifier ("working draft") on unofficial engrossments — same meta line
  // as the date, dimmer than the date so it reads as an aside, not a second label.
  rowHint: {
    fontStyle: 'italic',
    color: t.colors.text.faint,
    letterSpacing: 0.3,
  },
  rowLink: {
    fontFamily: t.typography.ui,
    fontSize: t.fontSizes.meta,
    fontWeight: t.fontWeights.bold,
    letterSpacing: 0.5,
    color: t.colors.text.green,
  },
});
