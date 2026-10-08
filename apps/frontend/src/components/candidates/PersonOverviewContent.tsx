import { useState } from 'react';
import { Text, View } from 'react-native';
import type { PersonRecord } from '../../data/personRecords';
import { useResponsive } from '../../hooks/useResponsive';
import {
  candidateElectionLabel,
  candidateOfficeLabel,
  areaLabel,
} from '../../lib/candidatePublicCopy';
import {
  PERSON_RECORD_COPY,
  preciseDate,
  serviceDateLines,
  serviceStatusLabel,
} from '../../lib/personRecords';
import { CandidateButton, CandidateLink, candidateDate, candidateText } from './CandidateControls';
import { ElectionOutcome, ElectionResultStatus } from './ElectionResult';
import { PersonResearch } from './PersonResearch';

export function PersonOverviewContent({
  record,
  returnLabel,
  returnUrl,
  onBack,
  onCandidate,
  onLegislator,
}: {
  record: PersonRecord;
  returnLabel: string;
  returnUrl: string;
  onBack(): void;
  onCandidate(id: string): void;
  onLegislator(slug: string): void;
}) {
  const { isMobile, isDesktop } = useResponsive();
  const [shownElections, setShownElections] = useState(3);
  const inset = isMobile ? 16 : isDesktop ? 22 : 20;
  const sectionStyle = { marginTop: isMobile ? 32 : isDesktop ? 40 : 36 };
  const headingStyle = {
    ...candidateText.title,
    fontSize: isMobile ? 21 : isDesktop ? 24 : 22,
    lineHeight: 30,
  };
  const cardStyle = {
    borderWidth: 1,
    borderColor: 'rgba(17,21,15,0.1)',
    borderRadius: 14,
    backgroundColor: '#fff',
  };
  return (
    <View
      style={{
        width: '100%',
        paddingHorizontal: isMobile ? 20 : isDesktop ? 40 : 32,
        paddingTop: isMobile ? 16 : isDesktop ? 24 : 22,
        paddingBottom: 56,
      }}
    >
      <View style={{ maxWidth: 760, width: '100%', alignSelf: 'center' }}>
        <CandidateLink internal label={returnLabel} url={returnUrl} onPress={onBack} />
        <Text
          style={[
            candidateText.strong,
            { marginTop: 20, fontSize: 13, letterSpacing: 2.6, color: '#0f7a45' },
          ]}
        >
          {PERSON_RECORD_COPY.eyebrow}
        </Text>
        <Text
          accessibilityRole="header"
          aria-level={1}
          style={[
            candidateText.title,
            {
              marginTop: 10,
              fontSize: isMobile ? 32 : isDesktop ? 44 : 40,
              lineHeight: (isMobile ? 32 : isDesktop ? 44 : 40) * 1.08,
            },
          ]}
        >
          {record.name}
        </Text>
        <View style={sectionStyle}>
          <Text accessibilityRole="header" aria-level={2} style={headingStyle}>
            {PERSON_RECORD_COPY.service}
          </Text>
          {record.service.length ? (
            record.service.map((service) => (
              <View key={service.id} style={[cardStyle, { marginTop: 14 }]}>
                <View
                  style={{
                    paddingHorizontal: inset,
                    paddingTop: isMobile ? 16 : 18,
                    paddingBottom: 14,
                    gap: 4,
                  }}
                >
                  <Text style={[candidateText.body, { fontSize: 14.5, fontWeight: '700' }]}>
                    {serviceStatusLabel(service)}
                  </Text>
                  <Text
                    accessibilityRole="header"
                    aria-level={3}
                    style={[candidateText.strong, { fontSize: isMobile ? 18 : 19, lineHeight: 26 }]}
                  >
                    {candidateOfficeLabel(service.office, service.votingArea)}
                  </Text>
                  <Text style={candidateText.body}>{areaLabel(service.votingArea)}</Text>
                  {serviceDateLines(service).map((line) => (
                    <Text key={line} style={[candidateText.body, { fontSize: 15.5, marginTop: 4 }]}>
                      {line}
                    </Text>
                  ))}
                  {service.status === 'elected' ? (
                    <Text style={[candidateText.body, { marginTop: 4, fontSize: 15.5 }]}>
                      {service.expectedStart
                        ? `Expected start ${preciseDate(service.expectedStart)}`
                        : 'Start date not confirmed'}
                    </Text>
                  ) : null}
                  {service.status === 'elected' && service.expectedStartPassed ? (
                    <Text style={[candidateText.strong, { marginTop: 8, fontSize: 15.5 }]}>
                      Current service not confirmed
                    </Text>
                  ) : null}
                  {service.profileUrl && record.legislator ? (
                    <CandidateLink
                      internal
                      label="View legislator profile"
                      url={record.legislator.profileUrl}
                      onPress={() => onLegislator(record.legislator!.slug)}
                    />
                  ) : null}
                </View>
                {service.source ? (
                  <View
                    style={{
                      borderTopWidth: 1,
                      borderTopColor: 'rgba(17,21,15,0.08)',
                      paddingHorizontal: inset,
                      paddingTop: 6,
                      paddingBottom: 12,
                    }}
                  >
                    <CandidateLink
                      label={`Service records from ${service.source.authority}`}
                      url={service.source.url}
                    />
                    {service.source.checkedDate ? (
                      <Text style={[candidateText.body, { fontSize: 14.5 }]}>
                        Checked {candidateDate(service.source.checkedDate)}
                      </Text>
                    ) : null}
                  </View>
                ) : null}
              </View>
            ))
          ) : (
            <Text style={[candidateText.body, { marginTop: 12 }]}>
              {PERSON_RECORD_COPY.noService}
            </Text>
          )}
        </View>
        <View style={sectionStyle}>
          <Text accessibilityRole="header" aria-level={2} style={headingStyle}>
            {PERSON_RECORD_COPY.elections}
          </Text>
          {record.elections.length ? (
            <View style={[cardStyle, { marginTop: 14 }]}>
              {record.elections.slice(0, shownElections).map((item, index) => (
                <View
                  key={item.candidateId}
                  style={{
                    paddingHorizontal: inset,
                    paddingTop: 16,
                    paddingBottom: 10,
                    borderTopWidth: index ? 1 : 0,
                    borderTopColor: 'rgba(17,21,15,0.08)',
                    gap: 5,
                  }}
                >
                  <Text style={candidateText.strong}>
                    {candidateElectionLabel(item.election)} · {candidateDate(item.election.date)}
                  </Text>
                  <Text style={candidateText.strong}>
                    {candidateOfficeLabel(item.office, item.votingArea)}
                  </Text>
                  <Text style={candidateText.body}>{areaLabel(item.votingArea)}</Text>
                  {item.result ? (
                    <View style={{ gap: 6, marginTop: 5 }}>
                      <ElectionOutcome result={item.result} />
                      <ElectionResultStatus result={item.result} />
                    </View>
                  ) : null}
                  <CandidateLink
                    internal
                    label="View election record"
                    accessibilityLabel={`View election record, ${item.office}, ${candidateDate(item.election.date)}`}
                    url={item.profileUrl}
                    onPress={() => onCandidate(item.candidateId)}
                  />
                </View>
              ))}
            </View>
          ) : (
            <Text style={[candidateText.body, { marginTop: 12 }]}>
              {PERSON_RECORD_COPY.noElections}
            </Text>
          )}
          {record.elections.length > shownElections ? (
            <CandidateButton
              label="Show more elections"
              kind="text"
              icon="none"
              style={{ marginLeft: 14 }}
              onPress={() => setShownElections((value) => value + 3)}
            />
          ) : null}
        </View>
        <View style={sectionStyle}>
          <Text accessibilityRole="header" aria-level={2} style={headingStyle}>
            {PERSON_RECORD_COPY.research}
          </Text>
          <PersonResearch
            key={record.id}
            personId={record.id}
            initial={record.research}
            inset={inset}
          />
        </View>
      </View>
    </View>
  );
}
