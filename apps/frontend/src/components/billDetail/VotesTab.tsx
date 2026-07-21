import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';

import { theme as t } from '../../theme/tokens';
import { Bill, VoteEvent } from '../../data/types';
import { fieldFocusRing, fieldOutlineReset, useFieldFocus } from '../../theme/fieldFocus';
import {
  buildPartyBlocks,
  formatMonoDate,
  MemberVote,
  partyFull,
  PartyBlock,
  rollPassed,
  validateRoll,
} from '../../lib/billDetail';
import { SourceLine } from './SourceLine';
import { isWeb, useHover } from './interactions';

type RollFilter = 'all' | 'yes' | 'no' | 'abs';

// Votes tab — roll-call cards with party-grouped member grids, crossover dots,
// filters/search, your-legislators, and the in-committee empty state (spec §Votes).
export function VotesTab({
  bill,
  chiefParty,
  onOpenLegislator,
  onOpenUrl,
  onAsk,
  updatedLabel,
}: {
  bill: Bill;
  chiefParty: string | undefined;
  onOpenLegislator: (legislatorId: string) => void;
  onOpenUrl: (url: string) => void;
  onAsk: () => void;
  updatedLabel: string;
}) {
  // Independent toggles: web seeds the first roll open (spec §Independent toggles).
  const [openRolls, setOpenRolls] = useState<Record<number, boolean>>({ 0: true });

  if (!bill.votes.length) {
    return <NoVotes identifier={bill.identifier} onAsk={onAsk} updatedLabel={updatedLabel} />;
  }

  // Grounded framing: describe records, never assert an inferred partisan pattern.
  // The party grouping + crossover story is backed by per-member data — only frame
  // it (and show the crossover legend) when that data is present AND the chief
  // author's party is actually known. Otherwise keep a neutral one-liner so we
  // never claim, e.g., "Republicans opposed it" on a unanimous or unknown-party roll.
  const hasMemberData = bill.votes.some((v) => v.votes.length > 0);
  const partyKnown = !!chiefParty && chiefParty.trim() !== '';
  const framed = hasMemberData && partyKnown;
  const chief = partyFull(chiefParty);

  return (
    <View>
      {framed ? (
        <>
          <Text style={styles.intro}>
            Each recorded <Text style={styles.introStrong}>roll call</Text> lists how members voted,
            grouped by party. The chief author is a <Text style={styles.introStrong}>{chief}</Text>{' '}
            legislator.
          </Text>
          <View style={styles.crossLegend}>
            <View style={styles.crossDotInline} />
            <Text style={styles.crossLegendText}>
              marks members who voted against their party’s majority
            </Text>
          </View>
        </>
      ) : (
        <Text style={styles.intro}>
          Each recorded <Text style={styles.introStrong}>roll call</Text> lists how members voted.
        </Text>
      )}

      <View style={styles.rolls}>
        {bill.votes.map((vote, i) => (
          <RollCard
            key={vote.id}
            vote={vote}
            open={!!openRolls[i]}
            onToggle={() => setOpenRolls((s) => ({ ...s, [i]: !s[i] }))}
            onOpenLegislator={onOpenLegislator}
            onOpenUrl={onOpenUrl}
          />
        ))}
      </View>

      <SourceLine
        text={`Source: Minnesota Legislature · roll-call records · revisor.mn.gov · ${updatedLabel}`}
      />
    </View>
  );
}

function RollCard({
  vote,
  open,
  onToggle,
  onOpenLegislator,
  onOpenUrl,
}: {
  vote: VoteEvent;
  open: boolean;
  onToggle: () => void;
  onOpenLegislator: (legislatorId: string) => void;
  onOpenUrl: (url: string) => void;
}) {
  const [hovered, hover] = useHover();
  const [filter, setFilter] = useState<RollFilter>('all');
  const [search, setSearch] = useState('');
  const { focused, focusProps } = useFieldFocus();

  const passed = rollPassed(vote.result);
  const { yes, no, absent } = vote.breakdown;
  const total = yes + no + absent;
  const barYes = total > 0 ? (yes / total) * 100 : 0;
  const barNo = total > 0 ? (no / total) * 100 : 0;
  const hasMembers = vote.votes.length > 0;

  const blocks = useMemo(
    () => (hasMembers ? buildPartyBlocks(vote.votes) : []),
    [vote.votes, hasMembers],
  );
  if (hasMembers) validateRoll(blocks, yes, no);

  const q = search.trim().toLowerCase();
  const matchTab = (m: MemberVote) =>
    filter === 'all'
      ? true
      : filter === 'yes'
        ? m.vote === 'YES'
        : filter === 'no'
          ? m.vote === 'NO'
          : m.vote === 'ABSENT';
  const matchQ = (m: MemberVote) => !q || m.name.toLowerCase().includes(q);

  return (
    <View style={[styles.card, hovered && !open && (styles.cardHover as object)]}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        onPress={onToggle}
        {...hover}
        style={styles.cardHead}
      >
        <View style={styles.cardHeadMain}>
          <Text style={styles.motion}>{vote.motion}</Text>
        </View>
        <View style={styles.cardHeadRight}>
          <View style={styles.badgeSlot}>
            {passed ? (
              <View style={styles.passedBadge}>
                <Text style={styles.passedText}>PASSED</Text>
              </View>
            ) : (
              <View style={styles.failedBadge}>
                <Text style={styles.failedText}>FAILED</Text>
              </View>
            )}
          </View>
          <View style={styles.tallySlot}>
            <Text style={styles.tally}>
              {yes}–{no}
            </Text>
            {absent > 0 ? <Text style={styles.absent}>{absent} didn’t vote</Text> : null}
          </View>
          {hasMembers ? (
            <View style={[styles.seeWho, open && styles.seeWhoOpen]}>
              <Text style={[styles.seeWhoText, open && styles.seeWhoTextOpen]}>
                {open ? 'Hide who voted' : 'See who voted'}
              </Text>
              <Svg width={14} height={14} viewBox="0 0 24 24" fill="none">
                <Path
                  d={open ? 'M6 15 L12 9 L18 15' : 'M6 9 L12 15 L18 9'}
                  stroke={open ? t.colors.text.primary : t.colors.white}
                  strokeWidth={2.4}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </Svg>
            </View>
          ) : null}
        </View>
      </Pressable>

      {/* meta: date (when served) + official-record link — outside the toggle button
          so the link isn't an interactive element nested inside a button. */}
      {vote.date || vote.officialUrl ? (
        <View style={styles.metaRow}>
          {vote.date ? <Text style={styles.meta}>{formatMonoDate(vote.date)}</Text> : null}
          {vote.date && vote.officialUrl ? <Text style={styles.meta}> · </Text> : null}
          {vote.officialUrl ? <RecordLink url={vote.officialUrl} onOpen={onOpenUrl} /> : null}
        </View>
      ) : null}

      {/* proportion bar */}
      <View style={styles.bar}>
        <View style={[styles.barYes, { flexGrow: barYes }]} />
        <View style={[styles.barNo, { flexGrow: barNo }]} />
        {absent > 0 ? <View style={styles.barRest} /> : null}
      </View>

      {open && hasMembers ? (
        <View style={styles.expand}>
          <View style={styles.filterBar}>
            <View style={styles.segmented}>
              <FilterSeg
                label={`All ${total}`}
                active={filter === 'all'}
                onPress={() => setFilter('all')}
              />
              <FilterSeg
                label={`Yes ${yes}`}
                active={filter === 'yes'}
                onPress={() => setFilter('yes')}
              />
              <FilterSeg
                label={`No ${no}`}
                active={filter === 'no'}
                onPress={() => setFilter('no')}
              />
              {absent > 0 ? (
                <FilterSeg
                  label={`Didn’t vote ${absent}`}
                  active={filter === 'abs'}
                  onPress={() => setFilter('abs')}
                />
              ) : null}
            </View>
            <View style={[styles.searchField, ...fieldFocusRing(focused)]}>
              <Svg width={15} height={15} viewBox="0 0 24 24" fill="none">
                <Circle cx={11} cy={11} r={6.5} stroke={t.colors.text.muted} strokeWidth={2} />
                <Path
                  d="M16 16 L20 20"
                  stroke={t.colors.text.muted}
                  strokeWidth={2}
                  strokeLinecap="round"
                />
              </Svg>
              <TextInput
                value={search}
                onChangeText={setSearch}
                onFocus={focusProps.onFocus}
                onBlur={focusProps.onBlur}
                // The descriptive placeholder is the field's accessible name — no
                // separate accessibilityLabel (that would make screen readers
                // announce both the placeholder and the label).
                placeholder="Find a legislator"
                placeholderTextColor={t.colors.text.faint}
                style={[styles.searchInput, fieldOutlineReset]}
              />
            </View>
          </View>

          <View style={styles.blocks}>
            {blocks.map((block) => (
              <PartyBlockView
                key={block.party}
                block={block}
                filtered={block.members.filter((m) => matchTab(m) && matchQ(m))}
                onOpenLegislator={onOpenLegislator}
              />
            ))}
          </View>
        </View>
      ) : null}
    </View>
  );
}

function PartyBlockView({
  block,
  filtered,
  onOpenLegislator,
}: {
  block: PartyBlock;
  filtered: MemberVote[];
  onOpenLegislator: (legislatorId: string) => void;
}) {
  return (
    <View>
      <View style={styles.blockHead}>
        <Text style={styles.blockLabel}>{block.label}</Text>
        <Text style={styles.blockMeta}>{block.seats}</Text>
        <Text style={styles.blockMeta}>·</Text>
        <Text style={styles.blockSplit}>
          <Text style={styles.blockYes}>{block.yes} Yes</Text>
          <Text style={styles.blockMeta}> · </Text>
          <Text style={styles.blockNo}>{block.no} No</Text>
        </Text>
        {block.absent > 0 ? (
          <Text style={styles.blockMeta}>· {block.absent} didn’t vote</Text>
        ) : null}
        <View style={styles.blockRule} />
      </View>
      {filtered.length ? (
        <View style={styles.chips}>
          {filtered.map((m) => (
            <MemberChip
              key={m.legislatorId}
              member={m}
              onPress={() => onOpenLegislator(m.legislatorId)}
            />
          ))}
        </View>
      ) : (
        <Text style={styles.blockEmpty}>No members in this group.</Text>
      )}
    </View>
  );
}

function RecordLink({ url, onOpen }: { url: string; onOpen: (url: string) => void }) {
  const [hovered, hover] = useHover();
  return (
    <Pressable accessibilityRole="link" onPress={() => onOpen(url)} {...hover}>
      <Text style={[styles.recordLink, hovered && styles.recordLinkHover]}>Official record →</Text>
    </Pressable>
  );
}

function MemberChip({ member, onPress }: { member: MemberVote; onPress: () => void }) {
  const [hovered, hover] = useHover();
  const yea = member.vote === 'YES';
  const nay = member.vote === 'NO';
  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={`${member.name}, voted ${member.vote.toLowerCase()}`}
      onPress={onPress}
      {...hover}
      style={[
        styles.chip,
        yea ? styles.chipYes : nay ? styles.chipNo : styles.chipAbs,
        hovered && (yea ? styles.chipYesHover : nay ? styles.chipNoHover : styles.chipAbsHover),
      ]}
    >
      <Text
        style={[
          styles.chipMark,
          yea ? styles.chipYesText : nay ? styles.chipNoText : styles.chipAbsText,
        ]}
      >
        {yea ? '✓' : nay ? '✕' : '–'}
      </Text>
      <Text
        style={[
          styles.chipName,
          yea ? styles.chipYesText : nay ? styles.chipNoText : styles.chipAbsText,
        ]}
      >
        {member.name}
      </Text>
      {member.crossover ? <View style={styles.crossDot} /> : null}
    </Pressable>
  );
}

function FilterSeg({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  const [hovered, hover] = useHover();
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      {...hover}
      style={[styles.seg, active && styles.segActive]}
    >
      <Text
        style={[
          styles.segText,
          active ? styles.segTextActive : hovered ? styles.segTextHover : null,
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

function NoVotes({
  identifier,
  onAsk,
  updatedLabel,
}: {
  identifier: string;
  onAsk: () => void;
  updatedLabel: string;
}) {
  const [hovered, hover] = useHover();
  return (
    <View>
      <View style={styles.emptyCard}>
        <View style={styles.emptyIcon}>
          <Svg width={30} height={30} viewBox="0 0 24 24" fill="none">
            <Path
              d="M7 5 V19 M7 19 L3.5 15.5 M7 19 L10.5 15.5 M14 8 h6 M14 13 h4"
              stroke={t.colors.text.muted}
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </Svg>
        </View>
        <Text accessibilityRole="header" style={styles.emptyTitle}>
          No recorded roll-call votes
        </Text>
        <Text style={styles.emptyBody}>
          We don’t have recorded roll-call votes to show for {identifier}. When a chamber’s recorded
          vote is available, it appears here.
        </Text>
        <Pressable
          accessibilityRole="button"
          onPress={onAsk}
          {...hover}
          style={[styles.askCta, hovered && styles.askCtaHover]}
        >
          <Text style={styles.askCtaText}>Ask about this bill</Text>
          <Svg width={15} height={15} viewBox="0 0 24 24" fill="none">
            <Path
              d="M6 12 H18 M13 7 L18 12 L13 17"
              stroke={t.colors.white}
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </Svg>
        </Pressable>
      </View>
      <SourceLine
        text={`Source: Minnesota Legislature · roll-call records · revisor.mn.gov · ${updatedLabel}`}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  intro: {
    fontFamily: t.typography.body,
    fontSize: t.fontSizes.body,
    lineHeight: 23,
    color: t.colors.text.faint,
  },
  introStrong: { fontWeight: t.fontWeights.bold, color: t.colors.text.secondary },
  metaRow: { marginTop: 10, flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap' },
  recordLink: {
    fontFamily: t.typography.mono,
    fontSize: t.fontSizes.label,
    fontWeight: t.fontWeights.semibold,
    letterSpacing: 0.5,
    color: t.colors.text.green,
  },
  recordLinkHover: { color: t.colors.brand.forest, textDecorationLine: 'underline' },
  crossLegend: { marginTop: 10, flexDirection: 'row', alignItems: 'center', gap: 7 },
  crossLegendText: {
    fontFamily: t.typography.body,
    fontSize: t.fontSizes.meta,
    color: t.colors.text.muted,
  },
  crossDotInline: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: t.colors.omnibus.text,
  },
  rolls: { marginTop: 20, gap: 14 },
  card: {
    backgroundColor: t.colors.surfaces.base,
    borderWidth: 1,
    borderColor: t.colors.alpha.ink08,
    borderRadius: t.radii.lg,
    paddingVertical: 20,
    paddingHorizontal: 26,
    ...(isWeb ? { boxShadow: '0 6px 18px rgba(17,21,15,0.04)' } : (t.shadows.card as object)),
  },
  cardHover: { borderColor: t.colors.brand.base },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: 20 },
  cardHeadMain: { flex: 1, minWidth: 0 },
  motion: {
    fontFamily: t.typography.body,
    fontSize: t.fontSizes.subhead,
    fontWeight: t.fontWeights.bold,
    color: t.colors.text.primary,
  },
  meta: {
    marginTop: 6,
    fontFamily: t.typography.mono,
    fontSize: t.fontSizes.label,
    letterSpacing: 0.6,
    color: t.colors.text.muted,
  },
  cardHeadRight: { flexDirection: 'row', alignItems: 'center', gap: 24 },
  badgeSlot: { minWidth: 70 },
  passedBadge: {
    alignSelf: 'flex-start',
    paddingVertical: 6,
    paddingHorizontal: 12,
    backgroundColor: t.colors.tint.t150,
    borderWidth: 1,
    borderColor: t.colors.tint.border,
    borderRadius: t.radii.sm,
  },
  passedText: {
    fontFamily: t.typography.body,
    fontSize: t.fontSizes.caption,
    fontWeight: t.fontWeights.bold,
    letterSpacing: 0.8,
    color: t.colors.brand.deep,
  },
  failedBadge: {
    alignSelf: 'flex-start',
    paddingVertical: 6,
    paddingHorizontal: 12,
    backgroundColor: '#fdecec',
    borderWidth: 1,
    borderColor: '#f5c6c4',
    borderRadius: t.radii.sm,
  },
  failedText: {
    fontFamily: t.typography.body,
    fontSize: t.fontSizes.caption,
    fontWeight: t.fontWeights.bold,
    letterSpacing: 0.8,
    color: t.colors.dangerRamp.r600,
  },
  tallySlot: { minWidth: 96 },
  tally: {
    fontFamily: t.typography.mono,
    fontSize: t.fontSizes.h4,
    fontWeight: t.fontWeights.bold,
    color: t.colors.text.primary,
  },
  absent: {
    marginTop: 2,
    fontFamily: t.typography.body,
    fontSize: t.fontSizes.label,
    color: t.colors.text.muted,
  },
  seeWho: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: t.colors.text.primary,
    borderWidth: 1,
    borderColor: t.colors.text.primary,
    borderRadius: t.radii.md,
    paddingVertical: 10,
    paddingHorizontal: 16,
  },
  seeWhoOpen: { backgroundColor: t.colors.surfaces.base },
  seeWhoText: {
    fontFamily: t.typography.ui,
    fontSize: t.fontSizes.meta,
    fontWeight: t.fontWeights.bold,
    letterSpacing: 0.5,
    color: t.colors.white,
  },
  seeWhoTextOpen: { color: t.colors.text.primary },
  bar: {
    marginTop: 14,
    flexDirection: 'row',
    height: 9,
    borderRadius: 5,
    overflow: 'hidden',
    backgroundColor: t.colors.status.progressEmpty,
  },
  barYes: { backgroundColor: t.colors.brand.base },
  barNo: { backgroundColor: t.colors.status.vetoedStep },
  barRest: { flexGrow: 1, minWidth: 8, backgroundColor: t.colors.status.progressEmpty },
  expand: {
    marginTop: 18,
    paddingTop: 18,
    borderTopWidth: 1,
    borderTopColor: t.colors.alpha.ink08,
  },
  filterBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 14,
    flexWrap: 'wrap',
  },
  segmented: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    padding: 4,
    backgroundColor: '#eef0f1',
    borderWidth: 1,
    borderColor: t.colors.alpha.ink10,
    borderRadius: 11,
  },
  seg: { borderRadius: t.radii.sm, paddingVertical: 8, paddingHorizontal: 15 },
  segActive: { backgroundColor: t.colors.text.primary },
  segText: {
    fontFamily: t.typography.ui,
    fontSize: t.fontSizes.meta,
    fontWeight: t.fontWeights.semibold,
    color: t.colors.text.secondary,
  },
  segTextActive: { color: t.colors.white, fontWeight: t.fontWeights.bold },
  segTextHover: { color: t.colors.text.primary },
  searchField: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    backgroundColor: t.colors.surfaces.base,
    borderWidth: 1,
    borderColor: t.colors.alpha.ink14,
    borderRadius: t.radii.md,
    paddingVertical: 8,
    paddingHorizontal: 14,
  },
  searchInput: {
    borderWidth: 0,
    backgroundColor: 'transparent',
    fontFamily: t.typography.body,
    fontSize: t.fontSizes.small,
    color: t.colors.text.primary,
    width: 150,
  },
  blocks: { marginTop: 24, gap: 32 },
  blockHead: { flexDirection: 'row', alignItems: 'center', gap: 10, flexWrap: 'wrap' },
  blockLabel: {
    fontFamily: t.typography.mono,
    fontSize: t.fontSizes.label,
    fontWeight: t.fontWeights.bold,
    letterSpacing: 1.1,
    color: t.colors.text.primary,
  },
  blockMeta: {
    fontFamily: t.typography.mono,
    fontSize: t.fontSizes.label,
    fontWeight: t.fontWeights.bold,
    color: t.colors.text.muted,
  },
  blockSplit: {
    fontFamily: t.typography.mono,
    fontSize: t.fontSizes.label,
    fontWeight: t.fontWeights.bold,
  },
  blockYes: { color: t.colors.brand.deep },
  blockNo: { color: t.colors.dangerRamp.r600 },
  blockRule: { flex: 1, minWidth: 24, height: 1, backgroundColor: t.colors.alpha.ink08 },
  chips: { marginTop: 16, flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: t.radii.pill,
    borderWidth: 1,
  },
  chipYes: { backgroundColor: '#e9faf1', borderColor: t.colors.tint.border },
  chipYesHover: { borderColor: t.colors.brand.base, backgroundColor: '#dff6ea' },
  chipNo: { backgroundColor: '#fdecec', borderColor: '#f5c6c4' },
  chipNoHover: { borderColor: t.colors.status.vetoedStep, backgroundColor: '#fbe0e0' },
  chipAbs: { backgroundColor: '#f4f5f4', borderColor: t.colors.alpha.ink08 },
  chipAbsHover: { borderColor: t.colors.alpha.ink20 },
  chipMark: { fontSize: t.fontSizes.meta, fontWeight: t.fontWeights.heavy },
  chipName: {
    fontFamily: t.typography.body,
    fontSize: t.fontSizes.meta,
    fontWeight: t.fontWeights.semibold,
  },
  chipYesText: { color: t.colors.brand.deep },
  chipNoText: { color: t.colors.dangerRamp.r600 },
  chipAbsText: { color: t.colors.text.muted },
  crossDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: t.colors.omnibus.text },
  blockEmpty: {
    marginTop: 10,
    fontFamily: t.typography.body,
    fontSize: t.fontSizes.meta,
    color: t.colors.text.muted,
  },
  // empty state
  emptyCard: {
    maxWidth: 860,
    marginHorizontal: 'auto',
    alignItems: 'center',
    backgroundColor: t.colors.surfaces.base,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: t.colors.alpha.ink20,
    borderRadius: t.radii.xl,
    paddingVertical: 64,
    paddingHorizontal: 48,
  },
  emptyIcon: {
    width: 64,
    height: 64,
    borderRadius: t.radii.lg,
    backgroundColor: t.colors.surfaces.s400,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyTitle: {
    marginTop: 22,
    fontFamily: t.typography.title,
    fontSize: t.fontSizes.h2,
    fontWeight: t.fontWeights.heavy,
    letterSpacing: -0.3,
    color: t.colors.text.primary,
    textAlign: 'center',
  },
  emptyBody: {
    marginTop: 12,
    maxWidth: 520,
    fontFamily: t.typography.body,
    fontSize: t.fontSizes.lg,
    lineHeight: 25,
    color: t.colors.text.faint,
    textAlign: 'center',
  },
  askCta: {
    marginTop: 24,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    backgroundColor: t.colors.purple.base,
    borderRadius: t.radii.md,
    paddingVertical: 14,
    paddingHorizontal: 26,
  },
  askCtaHover: { backgroundColor: '#4a26b0' },
  askCtaText: {
    fontFamily: t.typography.ui,
    fontSize: t.fontSizes.body,
    fontWeight: t.fontWeights.bold,
    color: t.colors.white,
  },
});
