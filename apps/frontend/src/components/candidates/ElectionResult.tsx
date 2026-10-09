import { Platform, StyleSheet, Text, View } from 'react-native';
import {
  candidateDate,
  candidateText,
  CandidateLink,
  CandidateSourceLine,
} from './CandidateControls';
import { electionOutcomeLabel, electionResultLabel } from '../../lib/personRecords';
import type { CandidateElectionResult, CandidateSource } from './types';
import Svg, { Circle, Path } from 'react-native-svg';
import { useResponsive } from '../../hooks/useResponsive';

function finalOutcome(result?: CandidateElectionResult) {
  // Withdrawal is sourced independently; vote outcomes require certification.
  return result?.outcome === 'withdrew' || result?.status === 'certified'
    ? result.outcome
    : undefined;
}
function RecordIcon({
  kind,
  color,
  size = 16,
  circle = true,
  record = false,
}: {
  kind: 'check' | 'cross' | 'dash' | 'clock';
  color: string;
  size?: number;
  circle?: boolean;
  record?: boolean;
}) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
      {circle ? (
        <Circle cx={12} cy={12} r={record ? 8 : 9} stroke={color} strokeWidth={record ? 2.2 : 2} />
      ) : null}
      <Path
        d={
          kind === 'check'
            ? record
              ? 'M5 12.5L10 17.5L19 7.5'
              : 'M8 12.5L11 15.5L16.5 9.5'
            : kind === 'cross'
              ? 'M7 7L17 17M17 7L7 17'
              : kind === 'dash'
                ? record
                  ? 'M6.5 12H17.5'
                  : 'M8 12H16'
                : record
                  ? 'M12 7.5V12.5L15.5 14.5'
                  : 'M12 7V12.5L15.5 14.5'
        }
        stroke={color}
        strokeWidth={record && kind !== 'clock' ? 2.8 : 2.2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}
export function ElectionOutcome({
  result,
  large = false,
}: {
  result?: CandidateElectionResult;
  large?: boolean;
}) {
  const outcome = finalOutcome(result);
  if (!outcome) return null;
  return (
    <View
      style={[
        styles.badge,
        outcome === 'elected' && styles.elected,
        outcome === 'not-elected' && styles.notElected,
        large && { paddingHorizontal: 12, paddingVertical: 6 },
      ]}
    >
      {outcome === 'elected' || outcome === 'not-elected' ? (
        <RecordIcon
          kind={outcome === 'elected' ? 'check' : 'cross'}
          color={outcome === 'elected' ? '#0b4f2c' : '#c62828'}
          size={13}
          circle={false}
        />
      ) : null}
      <Text
        style={[
          styles.outcomeText,
          outcome === 'elected' && { color: '#0b4f2c' },
          outcome === 'not-elected' && { color: '#8e1b1b' },
          large && { fontSize: 16, fontWeight: '800' },
        ]}
      >
        {electionOutcomeLabel(outcome)}
      </Text>
    </View>
  );
}
export function ElectionResultStatus({
  result,
  showUnofficialNote = true,
}: {
  result: CandidateElectionResult;
  showUnofficialNote?: boolean;
}) {
  return (
    <View style={{ gap: 6, minWidth: 0, maxWidth: '100%', flexShrink: 1 }}>
      <View style={styles.row}>
        <View style={[styles.status, result.status === 'unavailable' && styles.unavailable]}>
          <RecordIcon
            kind={
              result.status === 'certified'
                ? 'check'
                : result.status === 'unavailable'
                  ? 'dash'
                  : 'clock'
            }
            color="#4f5651"
          />
          <Text style={[candidateText.strong, { fontSize: 14, lineHeight: 22, flexShrink: 1 }]}>
            {electionResultLabel(result)}
          </Text>
        </View>
        {result.status === 'certified' ? (
          <Text style={[styles.small, styles.date, { maxWidth: '100%' }]}>
            {result.certification?.date
              ? `Certified ${candidateDate(result.certification.date)}`
              : 'Certified'}
          </Text>
        ) : null}
      </View>
      {result.status === 'unofficial' && showUnofficialNote ? (
        <Text style={styles.small}>These results have not been certified</Text>
      ) : null}
    </View>
  );
}

/** The profile's first status, placed beside office facts or below the office on phones. */
export function ElectionRecordStatus({ result }: { result?: CandidateElectionResult }) {
  const { isMobile } = useResponsive();
  const outcome = finalOutcome(result);
  if (!result || (!outcome && result.status === 'certified')) return null;
  const palette = outcome ? outcomeColors[outcome] : outcomeColors.withdrew;
  const longLabel = !outcome || outcome === 'withdrew';
  const fontSize = longLabel ? (isMobile ? 18 : 19) : isMobile ? 22 : 24;
  const label = outcome
    ? outcome === 'withdrew'
      ? 'Withdrew from election'
      : electionOutcomeLabel(outcome)
    : electionResultLabel(result);
  const contents = (
    <>
      <View
        aria-hidden
        style={[
          styles.disc,
          {
            backgroundColor: palette.disc,
            ...(Platform.OS === 'web'
              ? ({ boxShadow: `0 0 0 4px ${palette.ring}` } as object)
              : { borderWidth: 4, borderColor: palette.ring }),
          },
        ]}
      >
        <RecordIcon
          kind={
            outcome === 'elected'
              ? 'check'
              : outcome === 'not-elected'
                ? 'cross'
                : outcome || result.status === 'unavailable'
                  ? 'dash'
                  : 'clock'
          }
          color="#ffffff"
          record
          size={outcome === 'elected' || (!outcome && result.status !== 'unavailable') ? 22 : 20}
          circle={!outcome && result.status !== 'unavailable'}
        />
      </View>
      <Text
        style={[
          candidateText.strong,
          {
            fontSize,
            lineHeight: fontSize * 1.15,
            fontWeight: '800',
            color: palette.text,
            textAlign: isMobile ? 'left' : 'center',
            flexShrink: 1,
            ...(Platform.OS === 'web'
              ? ({ textWrap: 'balance', overflowWrap: 'anywhere' } as object)
              : {}),
          },
        ]}
      >
        {label}
      </Text>
    </>
  );
  return (
    <View
      testID="candidate-record-status"
      style={[
        styles.recordStatus,
        {
          width: isMobile ? '100%' : 200,
          minHeight: isMobile ? 64 : 112,
          backgroundColor: result.status === 'unavailable' && !outcome ? '#ffffff' : palette.fill,
          borderColor: outcome
            ? palette.outer
            : result.status === 'unavailable'
              ? 'rgba(17,21,15,0.22)'
              : palette.outer,
          padding: outcome ? 4 : undefined,
          paddingVertical: outcome ? undefined : 18,
          paddingHorizontal: outcome ? undefined : 20,
          flexDirection: isMobile ? 'row' : 'column',
          gap: isMobile ? 14 : 10,
        },
      ]}
    >
      {outcome ? (
        <View
          style={[
            styles.innerFrame,
            {
              borderColor: palette.inner,
              flexDirection: isMobile ? 'row' : 'column',
              gap: isMobile ? 14 : 10,
            },
          ]}
        >
          {contents}
        </View>
      ) : (
        contents
      )}
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

/** Keep source meaning intact: retained ballots can never share a “checked” date. */
export function CandidateRecordSources({
  source,
  result,
  inset,
}: {
  source: CandidateSource;
  result?: CandidateElectionResult;
  inset: number;
}) {
  const sameCheck = Boolean(
    result?.source && !source.retained && source.checkedDate === result.source.checkedDate,
  );
  const showStatus = result && (result.status === 'certified' || finalOutcome(result));
  return (
    <View style={[styles.block, { paddingHorizontal: inset }]}>
      {showStatus || result?.status === 'unofficial' ? (
        <View style={{ marginTop: 10, marginBottom: 19, gap: 10 }}>
          {showStatus ? <ElectionResultStatus result={result!} showUnofficialNote={false} /> : null}
          {result?.status === 'unofficial' ? (
            <Text style={styles.small}>These results have not been certified</Text>
          ) : null}
        </View>
      ) : null}
      <CandidateSourceLine
        source={source}
        showChecked={!sameCheck}
        checkedStyle={styles.date}
        style={{ borderTopWidth: 0, paddingHorizontal: 0, paddingVertical: 0 }}
      />
      {result?.source ? (
        <View style={{ marginTop: sameCheck ? 0 : 19 }}>
          <CandidateLink
            label={`Results from ${result.source.authority}`}
            url={result.source.url}
          />
          <Text style={[styles.small, styles.date, sameCheck && { marginTop: 11 }]}>
            {sameCheck ? 'Both checked' : 'Checked'} {candidateDate(result.source.checkedDate)}
          </Text>
        </View>
      ) : null}
    </View>
  );
}
const outcomeColors = {
  elected: {
    fill: '#e4f8ee',
    outer: '#8fd3ae',
    inner: '#5cc08a',
    disc: '#0f7a45',
    ring: '#bfeacf',
    text: '#0b4f2c',
  },
  'not-elected': {
    fill: '#fdecec',
    outer: '#eea9a4',
    inner: '#e07b74',
    disc: '#c62828',
    ring: '#f6c9c6',
    text: '#8e1b1b',
  },
  withdrew: {
    fill: '#f1f2f4',
    outer: 'rgba(17,21,15,0.14)',
    inner: 'rgba(17,21,15,0.24)',
    disc: '#4f5651',
    ring: '#e2e5e4',
    text: '#11150f',
  },
};
const styles = StyleSheet.create({
  block: {
    borderTopWidth: 1,
    borderTopColor: 'rgba(17,21,15,0.08)',
    paddingTop: 8,
    paddingBottom: 14,
  },
  row: { flexDirection: 'row', flexWrap: 'wrap', rowGap: 8, columnGap: 14, alignItems: 'center' },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    alignSelf: 'flex-start',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
    backgroundColor: '#f1f2f4',
    borderWidth: 1,
    borderColor: 'rgba(17,21,15,0.2)',
  },
  outcomeText: { ...candidateText.body, fontSize: 13.5, lineHeight: 20, fontWeight: '700' },
  elected: { backgroundColor: '#e4f8ee', borderColor: '#8fd3ae' },
  notElected: { backgroundColor: '#fdecec', borderColor: '#eea9a4' },
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
    borderColor: 'rgba(17,21,15,0.12)',
  },
  unavailable: { backgroundColor: '#ffffff', borderColor: 'rgba(17,21,15,0.22)' },
  recordStatus: {
    borderWidth: 1.5,
    borderRadius: 16,
    flexShrink: 0,
    alignSelf: 'stretch',
    alignItems: 'center',
    justifyContent: 'center',
  },
  innerFrame: {
    flex: 1,
    width: '100%',
    borderWidth: 1.5,
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  disc: {
    width: 40,
    height: 40,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  date: { fontWeight: '600' },
  small: { ...candidateText.body, fontSize: 14.5, lineHeight: 22, fontVariant: ['tabular-nums'] },
});
