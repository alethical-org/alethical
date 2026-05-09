import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';

import { Card } from '../components/Card';
import { LegislatorCard } from '../components/LegislatorCard';
import { PrimaryButton } from '../components/PrimaryButton';
import { ScreenView } from '../components/ScreenView';
import { useRepresentativeLookup } from '../hooks/useAppQueries';
import { RootStackParamList } from '../navigation/types';
import { theme } from '../theme/tokens';

type Props = NativeStackScreenProps<RootStackParamList, 'FindMyLegislator'>;

export function FindMyLegislatorScreen({ navigation }: Props) {
  const [address, setAddress] = useState('South Minneapolis, MN 55409');
  const representativeLookup = useRepresentativeLookup();

  return (
    <ScreenView
      title="Find My Legislator"
      subtitle="Use a home address or neighborhood to get a fast, readable answer about who represents you."
      actions={<PrimaryButton label="Run Lookup" onPress={() => representativeLookup.mutate(address)} />}
    >
      <Card>
        <TextInput
          accessibilityLabel="Address lookup"
          placeholder="Enter an address or city and ZIP"
          placeholderTextColor={theme.colors.mutedInk}
          style={styles.input}
          value={address}
          onChangeText={setAddress}
        />
        <View style={styles.quickRow}>
          <PrimaryButton label="South Minneapolis" tone="secondary" onPress={() => setAddress('South Minneapolis, MN 55409')} />
          <PrimaryButton label="Saint Paul" tone="secondary" onPress={() => setAddress('Saint Paul, MN 55104')} />
        </View>
      </Card>

      {representativeLookup.data ? (
        <>
          <Card>
            <Text style={styles.title}>{representativeLookup.data.address}</Text>
            <Text style={styles.bodyText}>{representativeLookup.data.districtSummary}</Text>
          </Card>
          <View style={styles.stack}>
            {representativeLookup.data.legislators.map((legislator) => (
              <LegislatorCard
                key={legislator.id}
                legislator={legislator}
                onPress={() =>
                  navigation.navigate('LegislatorProfile', { legislatorId: legislator.id })
                }
              />
            ))}
          </View>
        </>
      ) : (
        <Card>
          <Text style={styles.bodyText}>
            Start with an address to see likely matches for your Minnesota Senate and House districts.
          </Text>
        </Card>
      )}
    </ScreenView>
  );
}

const styles = StyleSheet.create({
  input: {
    minHeight: 52,
    borderRadius: theme.radii.md,
    borderBottomWidth: 2,
    borderColor: theme.colors.border,
    backgroundColor: 'transparent',
    paddingHorizontal: 0,
    color: theme.colors.ink,
    fontFamily: theme.typography.mono,
    fontSize: 15,
  },
  quickRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: theme.spacing.sm,
  },
  title: {
    color: theme.colors.ink,
    fontFamily: theme.typography.title,
    fontSize: 24,
  },
  bodyText: {
    color: theme.colors.ink,
    fontFamily: theme.typography.body,
    fontSize: 15,
    lineHeight: 23,
  },
  stack: {
    gap: theme.spacing.md,
  },
});
