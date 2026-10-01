import { StyleSheet, Text, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { useResponsive } from '../../hooks/useResponsive';
import {
  CandidateLink,
  CandidateSourceLine,
  candidateDate,
  candidateText,
  safeCandidateUrl,
} from './CandidateControls';
import type { CandidateProfileRecord } from './types';

export function CandidateProfileContent({
  record,
  onBack,
  onOpenProfile,
  children,
}: {
  record: CandidateProfileRecord;
  children?: React.ReactNode;
  onBack(): void;
  onOpenProfile?(id: string): void;
}) {
  const { isMobile, isDesktop } = useResponsive();
  const rows = [
    { label: 'Name on record', value: record.candidate.name },
    ...(record.filedDate ? [{ label: 'Filed date', value: candidateDate(record.filedDate) }] : []),
    ...(record.filedWith ? [{ label: 'Filed with', value: record.filedWith }] : []),
  ];
  return (
    <View style={[styles.page, { paddingHorizontal: isMobile ? 20 : isDesktop ? 56 : 32 }]}>
      <View style={styles.content}>
        <CandidateLink internal url="/candidates" label="Back to candidates" onPress={onBack} />
        <Text
          accessibilityRole="header"
          aria-level={1}
          style={[
            candidateText.title,
            { fontSize: isMobile ? 34 : 48, lineHeight: isMobile ? 40 : 53, marginTop: 10 },
          ]}
        >
          {record.candidate.name}
        </Text>
        <View style={styles.identity}>
          <Text style={[candidateText.strong, { fontSize: 20, lineHeight: 27 }]}>
            {record.office}
          </Text>
          <Text style={candidateText.body}>{record.votingArea}</Text>
          <Text style={candidateText.body}>
            {record.election.label} · {candidateDate(record.election.date)}
          </Text>
        </View>
        {record.candidate.party ? (
          <Text style={[candidateText.party, { marginTop: 12 }]}>{record.candidate.party}</Text>
        ) : null}
        <View style={styles.card}>
          <View style={[styles.record, { padding: isMobile ? 20 : 24 }]}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <View
                aria-hidden
                style={{
                  width: 34,
                  height: 34,
                  borderRadius: 9,
                  backgroundColor: '#e4f8ee',
                  justifyContent: 'center',
                  alignItems: 'center',
                }}
              >
                <Svg width={19} height={19} viewBox="0 0 24 24" fill="none" aria-hidden>
                  <Path
                    d="M3.5 9.5L12 4.5L20.5 9.5M5.5 10V18M10 10V18M14 10V18M18.5 10V18M3.5 20H20.5"
                    stroke="#149d5b"
                    strokeWidth={2}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </Svg>
              </View>
              <Text
                accessibilityRole="header"
                aria-level={2}
                style={[candidateText.title, { fontSize: 22, lineHeight: 30, flexShrink: 1 }]}
              >
                Official candidate record
              </Text>
            </View>
            <View style={styles.rows}>
              {rows.map((row) => (
                <View
                  key={row.label}
                  style={[styles.row, isMobile && { flexDirection: 'column', gap: 4 }]}
                >
                  <Text
                    style={[candidateText.body, { width: isMobile ? '100%' : 160, fontSize: 14.5 }]}
                  >
                    {row.label}
                  </Text>
                  <Text style={[candidateText.strong, { flexShrink: 1 }]}>{row.value}</Text>
                </View>
              ))}
            </View>
          </View>
          <CandidateSourceLine source={record.source} />
        </View>
        {record.website && safeCandidateUrl(record.website) ? (
          <View style={styles.website}>
            <CandidateLink url={record.website} label="Campaign website" />
            <Text style={[candidateText.body, { fontSize: 14, lineHeight: 21 }]}>
              {record.website}
            </Text>
          </View>
        ) : null}
        {record.runningMate ? (
          <View style={styles.website}>
            <Text style={candidateText.strong}>{record.runningMate.role ?? 'Running mate'}</Text>
            <CandidateLink
              internal
              url={`/candidates/${encodeURIComponent(record.runningMate.id)}`}
              label={record.runningMate.name}
              onPress={onOpenProfile ? () => onOpenProfile(record.runningMate!.id) : undefined}
            />
          </View>
        ) : null}
        {children}
      </View>
    </View>
  );
}
const styles = StyleSheet.create({
  page: { paddingTop: 40, paddingBottom: 56, width: '100%' },
  content: { maxWidth: 760, width: '100%', alignSelf: 'center' },
  identity: { marginTop: 12, gap: 3 },
  card: {
    marginTop: 28,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: 'rgba(17,21,15,0.1)',
    borderRadius: 16,
  },
  record: { gap: 18 },
  rows: { gap: 12 },
  row: { flexDirection: 'row', gap: 24, alignItems: 'flex-start' },
  website: {
    marginTop: 14,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: 'rgba(17,21,15,0.1)',
    borderRadius: 14,
    paddingHorizontal: 24,
    paddingVertical: 12,
  },
});
