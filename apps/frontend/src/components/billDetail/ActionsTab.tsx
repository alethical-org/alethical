import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { theme as t } from '../../theme/tokens';
import { Bill } from '../../data/types';
import { buildActionTimeline, TimelineDot, TimelineRow } from '../../lib/billDetail';
import { SourceLine } from './SourceLine';
import { useHover } from './interactions';

// Up to this many co-author names show before the muted group row collapses the
// rest behind a "+N more" toggle (point 4 — a quiet annotation, not a name-wall).
const NAME_CAP = 3;

// Actions tab — dot legend + reverse-chronological, plain-language timeline built
// from the raw MN Revisor status records by buildActionTimeline (spec §Actions
// tab; issue #552). All normalization (plain titles, dedupe, chamber-labeled
// tallies, collapsed author-adds, scheduled dots) lives in the shared builder.
export function ActionsTab({
  bill,
  onViewVotes,
  updatedLabel,
}: {
  bill: Bill;
  onViewVotes: (rollIdx: number) => void;
  updatedLabel: string;
}) {
  // "Now" is the real current date, not the corpus stamp: an action is SCHEDULED
  // only if genuinely still in the future. Anchoring to the Updated stamp
  // mislabeled already-past enacted milestones (#537/#541).
  const { rows, glossary } = useMemo(
    () => buildActionTimeline(bill.actions, bill.votes, new Date()),
    [bill.actions, bill.votes],
  );
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const toggle = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <View>
      {/* Dot legend */}
      <View style={styles.legend}>
        <LegendItem color={t.colors.brand.base} label="Enacted milestone" />
        <LegendItem color={t.colors.text.primary} label="Recorded vote" />
        <LegendItem hollow label="Procedural step" />
        <LegendItem color={t.colors.status.vetoedStep} label="Not adopted" />
        <LegendItem dashed label="Scheduled" />
      </View>

      <View style={styles.timeline}>
        {rows.map((row) => (
          <Row
            key={row.id}
            row={row}
            expanded={expanded.has(row.id)}
            onToggle={() => toggle(row.id)}
            onViewVotes={onViewVotes}
          />
        ))}
      </View>

      {glossary.length ? (
        <View style={styles.keyBox}>
          <Text style={styles.keyLabel}>PLAIN-LANGUAGE KEY</Text>
          <View style={styles.keyGrid}>
            {glossary.map((g) => (
              <Text key={g.term} style={[styles.keyItem, styles.keyItemCol]}>
                <Text style={styles.keyTerm}>{g.term}</Text>
                <Text> — {g.def}</Text>
              </Text>
            ))}
          </View>
        </View>
      ) : null}

      <SourceLine
        text={`Source: Minnesota Legislature · bill status records · revisor.mn.gov · ${updatedLabel}`}
      />
    </View>
  );
}

function Row({
  row,
  expanded,
  onToggle,
  onViewVotes,
}: {
  row: TimelineRow;
  expanded: boolean;
  onToggle: () => void;
  onViewVotes: (rollIdx: number) => void;
}) {
  const isGroup = !!row.authors && row.authors.length > 1;
  return (
    <View style={styles.row}>
      <View style={styles.dateCol}>
        <Text style={[styles.date, row.muted && styles.dateMuted]}>{row.date}</Text>
        {row.dateRange ? <Text style={styles.dateRangeEnd}>{rangeEnd(row.dateRange)}</Text> : null}
      </View>
      <View style={styles.dotCol}>
        <View style={styles.line} />
        <Dot dot={row.dot} />
      </View>
      <View style={styles.content}>
        <View style={styles.titleRow}>
          {row.authors ? (
            <AuthorTitle row={row} expanded={expanded} onToggle={onToggle} isGroup={isGroup} />
          ) : (
            <Text style={styles.title}>{row.title}</Text>
          )}
          {row.tally ? (
            <View style={styles.tallyChip}>
              <Text style={styles.tallyChipText}>{row.tally}</Text>
            </View>
          ) : null}
          {row.dot === 'scheduled' ? (
            <View style={styles.scheduledBadge}>
              <Text style={styles.scheduledText}>SCHEDULED</Text>
            </View>
          ) : null}
        </View>
        {row.showVotes ? <ViewVotesLink onPress={() => onViewVotes(row.rollIdx ?? 0)} /> : null}
      </View>
    </View>
  );
}

// A muted co-author group: "N co-authors added — name, name, name +M more".
// Names beyond NAME_CAP hide behind an in-place toggle (point 4).
function AuthorTitle({
  row,
  expanded,
  onToggle,
  isGroup,
}: {
  row: TimelineRow;
  expanded: boolean;
  onToggle: () => void;
  isGroup: boolean;
}) {
  const names = row.authors ?? [];
  if (!isGroup) {
    return <Text style={styles.authorTitle}>Co-author added — {names[0] ?? ''}</Text>;
  }
  const hidden = Math.max(0, names.length - NAME_CAP);
  const shown = expanded ? names : names.slice(0, NAME_CAP);
  return (
    <Text style={styles.authorTitle}>
      {names.length} co-authors added — {shown.join(', ')}
      {hidden > 0 ? (
        <Text onPress={onToggle} style={styles.moreLink}>
          {expanded ? '  show less' : `  +${hidden} more`}
        </Text>
      ) : null}
    </Text>
  );
}

function Dot({ dot }: { dot: TimelineDot }) {
  if (dot === 'scheduled') return <View style={[styles.dot, styles.dotScheduled]} />;
  if (dot === 'green') return <View style={[styles.dot, styles.dotGreen]} />;
  if (dot === 'red') return <View style={[styles.dot, styles.dotRed]} />;
  if (dot === 'vote') return <View style={[styles.dot, styles.dotVote]} />;
  return <View style={styles.dotPlain} />;
}

function LegendItem({
  color,
  label,
  hollow,
  dashed,
}: {
  color?: string;
  label: string;
  hollow?: boolean;
  dashed?: boolean;
}) {
  return (
    <View style={styles.legendItem}>
      <View
        style={[
          styles.legendDot,
          hollow && styles.legendHollow,
          dashed && styles.legendDashed,
          color ? { backgroundColor: color } : null,
        ]}
      />
      <Text style={styles.legendLabel}>{label}</Text>
    </View>
  );
}

function ViewVotesLink({ onPress }: { onPress: () => void }) {
  const [hovered, hover] = useHover();
  return (
    <Pressable accessibilityRole="button" onPress={onPress} {...hover} style={styles.viewVotes}>
      <Text style={[styles.viewVotesText, hovered && styles.viewVotesHover]}>View votes →</Text>
    </Pressable>
  );
}

// "FEB 20, 2025 – APR 10, 2025" → "– APR 10, 2025" for the date cell's 2nd line.
function rangeEnd(range: string): string {
  const parts = range.split(' – ');
  return parts.length === 2 ? `– ${parts[1]}` : '';
}

const styles = StyleSheet.create({
  legend: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 18,
  },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  legendDot: { width: 11, height: 11, borderRadius: 6, backgroundColor: t.colors.brand.base },
  legendHollow: {
    backgroundColor: t.colors.surfaces.base,
    borderWidth: 2,
    borderColor: '#c9cec9',
  },
  legendDashed: {
    backgroundColor: t.colors.surfaces.base,
    borderWidth: 2,
    borderStyle: 'dashed',
    borderColor: t.colors.brand.base,
  },
  legendLabel: {
    fontFamily: t.typography.body,
    fontSize: t.fontSizes.label,
    color: t.colors.text.muted,
  },
  timeline: { marginTop: 40 },
  row: { flexDirection: 'row', gap: 20 },
  dateCol: { width: 118, alignItems: 'flex-end', paddingTop: 5 },
  date: {
    textAlign: 'right',
    fontFamily: t.typography.mono,
    fontSize: t.fontSizes.label,
    letterSpacing: 0.5,
    color: t.colors.text.muted,
  },
  dateMuted: { color: '#9aa09a' },
  dateRangeEnd: {
    textAlign: 'right',
    marginTop: 2,
    fontFamily: t.typography.mono,
    fontSize: t.fontSizes.caption,
    letterSpacing: 0.5,
    color: '#9aa09a',
  },
  dotCol: { width: 26, position: 'relative', alignItems: 'flex-start' },
  line: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 12,
    width: 2,
    backgroundColor: t.colors.alpha.ink08,
  },
  dot: {
    position: 'absolute',
    top: 6,
    left: 6,
    width: 14,
    height: 14,
    borderRadius: 7,
  },
  dotGreen: {
    backgroundColor: t.colors.brand.base,
    ...(t.shadows.focus as object),
  },
  dotRed: { backgroundColor: t.colors.status.vetoedStep },
  dotVote: { backgroundColor: t.colors.text.primary },
  dotPlain: {
    position: 'absolute',
    top: 8,
    left: 8,
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: t.colors.surfaces.base,
    borderWidth: 2,
    borderColor: '#c9cec9',
  },
  dotScheduled: {
    backgroundColor: t.colors.surfaces.base,
    borderWidth: 2,
    borderStyle: 'dashed',
    borderColor: t.colors.brand.base,
  },
  content: { flex: 1, minWidth: 0, paddingBottom: 26 },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    flexWrap: 'wrap',
  },
  title: {
    fontFamily: t.typography.body,
    fontSize: t.fontSizes.lg,
    fontWeight: t.fontWeights.bold,
    color: t.colors.text.primary,
    flexShrink: 1,
  },
  // Muted co-author annotation: smaller, grey, not a milestone beat (point 4).
  authorTitle: {
    fontFamily: t.typography.body,
    fontSize: t.fontSizes.small,
    fontWeight: t.fontWeights.regular,
    color: '#6f756f',
    flexShrink: 1,
  },
  moreLink: {
    fontFamily: t.typography.ui,
    fontSize: t.fontSizes.small,
    fontWeight: t.fontWeights.bold,
    color: t.colors.text.green,
  },
  tallyChip: {
    paddingVertical: 3,
    paddingHorizontal: 9,
    backgroundColor: t.colors.surfaces.s400,
    borderRadius: t.radii.badge,
  },
  tallyChipText: {
    fontFamily: t.typography.mono,
    fontSize: t.fontSizes.small,
    fontWeight: t.fontWeights.bold,
    color: t.colors.text.primary,
  },
  scheduledBadge: {
    paddingVertical: 4,
    paddingHorizontal: 10,
    backgroundColor: t.colors.surfaces.base,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: t.colors.brand.base,
    borderRadius: t.radii.badge,
  },
  scheduledText: {
    fontFamily: t.typography.body,
    fontSize: t.fontSizes.caption,
    fontWeight: t.fontWeights.bold,
    letterSpacing: 0.8,
    color: t.colors.brand.deep,
  },
  viewVotes: { marginTop: 8, alignSelf: 'flex-start' },
  viewVotesText: {
    fontFamily: t.typography.ui,
    fontSize: t.fontSizes.meta,
    fontWeight: t.fontWeights.bold,
    letterSpacing: 0.5,
    color: t.colors.text.green,
  },
  viewVotesHover: { color: t.colors.brand.forest, textDecorationLine: 'underline' },
  keyBox: {
    marginTop: 24,
    paddingTop: 20,
    borderTopWidth: 1,
    borderTopColor: t.colors.alpha.ink08,
  },
  keyLabel: {
    fontFamily: t.typography.mono,
    fontSize: t.fontSizes.caption,
    fontWeight: t.fontWeights.bold,
    letterSpacing: 1.4,
    color: t.colors.text.muted,
  },
  // Two-column definition grid (design uses grid-template-columns:1fr 1fr).
  keyGrid: { marginTop: 14, flexDirection: 'row', flexWrap: 'wrap', columnGap: 40, rowGap: 10 },
  keyItemCol: { width: '46%', minWidth: 220, flexGrow: 1 },
  keyItem: {
    fontFamily: t.typography.body,
    fontSize: t.fontSizes.small,
    lineHeight: 21,
    color: t.colors.text.secondary,
  },
  keyTerm: { fontWeight: t.fontWeights.bold, color: t.colors.text.primary },
});
