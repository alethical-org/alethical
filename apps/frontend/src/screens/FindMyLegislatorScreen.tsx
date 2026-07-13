import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';

import { Card } from '../components/Card';
import { LegislatorCard } from '../components/LegislatorCard';
import { MapPinPicker } from '../components/MapPinPicker';
import { PrimaryButton } from '../components/PrimaryButton';
import { ScreenView } from '../components/ScreenView';
import { isCoordinateInMinnesota } from '../data/minnesotaBoundary';
import { RepresentativeLookupCoordinates } from '../data/types';
import { useRepresentativeLookup } from '../hooks/useAppQueries';
import { RootStackParamList } from '../navigation/types';
import { theme } from '../theme/tokens';
import { fieldFocusRing, fieldOutlineReset, useFieldFocus } from '../theme/fieldFocus';

type Props = NativeStackScreenProps<RootStackParamList, 'FindMyLegislator'>;

export function FindMyLegislatorScreen({ navigation }: Props) {
  const { focused: addressFocused, focusProps: addressFocusProps } = useFieldFocus();
  const [address, setAddress] = useState('350 S 5th St, Minneapolis, MN 55415');
  const [pinCoordinate, setPinCoordinate] = useState<RepresentativeLookupCoordinates>({
    latitude: 44.97683,
    longitude: -93.26579,
  });
  const representativeLookup = useRepresentativeLookup();
  const isPinInMinnesota = isCoordinateInMinnesota(pinCoordinate);
  const canRunLookup = address.trim().length > 0 && !representativeLookup.isPending;
  const canRunPinLookup = isPinInMinnesota && !representativeLookup.isPending;

  return (
    <ScreenView
      title="Find My Legislator"
      subtitle="Use a home address or neighborhood to get a fast, readable answer about who represents you."
      actions={
        <PrimaryButton
          label={representativeLookup.isPending ? 'Looking Up' : 'Run Lookup'}
          onPress={canRunLookup ? () => representativeLookup.mutate(address) : undefined}
        />
      }
    >
      <Card>
        <TextInput
          accessibilityLabel="Address lookup"
          placeholder="Enter an address or city and ZIP"
          placeholderTextColor={theme.colors.mutedInk}
          style={[styles.input, ...fieldFocusRing(addressFocused), fieldOutlineReset]}
          value={address}
          onChangeText={setAddress}
          {...addressFocusProps}
        />
        <View style={styles.quickRow}>
          <PrimaryButton
            label="Minneapolis"
            tone="secondary"
            onPress={() => setAddress('350 S 5th St, Minneapolis, MN 55415')}
          />
          <PrimaryButton
            label="Saint Paul"
            tone="secondary"
            onPress={() => setAddress('175 Kellogg Blvd W, Saint Paul, MN 55102')}
          />
        </View>
      </Card>

      <Card>
        <Text style={styles.sectionTitle}>Map Pin</Text>
        <MapPinPicker coordinate={pinCoordinate} onCoordinateChange={setPinCoordinate} />
        <View style={styles.quickRow}>
          <PrimaryButton
            label={representativeLookup.isPending ? 'Looking Up' : 'Lookup Pin'}
            tone="secondary"
            onPress={canRunPinLookup ? () => representativeLookup.mutate(pinCoordinate) : undefined}
          />
        </View>
      </Card>

      {representativeLookup.isPending ? (
        <Card>
          <Text style={styles.bodyText}>Looking up the location and legislative districts.</Text>
        </Card>
      ) : null}

      {representativeLookup.error ? (
        <Card>
          <Text style={styles.bodyText}>
            {representativeLookup.error instanceof Error
              ? representativeLookup.error.message
              : 'Representative lookup failed.'}
          </Text>
        </Card>
      ) : null}

      {!representativeLookup.isPending &&
      !representativeLookup.error &&
      representativeLookup.data ? (
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
      ) : null}

      {!representativeLookup.isPending &&
      !representativeLookup.error &&
      !representativeLookup.data ? (
        <Card>
          <Text style={styles.bodyText}>
            Start with an address to see likely matches for your Minnesota Senate and House
            districts.
          </Text>
        </Card>
      ) : null}
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
  sectionTitle: {
    color: theme.colors.ink,
    fontFamily: theme.typography.ui,
    fontSize: 13,
    fontWeight: '700',
    textTransform: 'uppercase',
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
