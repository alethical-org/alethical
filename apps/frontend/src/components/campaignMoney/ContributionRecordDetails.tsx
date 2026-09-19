import React, { useId, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { LinkArrowLabel } from '../LinkArrow';
import { externalLinkProps } from '../../navigation/links';
import { theme } from '../../theme/tokens';
import {
  REGISTRATION_MATCH_LIMIT,
  NAME_REGISTRATION_DIFFERENCE,
  SMALL_CONTRIBUTION_LIMIT,
  CONTRIBUTION_PERIOD_LIMIT,
  REPEATED_RECORD_LIMIT,
  FILE_COPY_MEANING,
  CONTRIBUTION_REPORTING_URL,
  CONTRIBUTION_REPORTING_LABEL,
} from '../../lib/moneyRecordTrust';

/** Essential limits remain beside the count; this control carries the supporting explanation. */
export function ContributionRecordDetails({ matching }: { matching: 'registration' | 'name' }) {
  const [expanded, setExpanded] = useState(false);
  const id = useId();
  return (
    <View style={{ marginTop: 12 }}>
      <Pressable
        accessibilityRole="button"
        aria-expanded={expanded}
        aria-controls={id}
        onPress={() => setExpanded(!expanded)}
        style={{
          minHeight: 44,
          paddingHorizontal: 12,
          flexDirection: 'row',
          alignItems: 'center',
          gap: 12,
          alignSelf: 'flex-start',
          maxWidth: '100%',
          borderRadius: 8,
        }}
      >
        <Text
          style={{ ...text, color: theme.colors.text.primary, fontWeight: '700', flexShrink: 1 }}
        >
          How these records are counted
        </Text>
        <Svg width={16} height={16} viewBox="0 0 24 24" fill="none" aria-hidden>
          <Path
            d={expanded ? 'M6 15 L12 9 L18 15' : 'M6 9 L12 15 L18 9'}
            stroke={theme.colors.text.primary}
            strokeWidth={2.2}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </Svg>
      </Pressable>
      <View nativeID={id}>
        {expanded ? (
          <View style={{ gap: 12, paddingTop: 8 }}>
            {matching === 'registration' ? (
              <Text style={text}>{REGISTRATION_MATCH_LIMIT}</Text>
            ) : null}
            <Text style={text}>{NAME_REGISTRATION_DIFFERENCE}</Text>
            <Text style={text}>{SMALL_CONTRIBUTION_LIMIT}</Text>
            <Text style={text}>{REPEATED_RECORD_LIMIT}</Text>
            <Text style={text}>{CONTRIBUTION_PERIOD_LIMIT}</Text>
            <Text style={text}>{FILE_COPY_MEANING}</Text>
            <Pressable
              {...externalLinkProps(CONTRIBUTION_REPORTING_URL)}
              style={{ minHeight: 44, justifyContent: 'center', alignSelf: 'flex-start' }}
            >
              <LinkArrowLabel
                label={CONTRIBUTION_REPORTING_LABEL}
                style={{ ...text, color: theme.colors.text.greenOnLight, fontWeight: '700' }}
              />
            </Pressable>
          </View>
        ) : null}
      </View>
    </View>
  );
}
const text = {
  fontFamily: theme.typography.body,
  color: '#4f5651',
  fontSize: 16,
  lineHeight: 24,
} as const;
