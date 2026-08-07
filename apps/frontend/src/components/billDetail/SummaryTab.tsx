import { StyleSheet, Text, View } from 'react-native';
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
import { linkProps, routePath } from '../../navigation/links';
import { CitationCard, SuggestedQuestionChip } from './CitationCard';
import { FactsRail } from './FactsRail';
import { SourceLine } from './SourceLine';
import { isWeb, STICKY_RAIL } from './interactions';

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
  const { chips: askChipList } = askCardPrompts(bill.questionPrompts);

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
                    <Circle
                      cx={12}
                      cy={12}
                      r={9}
                      stroke={t.colors.brand.graphics}
                      strokeWidth={2}
                    />
                    <Path
                      d="M8.5 12.2 L11 14.7 L15.7 9.6"
                      stroke={t.colors.brand.graphics}
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
              billId={bill.id}
              identifier={bill.identifier}
              sessionLabel={bill.sessionLabel}
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

// Chips-only: free-form Ask is on the roadmap, not shipped, so a typable field
// would over-promise. Matches the Answer page's "Ask another question", which is
// already chips-only. Heading + subhead + a wrap of starter chips, nothing typable.
function AskModule({
  billId,
  identifier,
  sessionLabel,
  chips,
  onAsk,
}: {
  billId: string;
  identifier: string;
  sessionLabel?: string;
  chips: string[];
  onAsk: (question: string) => void;
}) {
  return (
    <View style={styles.askCard}>
      <Text accessibilityRole="header" style={styles.askTitle}>
        Ask about this bill
      </Text>
      <Text style={styles.askSub}>Answers cite the bill text</Text>
      {/* System-suggested chips scope to this bill (`${id}: ${chip}`) so the
          /ask bill_text path always resolves — a chip can never refuse
          (grounded-answers rule 2). Each is a real anchor to its own answer URL,
          matching the Answer page's "Ask another question". */}
      {chips.length ? (
        <View style={styles.askChips}>
          {chips.map((chip) => {
            const scoped = scopedChipQuery(identifier, chip, sessionLabel);
            return (
              <SuggestedQuestionChip
                key={chip}
                label={chip}
                linkProps={linkProps(routePath.ask({ q: scoped, billId }), () => onAsk(scoped))}
              />
            );
          })}
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
  askChips: {
    marginTop: 16,
    flexDirection: 'row',
    alignItems: 'flex-start',
    flexWrap: 'wrap',
    gap: 9,
  },
});
