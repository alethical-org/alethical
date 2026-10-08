import { useEffect, useId, useState } from 'react';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Text, View } from 'react-native';
import { getLegislatorPerson } from '../../data/personRecords';
import type { RootStackParamList } from '../../navigation/types';
import { PERSON_RECORD_COPY } from '../../lib/personRecords';
import { CandidateLink, candidateText } from './CandidateControls';
import type { PublicPersonLink } from './types';

/** This link exists only when the server has an explicit reviewed identity connection. */
export function LegislatorPersonLink({ slug }: { slug: string }) {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const description = useId();
  const [result, setResult] = useState<{ slug: string; person: PublicPersonLink } | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    void getLegislatorPerson(slug, controller.signal).then(
      (person) => {
        if (!controller.signal.aborted) setResult({ slug, person });
      },
      () => {
        if (!controller.signal.aborted) setResult(null);
      },
    );
    return () => controller.abort();
  }, [slug]);
  if (result?.slug !== slug) return null;
  return (
    <View style={{ marginTop: 12 }}>
      <Text nativeID={description} style={candidateText.body}>
        {PERSON_RECORD_COPY.introduction}
      </Text>
      <CandidateLink
        internal
        label={PERSON_RECORD_COPY.link}
        url={`${result.person.profileUrl}?legislator=${encodeURIComponent(slug)}`}
        describedBy={description}
        accessibilityLabel={`${PERSON_RECORD_COPY.link}, ${result.person.name}`}
        onPress={() =>
          navigation.navigate('PersonOverview', {
            personId: result.person.id,
            fromLegislatorSlug: slug,
          })
        }
      />
    </View>
  );
}
