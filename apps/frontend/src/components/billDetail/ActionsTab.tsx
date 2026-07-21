import { Pressable, StyleSheet, Text, View } from 'react-native';

import { theme as t } from '../../theme/tokens';
import { Bill, VoteEvent } from '../../data/types';
import {
  DotKind,
  dotKind,
  formatMonoDate,
  parseActionDate,
  rollIndexForAction,
} from '../../lib/billDetail';
import { SourceLine } from './SourceLine';
import { useHover } from './interactions';

// Static MN-legislature term dictionary. The key is shown only when the term
// actually appears in one of this bill's action descriptions (spec: generate the
// key dynamically from terms present). Superseded by inline tooltips when they ship.
const GLOSSARY: Array<{ term: string; match: RegExp; def: string }> = [
  {
    term: 'First reading',
    match: /first reading|introduced/i,
    def: "a bill's formal introduction, by title.",
  },
  {
    term: 'Second reading',
    match: /second reading/i,
    def: 'a procedural step placing a bill on general orders.',
  },
  {
    term: 'Third reading',
    match: /third reading/i,
    def: 'the final floor vote to pass a bill in a chamber.',
  },
  {
    term: 'Committee report',
    match: /committee report/i,
    def: 'a committee recommends what should happen to the bill.',
  },
  {
    term: 'Re-referred',
    match: /re-referred|rereferred/i,
    def: 'sent to another committee for more review.',
  },
  { term: 'Referred', match: /referred/i, def: 'assigned to a committee for review.' },
  {
    term: 'Concurred',
    match: /concur/i,
    def: "one chamber accepted the other's changes, avoiding a conference.",
  },
  { term: 'Repassed', match: /repass/i, def: 'passed again after amendments were reconciled.' },
  { term: 'Voice vote', match: /voice vote/i, def: 'a spoken aye/nay with no names recorded.' },
  {
    term: 'Veto',
    match: /veto/i,
    def: 'the Governor returned the bill unsigned; an override needs a two-thirds vote in each chamber.',
  },
  { term: 'Amendment', match: /amend/i, def: 'a proposed change to the bill text.' },
  {
    term: 'Presented to the Governor',
    match: /presented to the governor/i,
    def: 'the enrolled bill was delivered to the Governor to sign or veto.',
  },
];

type Row = {
  id: string;
  date: string;
  title: string;
  kind: DotKind;
  upcoming: boolean;
  adopted: boolean;
  notAdopted: boolean;
  tally?: string;
  rollIdx: number | null;
  showVotes: boolean;
};

// Actions tab — dot legend + reverse-chronological timeline (spec §Actions tab).
export function ActionsTab({
  bill,
  onViewVotes,
  updatedLabel,
}: {
  bill: Bill;
  onViewVotes: (rollIdx: number) => void;
  updatedLabel: string;
}) {
  // "Now" is the real current date, not the bill's last-action date: an action is
  // only SCHEDULED if it's genuinely still in the future (e.g. a phased effective
  // date). Using updatedAt mis-flagged already-past enacted milestones (signing,
  // effective) that carry their date in the description with a null action_at, so
  // they never counted toward updatedAt.
  const now = new Date();

  const rows: Row[] = [...bill.actions]
    .sort((a, b) => {
      const da = parseActionDate(a.date)?.getTime() ?? 0;
      const db = parseActionDate(b.date)?.getTime() ?? 0;
      return db - da; // newest first
    })
    .map((a) => {
      const rollIdx = rollIndexForAction(a, bill.votes);
      const d = parseActionDate(a.date);
      const desc = a.description || '';
      const hasTally = !!a.tally;
      const kind = dotKind(desc, hasTally);
      const upcoming = !!d && d > now;
      return {
        id: a.id,
        date: formatMonoDate(a.date),
        title: desc,
        kind,
        upcoming,
        adopted: /(?:^|\b)adopted\b/i.test(desc) && !/not adopted/i.test(desc),
        notAdopted: /not adopted/i.test(desc),
        tally: a.tally,
        rollIdx,
        // "View votes →" only when this action's tally matches an ingested roll call
        // (so Actions and the Votes tab agree — no link to a roll that isn't there).
        showVotes: !upcoming && rollIdx != null,
      };
    });

  const glossary = GLOSSARY.filter((g) =>
    bill.actions.some((a) => g.match.test(a.description || '')),
  );

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
          <View key={row.id} style={styles.row}>
            <Text style={styles.date}>{row.date}</Text>
            <View style={styles.dotCol}>
              <View style={styles.line} />
              <Dot kind={row.kind} upcoming={row.upcoming} />
            </View>
            <View style={styles.content}>
              <View style={styles.titleRow}>
                <Text style={[styles.title, row.upcoming && styles.titleMuted]}>{row.title}</Text>
                {row.tally ? (
                  <View style={styles.tallyChip}>
                    <Text style={styles.tallyChipText}>{row.tally.replace(/-/g, '–')}</Text>
                  </View>
                ) : null}
                {row.upcoming ? (
                  <View style={styles.scheduledBadge}>
                    <Text style={styles.scheduledText}>SCHEDULED</Text>
                  </View>
                ) : null}
                {row.adopted ? (
                  <View style={styles.adoptedPill}>
                    <Text style={styles.adoptedText}>ADOPTED</Text>
                  </View>
                ) : null}
                {row.notAdopted ? (
                  <View style={styles.notAdoptedPill}>
                    <Text style={styles.notAdoptedText}>NOT ADOPTED</Text>
                  </View>
                ) : null}
              </View>
              {row.showVotes ? (
                <ViewVotesLink onPress={() => onViewVotes(row.rollIdx ?? 0)} />
              ) : null}
            </View>
          </View>
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

function Dot({ kind, upcoming }: { kind: DotKind; upcoming: boolean }) {
  if (upcoming) return <View style={[styles.dot, styles.dotScheduled]} />;
  if (kind === 'green') return <View style={[styles.dot, styles.dotGreen]} />;
  if (kind === 'red') return <View style={[styles.dot, styles.dotRed]} />;
  if (kind === 'vote') return <View style={[styles.dot, styles.dotVote]} />;
  return <View style={[styles.dotPlain]} />;
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
  date: {
    width: 118,
    textAlign: 'right',
    paddingTop: 5,
    fontFamily: t.typography.mono,
    fontSize: t.fontSizes.label,
    letterSpacing: 0.5,
    color: t.colors.text.muted,
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
  titleMuted: { color: t.colors.text.muted, fontWeight: t.fontWeights.semibold },
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
  adoptedPill: {
    paddingVertical: 4,
    paddingHorizontal: 10,
    backgroundColor: t.colors.tint.t150,
    borderWidth: 1,
    borderColor: t.colors.tint.border,
    borderRadius: t.radii.badge,
  },
  adoptedText: {
    fontFamily: t.typography.body,
    fontSize: t.fontSizes.caption,
    fontWeight: t.fontWeights.bold,
    letterSpacing: 0.8,
    color: t.colors.brand.deep,
  },
  notAdoptedPill: {
    paddingVertical: 4,
    paddingHorizontal: 10,
    backgroundColor: '#fdecec',
    borderWidth: 1,
    borderColor: '#f5c6c4',
    borderRadius: t.radii.badge,
  },
  notAdoptedText: {
    fontFamily: t.typography.body,
    fontSize: t.fontSizes.caption,
    fontWeight: t.fontWeights.bold,
    letterSpacing: 0.8,
    color: t.colors.dangerRamp.r600,
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
