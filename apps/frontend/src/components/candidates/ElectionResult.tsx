import { StyleSheet, Text, View } from 'react-native';
import { candidateDate, candidateText, CandidateLink } from './CandidateControls';
import { electionOutcomeLabel, electionResultLabel } from '../../lib/personRecords';
import type { CandidateElectionResult } from './types';
import Svg, { Circle, Path } from 'react-native-svg';
import { useResponsive } from '../../hooks/useResponsive';

export function ElectionOutcome({
  result,
  large = false,
}: {
  result?: CandidateElectionResult;
  large?: boolean;
}) {
  if (!result?.outcome) return null;
  // A withdrawn candidacy is distinct from an election result.
  if (result.outcome !== 'withdrew' && result.status !== 'certified') return null;
  return (
    <Text
      style={[
        styles.badge,
        result.outcome === 'elected' && styles.elected,
        result.outcome === 'not-elected' && { backgroundColor: '#fff' },
        large && { fontSize: 16, fontWeight: '800', paddingHorizontal: 12, paddingVertical: 6 },
      ]}
    >
      {result.outcome === 'elected' ? '✓ ' : ''}
      {electionOutcomeLabel(result.outcome)}
    </Text>
  );
}
export function ElectionResultStatus({ result }: { result: CandidateElectionResult }) {
  const warning = ['unofficial', 'recount', 'tie'].includes(result.status);
  const iconColor = result.status === 'certified' ? '#0f7a45' : warning ? '#8f5a12' : '#4f5651';
  return (
    <View style={{ gap: 6, minWidth: 0, maxWidth: '100%', flexShrink: 1 }}>
      <View style={styles.row}>
        <View
          style={[
            styles.status,
            result.status === 'certified' && styles.certified,
            warning && styles.warning,
          ]}
        >
          <Svg width={16} height={16} viewBox="0 0 24 24" fill="none" aria-hidden>
            <Circle cx={12} cy={12} r={9} stroke={iconColor} strokeWidth={2} />
            <Path
              d={
                result.status === 'certified'
                  ? 'M8 12.5L11 15.5L16.5 9.5'
                  : result.status === 'unavailable'
                    ? 'M8 12H16'
                    : 'M12 7V12.5L15.5 14.5'
              }
              stroke={iconColor}
              strokeWidth={2.2}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </Svg>
          <Text style={[candidateText.strong, { fontSize: 14, lineHeight: 22, flexShrink: 1 }]}>
            {electionResultLabel(result)}
          </Text>
        </View>
        {result.status === 'certified' && result.certification?.date ? (
          <Text style={[styles.small, { maxWidth: '100%' }]}>
            Certified {candidateDate(result.certification.date)}
          </Text>
        ) : null}
      </View>
      {result.status === 'unofficial' ? (
        <Text style={styles.small}>These results have not been certified</Text>
      ) : null}
    </View>
  );
}
export function ElectionResultSource({ result }: { result: CandidateElectionResult }) {
  return result.source ? (
    <View style={{ gap: 0 }}>
      <CandidateLink label={`Results from ${result.source.authority}`} url={result.source.url} />
      <Text style={styles.small}>Checked {candidateDate(result.source.checkedDate)}</Text>
    </View>
  ) : null;
}
export function ElectionResultBlock({ result }: { result: CandidateElectionResult }) {
  const { isMobile, isDesktop } = useResponsive();
  return (
    <View style={[styles.block, { paddingHorizontal: isMobile ? 18 : isDesktop ? 28 : 24 }]}>
      <View style={styles.row}>
        <ElectionOutcome result={result} large />
        <ElectionResultStatus result={result} />
      </View>
      <ElectionResultSource result={result} />
    </View>
  );
}
const styles = StyleSheet.create({
  block: {
    borderTopWidth: 1,
    borderTopColor: 'rgba(17,21,15,0.08)',
    paddingHorizontal: 22,
    paddingVertical: 16,
    gap: 10,
  },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'center' },
  badge: {
    ...candidateText.body,
    alignSelf: 'flex-start',
    fontSize: 13.5,
    lineHeight: 20,
    fontWeight: '700',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
    backgroundColor: '#f1f2f4',
    borderWidth: 1,
    borderColor: 'rgba(17,21,15,0.2)',
  },
  elected: { backgroundColor: '#e4f8ee', borderColor: '#8fd3ae', color: '#0b4f2c' },
  status: {
    flexDirection: 'row',
    flexShrink: 1,
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 7,
    minHeight: 32,
    paddingVertical: 4,
    paddingLeft: 9,
    paddingRight: 11,
    borderRadius: 999,
    backgroundColor: '#f1f2f4',
    borderWidth: 1,
    borderColor: 'rgba(17,21,15,0.1)',
  },
  certified: { backgroundColor: '#e4f8ee', borderColor: '#bfeacf' },
  warning: { backgroundColor: '#fdf6e7', borderColor: '#efd9a8' },
  small: { ...candidateText.body, fontSize: 14.5, lineHeight: 22, fontVariant: ['tabular-nums'] },
});
