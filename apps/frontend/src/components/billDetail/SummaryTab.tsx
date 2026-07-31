import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';

import { theme as t } from '../../theme/tokens';
import { Bill } from '../../data/types';
import {
  askCardPrompts,
  plainBillSummary,
  plainKeyPoints,
  scopedChipQuery,
} from '../../lib/billDetail';
import { citationSectionAnchor } from '../../lib/billText';
import { fieldFocusRing, fieldOutlineReset, useFieldFocus } from '../../theme/fieldFocus';
import { CitationCard, SuggestedQuestionChip } from './CitationCard';
import { FactsRail } from './FactsRail';
import { SourceLine } from './SourceLine';
import { isWeb, STICKY_RAIL, useHover } from './interactions';

// Summary tab — two columns on desktop (1.4fr content / 1fr rail), stacked on
// narrow. Left: key points (the plain-language summary) → From the bill excerpts →
// Ask. Right: sticky facts rail. (spec §Summary tab)
export function SummaryTab({
  bill,
  showAsk,
  onAsk,
  onOpenUrl,
  onOpenLegislator,
  onOpenBill,
  isDesktop,
  updatedLabel,
  onCitationPress,
  onJumpToActions,
}: {
  bill: Bill;
  showAsk: boolean;
  onAsk: (question: string) => void;
  onOpenUrl: (url: string) => void;
  onOpenLegislator: (legislatorId: string) => void;
  onOpenBill: (billId: string) => void;
  isDesktop: boolean;
  updatedLabel: string;
  // Jump to a cited statute section in the Bill Text tab, by anchor value
  // (`laws.0.1.0-4`) — the section id alone does not identify a section (#854).
  // No-op if absent.
  onCitationPress?: (sectionAnchor: string) => void;
  // Open the Actions tab — the rail's "See dates" target for a phased law (#715).
  onJumpToActions: () => void;
}) {
  const keyPoints = plainKeyPoints(bill.aiAnalysis?.keyPoints);
  // Through the same cleaner the key points already use — the two are one block of
  // prose to a reader, so cleaning only half of it is the inconsistency this fixes
  // (grounded-answers rule 9). Full text, not a first sentence: this is the tab
  // whose job is showing the whole summary.
  const summary = plainBillSummary(bill.aiAnalysis?.summary);
  const citations = bill.citations ?? [];
  const { placeholder: askPlaceholder, chips: askChipList } = askCardPrompts(bill.questionPrompts);

  return (
    <View>
      <View style={[styles.grid, isDesktop && styles.gridDesktop]}>
        {/* LEFT: key points + excerpts + ask */}
        <View style={[styles.contentCol, isDesktop && styles.contentColDesktop]}>
          {keyPoints.length ? (
            <>
              <Text accessibilityRole="header" style={styles.h2}>
                Key points
              </Text>
              <View style={styles.points}>
                {keyPoints.map((point, i) => (
                  <View key={i} style={styles.pointRow}>
                    <View style={styles.bullet} />
                    <Text style={styles.pointText}>{point}</Text>
                  </View>
                ))}
              </View>
            </>
          ) : summary ? (
            <>
              <Text accessibilityRole="header" style={styles.h2}>
                Summary
              </Text>
              <Text style={styles.summaryText}>{summary}</Text>
            </>
          ) : null}

          {citations.length ? (
            <>
              <View style={styles.fromBillHead}>
                <Text accessibilityRole="header" style={styles.h3}>
                  From the bill
                </Text>
                <View style={styles.citedLabel}>
                  <Text style={styles.citedLabelText}>Cited Sections</Text>
                  <Svg width={14} height={14} viewBox="0 0 24 24" fill="none">
                    <Circle cx={12} cy={12} r={9} stroke={t.colors.brand.deep} strokeWidth={2} />
                    <Path
                      d="M8.5 12.2 L11 14.7 L15.7 9.6"
                      stroke={t.colors.brand.deep}
                      strokeWidth={2}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </Svg>
                </View>
              </View>
              <View style={styles.excerpts}>
                {citations.map((c) => (
                  <CitationCard
                    key={c.id}
                    label={c.label}
                    sectionTopic={c.sectionTopic}
                    excerpts={[c.excerpt]}
                    onPress={
                      onCitationPress && c.sectionId
                        ? () => onCitationPress(citationSectionAnchor(c))
                        : undefined
                    }
                  />
                ))}
              </View>
            </>
          ) : null}

          {showAsk ? (
            <AskModule
              identifier={bill.identifier}
              placeholder={askPlaceholder}
              chips={askChipList}
              onAsk={onAsk}
            />
          ) : null}
        </View>

        {/* RIGHT: sticky facts rail (sticky is web-only; RN has no 'sticky') */}
        <View
          style={[
            styles.railCol,
            isDesktop && styles.railColDesktop,
            isDesktop && isWeb ? STICKY_RAIL : null,
          ]}
        >
          <FactsRail
            bill={bill}
            onOpenUrl={onOpenUrl}
            onOpenLegislator={onOpenLegislator}
            onOpenBill={onOpenBill}
            onJumpToActions={onJumpToActions}
          />
        </View>
      </View>

      <SourceLine updatedLabel={updatedLabel} />
    </View>
  );
}

function AskModule({
  identifier,
  placeholder,
  chips,
  onAsk,
}: {
  identifier: string;
  placeholder?: string;
  chips: string[];
  onAsk: (question: string) => void;
}) {
  const [value, setValue] = useState('');
  const { focused, focusProps } = useFieldFocus();
  const [btnHovered, btnHover] = useHover();

  const submit = () => onAsk(value.trim());

  const askChip = (chip: string) => onAsk(scopedChipQuery(identifier, chip));

  return (
    <View style={styles.askCard}>
      <Text accessibilityRole="header" style={styles.askTitle}>
        Ask about this bill
      </Text>
      <Text style={styles.askSub}>No account needed — answers cite the bill text.</Text>
      <View style={[styles.askField, ...fieldFocusRing(focused)]}>
        <TextInput
          value={value}
          onChangeText={setValue}
          onFocus={focusProps.onFocus}
          onBlur={focusProps.onBlur}
          onSubmitEditing={submit}
          returnKeyType="search"
          placeholder={placeholder ?? `Ask a question about ${identifier}`}
          placeholderTextColor={t.colors.text.faint}
          style={[styles.askInput, fieldOutlineReset]}
        />
        <Pressable
          accessibilityRole="button"
          onPress={submit}
          {...btnHover}
          style={[styles.askBtn, btnHovered && styles.askBtnHover]}
        >
          <Text style={styles.askBtnText}>Ask</Text>
        </Pressable>
      </View>
      {chips.length ? (
        <View style={styles.askChips}>
          {chips.map((chip) => (
            <SuggestedQuestionChip key={chip} label={chip} onPress={() => askChip(chip)} />
          ))}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  grid: { gap: 40 },
  gridDesktop: { flexDirection: 'row', alignItems: 'flex-start', gap: 56 },
  contentCol: { minWidth: 0 },
  contentColDesktop: { flex: 1.4 },
  railCol: { minWidth: 0 },
  railColDesktop: { flex: 1 },
  h2: {
    fontFamily: t.typography.title,
    fontSize: t.fontSizes.h2,
    fontWeight: t.fontWeights.heavy,
    letterSpacing: -0.3,
    color: t.colors.text.primary,
  },
  points: { marginTop: 18, gap: 14 },
  pointRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 14 },
  bullet: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: t.colors.text.primary,
    marginTop: 10,
  },
  pointText: {
    flex: 1,
    fontFamily: t.typography.body,
    fontSize: t.fontSizes.subhead,
    lineHeight: 28,
    color: '#2c322c',
  },
  summaryText: {
    marginTop: 16,
    fontFamily: t.typography.body,
    fontSize: t.fontSizes.subhead,
    lineHeight: 28,
    color: '#2c322c',
  },
  fromBillHead: {
    marginTop: 36,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    flexWrap: 'wrap',
  },
  h3: {
    fontFamily: t.typography.title,
    fontSize: t.fontSizes.h3,
    fontWeight: t.fontWeights.heavy,
    letterSpacing: -0.3,
    color: t.colors.text.primary,
  },
  citedLabel: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  citedLabelText: {
    fontFamily: t.typography.mono,
    fontSize: t.fontSizes.label,
    fontWeight: t.fontWeights.bold,
    letterSpacing: 0.7,
    color: t.colors.text.muted,
  },
  excerpts: { marginTop: 14, gap: 12 },
  askCard: {
    marginTop: 40,
    backgroundColor: t.colors.surfaces.base,
    borderWidth: 1,
    borderColor: t.colors.alpha.ink08,
    borderRadius: t.radii.xl,
    paddingVertical: 24,
    paddingHorizontal: 26,
    ...(isWeb
      ? { boxShadow: '0 10px 30px rgba(17,21,15,0.08), 0 2px 8px rgba(17,21,15,0.05)' }
      : (t.shadows.lg as object)),
  },
  askTitle: {
    fontFamily: t.typography.title,
    fontSize: t.fontSizes.h4,
    fontWeight: t.fontWeights.heavy,
    letterSpacing: -0.3,
    color: t.colors.text.primary,
  },
  askSub: {
    marginTop: 6,
    fontFamily: t.typography.body,
    fontSize: t.fontSizes.small,
    color: t.colors.text.faint,
  },
  askField: {
    marginTop: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: t.colors.surfaces.base,
    borderWidth: 1,
    borderColor: t.colors.alpha.ink14,
    borderRadius: t.radii.md,
    paddingVertical: 5,
    paddingRight: 5,
    paddingLeft: 18,
  },
  askInput: {
    flex: 1,
    minWidth: 0,
    backgroundColor: 'transparent',
    color: t.colors.text.primary,
    fontFamily: t.typography.body,
    fontSize: t.fontSizes.bodyLg,
    paddingVertical: 12,
    paddingHorizontal: 2,
  },
  askBtn: {
    backgroundColor: t.colors.purple.base,
    borderRadius: 9,
    paddingVertical: 12,
    paddingHorizontal: 26,
  },
  askBtnHover: { backgroundColor: '#4a26b0' },
  askBtnText: {
    fontFamily: t.typography.ui,
    fontSize: t.fontSizes.body,
    fontWeight: t.fontWeights.bold,
    color: t.colors.white,
  },
  askChips: { marginTop: 12, flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 9 },
});
