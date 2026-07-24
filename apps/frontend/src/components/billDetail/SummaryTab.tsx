import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';

import { theme as t } from '../../theme/tokens';
import { Bill } from '../../data/types';
import { askCardPrompts, plainKeyPoints, scopedChipQuery } from '../../lib/billDetail';
import { fieldFocusRing, fieldOutlineReset, useFieldFocus } from '../../theme/fieldFocus';
import { FactsRail } from './FactsRail';
import { SourceLine } from './SourceLine';
import { isWeb, useHover } from './interactions';

// Sticky sidebar is web-only (RN has no 'sticky' position) — applied inline so it
// stays out of StyleSheet.create's typed position union.
const STICKY_RAIL = { position: 'sticky', top: 24 } as object;

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
}: {
  bill: Bill;
  showAsk: boolean;
  onAsk: (question: string) => void;
  onOpenUrl: (url: string) => void;
  onOpenLegislator: (legislatorId: string) => void;
  onOpenBill: (billId: string) => void;
  isDesktop: boolean;
  updatedLabel: string;
  // Jump to a cited statute section in the Full Text tab. No-op if absent.
  onCitationPress?: (sectionId: string) => void;
}) {
  const keyPoints = plainKeyPoints(bill.aiAnalysis?.keyPoints);
  const summary = bill.aiAnalysis?.summary ?? '';
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
                    excerpt={c.excerpt}
                    onPress={
                      onCitationPress && c.sectionId
                        ? () => onCitationPress(c.sectionId)
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
          />
        </View>
      </View>

      <SourceLine text={`Source: Minnesota Legislature · revisor.mn.gov · ${updatedLabel}`} />
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
            <AskChip key={chip} label={chip} onPress={() => askChip(chip)} />
          ))}
        </View>
      ) : null}
    </View>
  );
}

// "From the bill" citation card. When onPress is provided it becomes a button
// that jumps to the cited section in the Full Text tab; otherwise it stays a
// static card (the prop is absent).
function CitationCard({
  label,
  excerpt,
  onPress,
}: {
  label: string;
  excerpt: string;
  onPress?: () => void;
}) {
  const [hovered, hover] = useHover();
  const pressable = !!onPress;
  return (
    <Pressable
      accessibilityRole={pressable ? 'button' : undefined}
      accessibilityLabel={pressable ? `Jump to ${label} in Full Text` : undefined}
      onPress={onPress}
      disabled={!pressable}
      {...(pressable ? hover : {})}
      style={[styles.excerptCard, pressable && hovered && styles.excerptCardHover]}
    >
      <View style={styles.excerptChipRow}>
        <View style={styles.excerptChip}>
          <Text style={styles.excerptChipText}>{label}</Text>
        </View>
      </View>
      <Text style={styles.excerptQuote}>{excerpt}</Text>
    </Pressable>
  );
}

function AskChip({ label, onPress }: { label: string; onPress: () => void }) {
  const [hovered, hover] = useHover();
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      {...hover}
      style={[styles.askChip, hovered && styles.askChipHover]}
    >
      <Text style={[styles.askChipText, hovered && styles.askChipTextHover]}>{label}</Text>
    </Pressable>
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
  excerptCard: {
    backgroundColor: '#f7f9f8',
    borderWidth: 1,
    borderColor: t.colors.alpha.ink08,
    borderRadius: t.radii.lg,
    paddingVertical: 14,
    paddingHorizontal: 16,
  },
  excerptCardHover: {
    borderColor: t.colors.purple.border,
    backgroundColor: t.colors.purple.tint,
  },
  excerptChipRow: { flexDirection: 'row' },
  excerptChip: {
    backgroundColor: t.colors.purple.tint,
    borderWidth: 1,
    borderColor: t.colors.purple.border,
    borderRadius: t.radii.badge,
    paddingVertical: 3,
    paddingHorizontal: 9,
  },
  excerptChipText: {
    fontFamily: t.typography.mono,
    fontSize: t.fontSizes.meta,
    fontWeight: t.fontWeights.bold,
    letterSpacing: 0.3,
    color: t.colors.purple.base,
  },
  excerptQuote: {
    marginTop: 9,
    paddingLeft: 12,
    borderLeftWidth: 3,
    borderLeftColor: t.colors.tint.border,
    fontFamily: t.typography.body,
    fontSize: t.fontSizes.small,
    lineHeight: 21,
    color: t.colors.text.secondary,
    fontStyle: 'italic',
  },
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
  askChip: {
    paddingVertical: 8,
    paddingHorizontal: 14,
    backgroundColor: t.colors.surfaces.base,
    borderWidth: 1,
    borderColor: t.colors.alpha.ink12,
    borderRadius: t.radii.pill,
  },
  askChipHover: {
    borderColor: t.colors.purple.base,
    ...(isWeb
      ? { boxShadow: '0 0 0 3px rgba(91,48,214,0.14)' }
      : (t.shadows.focusPurple as object)),
  },
  askChipText: {
    fontFamily: t.typography.body,
    fontSize: t.fontSizes.meta,
    fontWeight: t.fontWeights.medium,
    color: t.colors.text.secondary,
  },
  askChipTextHover: { color: t.colors.purple.base },
});
