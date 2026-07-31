import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useEffect, useRef, useState } from 'react';
import { Platform, StyleSheet, Text, TextInput, View } from 'react-native';

import { Card } from '../components/Card';
import { LegislatorCard } from '../components/LegislatorCard';
import { MapPinPicker } from '../components/MapPinPicker';
import { PrimaryButton } from '../components/PrimaryButton';
import { ScreenView } from '../components/ScreenView';
import { isNotFoundError } from '../data/api';
import { isCoordinateInMinnesota } from '../data/minnesotaBoundary';
import { RepresentativeLookupCoordinates } from '../data/types';
import { useRepresentativeLookup } from '../hooks/useAppQueries';
import { RootStackParamList } from '../navigation/types';
import { theme } from '../theme/tokens';
import { fieldFocusRing, fieldOutlineReset, useFieldFocus } from '../theme/fieldFocus';

type Props = NativeStackScreenProps<RootStackParamList, 'FindMyLegislator'>;

// Shown when nobody handed us an address (the screen reached from the nav rail
// or the Search menu). An address that arrives on the route wins over it.
const EXAMPLE_ADDRESS = '350 S 5th St, Minneapolis, MN 55415';

// A failed lookup used to print the API's raw problem JSON into the page. The
// district lookup only recognises a full street address (the Census geocoder
// behind it matches a house number + street), so "Minneapolis" or a bare ZIP is
// the miss a visitor is most likely to hit. Say what to type instead.
function lookupErrorMessage(error: unknown): string {
  if (isNotFoundError(error)) {
    return `We could not find that address. A full street address works best, including the house number, city, and ZIP. A city or a ZIP on its own is not enough to pin down a district: try ${EXAMPLE_ADDRESS}.`;
  }
  return 'The lookup could not be completed just now. Please try again in a moment.';
}

function getBrowserGeolocation(): Geolocation | null {
  if (Platform.OS !== 'web') {
    return null;
  }
  const nav = globalThis.navigator as Navigator | undefined;
  return nav && 'geolocation' in nav ? nav.geolocation : null;
}

export function FindMyLegislatorScreen({ navigation, route }: Props) {
  const requestedAddress = route.params?.address?.trim() || undefined;
  const { focused: addressFocused, focusProps: addressFocusProps } = useFieldFocus();
  const [address, setAddress] = useState(requestedAddress ?? EXAMPLE_ADDRESS);
  const [pinCoordinate, setPinCoordinate] = useState<RepresentativeLookupCoordinates>({
    latitude: 44.97683,
    longitude: -93.26579,
  });
  const [locating, setLocating] = useState(false);
  const [locationError, setLocationError] = useState<string | null>(null);
  const representativeLookup = useRepresentativeLookup();
  const geolocation = getBrowserGeolocation();
  const isPinInMinnesota = isCoordinateInMinnesota(pinCoordinate);
  const canRunLookup = address.trim().length > 0 && !representativeLookup.isPending && !locating;
  const canRunPinLookup = isPinInMinnesota && !representativeLookup.isPending && !locating;
  const canUseMyLocation = geolocation !== null && !representativeLookup.isPending && !locating;

  // Arriving with an address — from the home page's Find field, or from a
  // shared /find-my-legislator?address=... link — runs the lookup on its own.
  // The visitor already pressed Find, so asking them to press Run Lookup again
  // would be asking twice for the same thing.
  const runLookup = representativeLookup.mutate;
  const autoRanFor = useRef<string | null>(null);
  useEffect(() => {
    if (!requestedAddress || autoRanFor.current === requestedAddress) {
      return;
    }
    autoRanFor.current = requestedAddress;
    runLookup(requestedAddress);
  }, [requestedAddress, runLookup]);

  function useMyLocation() {
    if (!geolocation) {
      return;
    }
    setLocationError(null);
    setLocating(true);
    geolocation.getCurrentPosition(
      (position) => {
        setLocating(false);
        const coordinate: RepresentativeLookupCoordinates = {
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
        };
        setPinCoordinate(coordinate);
        if (!isCoordinateInMinnesota(coordinate)) {
          setLocationError(
            'Your location is outside Minnesota. Alethical only covers Minnesota legislative districts.',
          );
          return;
        }
        representativeLookup.mutate(coordinate);
      },
      (error) => {
        setLocating(false);
        setLocationError(
          error.code === error.PERMISSION_DENIED
            ? 'Location access was denied. Enter an address or drag the map pin instead.'
            : 'Could not read your location. Enter an address or drag the map pin instead.',
        );
      },
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 60000 },
    );
  }

  return (
    <ScreenView
      title="Find My Legislator"
      subtitle="Enter a street address to see who represents you in the Minnesota House and Senate."
      actions={
        <PrimaryButton
          label={representativeLookup.isPending ? 'Looking Up' : 'Run Lookup'}
          onPress={canRunLookup ? () => representativeLookup.mutate(address) : undefined}
        />
      }
    >
      <Card>
        {geolocation ? (
          <View style={styles.quickRow}>
            <PrimaryButton
              label={locating ? 'Locating' : 'Use My Location'}
              onPress={canUseMyLocation ? useMyLocation : undefined}
            />
          </View>
        ) : null}
        <TextInput
          accessibilityLabel="Address lookup"
          placeholder="Street address, city, and ZIP"
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

      {locationError ? (
        <Card>
          <Text style={styles.bodyText}>{locationError}</Text>
        </Card>
      ) : null}

      {representativeLookup.isPending ? (
        <Card>
          <Text style={styles.bodyText}>Looking up the location and legislative districts.</Text>
        </Card>
      ) : null}

      {representativeLookup.error ? (
        <Card>
          <Text style={styles.bodyText}>{lookupErrorMessage(representativeLookup.error)}</Text>
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
